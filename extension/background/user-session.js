import {
  createTraceId,
  debugError,
  debugLog,
  debugWarn
} from "./debug-log.js";
import {
  ACTIVE_ENVIRONMENT,
  FRONTEND_ORIGIN,
  FRONTEND_TAB_URL_PATTERNS,
  LOGIN_URL,
  isFrontendPageUrl
} from "./environment.js";

/**
 * 站点登录令牌的 localStorage 键。
 *
 * 必须与前端 `frontend/src/lib/auth.ts` 的 `TOKEN_KEY` 逐字一致 ——
 * 两边各写一份字符串是这套集成里最容易静默失联的地方（改一边不改另一边，
 * 扩展会一直显示「未登录」而站点明明已登录）。
 */
const USER_TOKEN_STORAGE_KEY = "ecom_vision_token";
const SESSION_KEY_SUFFIX =
  `:${ACTIVE_ENVIRONMENT}:${new URL(FRONTEND_ORIGIN).hostname}`;
const SESSION_USER_TOKEN_KEY = `huojueSessionUserToken${SESSION_KEY_SUFFIX}`;
const SESSION_AUTH_STATE_KEY = `huojueSessionAuthenticated${SESSION_KEY_SUFFIX}`;
const SESSION_CONSUMER_TABS_KEY = `huojueSessionConsumerTabs${SESSION_KEY_SUFFIX}`;
const PENDING_LOGIN_CONTEXT_KEY = `huojuePendingLoginContext${SESSION_KEY_SUFFIX}`;
const MAX_TOKEN_LENGTH = 8192;
const MAX_PENDING_LOGIN_AGE_MS = 15 * 60 * 1000;

export class UserLoginRequiredError extends Error {
  constructor() {
    super("未检测到登录状态，请先在新打开的页面完成登录，然后返回重试。");
    this.name = "UserLoginRequiredError";
    this.code = "HUOJUE_LOGIN_REQUIRED";
  }
}

/**
 * 获取当前用户令牌，三级回退：
 *   1. 当前标签页若就是本站，直接读它的 localStorage；
 *   2. 本站登录监听内容脚本写入的临时会话令牌（chrome.storage.session）；
 *   3. 扩展重载导致会话丢失时，从已打开的本站标签页逐个恢复。
 *
 * 令牌只进 `chrome.storage.session`（浏览器会话结束即清空），
 * 不落 `storage.local` —— 采集页是各类第三方电商站，令牌不能长期留在扩展里。
 */
export async function getUserToken(tabId, { traceId: providedTraceId } = {}) {
  const traceId = createTraceId(providedTraceId);
  debugLog("user-session", traceId, "开始获取用户令牌", { tabId });

  const pageToken = await getTokenFromCurrentEnvironmentTab(tabId, traceId);
  if (pageToken) {
    await cacheSessionUserToken(pageToken);
    debugLog("user-session", traceId, "从页面 localStorage 获取令牌成功", {
      source: USER_TOKEN_STORAGE_KEY,
      tokenLength: pageToken.length
    });
    return pageToken;
  }

  const monitoredState = await getMonitoredAuthState(traceId);
  const sessionToken = await getSessionUserToken(traceId);
  if (sessionToken && monitoredState !== false) {
    debugLog("user-session", traceId, "从登录监听会话获取令牌成功", {
      tokenLength: sessionToken.length
    });
    return sessionToken;
  }

  const restoredToken = await getTokenFromOpenFrontendTabs(tabId, traceId);
  if (restoredToken) {
    await cacheSessionUserToken(restoredToken);
    debugLog("user-session", traceId, "扩展重载后从站点标签页恢复令牌成功", {
      tokenLength: restoredToken.length
    });
    return restoredToken;
  }

  if (monitoredState === false) {
    debugWarn("user-session", traceId, "登录监听器已确认用户退出登录");
    throw new UserLoginRequiredError();
  }

  debugWarn(
    "user-session",
    traceId,
    "当前页面、登录会话和已打开的站点标签页均无用户令牌"
  );
  throw new UserLoginRequiredError();
}

/**
 * 打开站点登录页。
 *
 * 新建标签页而不是当前页跳转：用户正在商品页上采集，跳走会丢掉筛选与滚动位置。
 * 登录成功后由本站的登录监听内容脚本回报，Service Worker 再通知原页面继续。
 */
export async function openLoginPage({
  returnTabId,
  traceId: providedTraceId
} = {}) {
  const traceId = createTraceId(providedTraceId);
  debugLog("user-session", traceId, "准备打开登录页面", {
    loginUrl: LOGIN_URL,
    returnTabId: Number.isInteger(returnTabId) ? returnTabId : null
  });

  try {
    if (Number.isInteger(returnTabId)) {
      await chrome.storage.session.set({
        [PENDING_LOGIN_CONTEXT_KEY]: {
          createdAt: Date.now(),
          returnTabId,
          traceId
        }
      });
    }

    const tab = await chrome.tabs.create({ active: true, url: LOGIN_URL });
    debugLog("user-session", traceId, "登录页面已打开", {
      loginUrl: LOGIN_URL,
      tabId: tab?.id ?? null
    });
    return LOGIN_URL;
  } catch (error) {
    await chrome.storage.session.remove(PENDING_LOGIN_CONTEXT_KEY);
    debugError("user-session", traceId, "打开登录页面失败", error);
    throw error;
  }
}

/**
 * 接收本站登录监听内容脚本上报的登录状态。
 */
export async function updateLoginState(
  value,
  { traceId: providedTraceId } = {}
) {
  const traceId = createTraceId(providedTraceId);
  const token = normalizeUserToken(value);
  const previousToken = await getSessionUserToken(traceId);
  const previousAuthState = await getMonitoredAuthState(traceId);
  const loggedOut =
    (previousAuthState === true || Boolean(previousToken)) && !token;
  const userChanged = Boolean(previousToken && token && previousToken !== token);

  if (token) {
    await chrome.storage.session.set({
      [SESSION_AUTH_STATE_KEY]: true,
      [SESSION_USER_TOKEN_KEY]: token
    });
  } else {
    await chrome.storage.session.remove(SESSION_USER_TOKEN_KEY);
    await chrome.storage.session.set({ [SESSION_AUTH_STATE_KEY]: false });
  }

  const stored = await chrome.storage.session.get(PENDING_LOGIN_CONTEXT_KEY);
  const pending = normalizePendingLoginContext(
    stored[PENDING_LOGIN_CONTEXT_KEY]
  );
  let returnTabId = null;
  let consumerTabIds = await getSessionConsumerTabIds();

  if (stored[PENDING_LOGIN_CONTEXT_KEY] && !pending) {
    await chrome.storage.session.remove(PENDING_LOGIN_CONTEXT_KEY);
  }

  if (token && pending) {
    returnTabId = pending.returnTabId;
    consumerTabIds = addConsumerTabId(consumerTabIds, returnTabId);
    await chrome.storage.session.set({
      [SESSION_CONSUMER_TABS_KEY]: consumerTabIds
    });
    await chrome.storage.session.remove(PENDING_LOGIN_CONTEXT_KEY);
  }

  const affectedTabIds = loggedOut ? consumerTabIds : [];
  if (loggedOut) {
    await chrome.storage.session.remove(SESSION_CONSUMER_TABS_KEY);
  }

  debugLog("user-session", traceId, "登录状态已更新", {
    affectedTabCount: affectedTabIds.length,
    authenticated: Boolean(token),
    loggedOut,
    returnTabId,
    stateChanged: previousToken !== token,
    tokenLength: token?.length || 0,
    userChanged
  });
  return {
    affectedTabIds,
    authenticated: Boolean(token),
    loggedOut,
    returnTabId,
    userChanged
  };
}

/**
 * 登记「用过登录会话」的标签页，退出登录时只通知这些页面。
 */
export async function registerUserSessionConsumer(
  tabId,
  { traceId: providedTraceId } = {}
) {
  if (!Number.isInteger(tabId)) {
    return;
  }

  const traceId = createTraceId(providedTraceId);
  const tabIds = addConsumerTabId(await getSessionConsumerTabIds(), tabId);
  await chrome.storage.session.set({ [SESSION_CONSUMER_TABS_KEY]: tabIds });
  debugLog("user-session", traceId, "已登记登录会话使用页面", {
    consumerTabCount: tabIds.length,
    tabId
  });
}

export function isUserLoginRequiredError(error) {
  return (
    error instanceof UserLoginRequiredError ||
    (error instanceof Error && error.name === "UserLoginRequiredError") ||
    error?.code === "HUOJUE_LOGIN_REQUIRED"
  );
}

export function normalizeUserToken(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error("登录令牌格式无效。");
  }

  const token = value.trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    throw new Error("登录令牌格式无效。");
  }

  return token;
}

async function getSessionUserToken(traceId) {
  try {
    const stored = await chrome.storage.session.get(SESSION_USER_TOKEN_KEY);
    return normalizeUserToken(stored[SESSION_USER_TOKEN_KEY]);
  } catch (error) {
    debugWarn("user-session", traceId, "读取临时登录会话失败", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

async function cacheSessionUserToken(token) {
  await chrome.storage.session.set({
    [SESSION_AUTH_STATE_KEY]: true,
    [SESSION_USER_TOKEN_KEY]: token
  });
}

async function getMonitoredAuthState(traceId) {
  try {
    const stored = await chrome.storage.session.get(SESSION_AUTH_STATE_KEY);
    return typeof stored[SESSION_AUTH_STATE_KEY] === "boolean"
      ? stored[SESSION_AUTH_STATE_KEY]
      : null;
  } catch (error) {
    debugWarn("user-session", traceId, "读取登录状态失败", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

async function getSessionConsumerTabIds() {
  const stored = await chrome.storage.session.get(SESSION_CONSUMER_TABS_KEY);
  const value = stored[SESSION_CONSUMER_TABS_KEY];
  return Array.isArray(value)
    ? [...new Set(value.filter(Number.isInteger))].slice(-20)
    : [];
}

function addConsumerTabId(tabIds, tabId) {
  return [...new Set([...tabIds, tabId])].slice(-20);
}

function normalizePendingLoginContext(value) {
  if (
    !value ||
    !Number.isInteger(value.returnTabId) ||
    !Number.isFinite(value.createdAt) ||
    Date.now() - value.createdAt > MAX_PENDING_LOGIN_AGE_MS
  ) {
    return null;
  }
  return value;
}

async function getTokenFromCurrentEnvironmentTab(tabId, traceId) {
  if (!Number.isInteger(tabId)) {
    return null;
  }

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isFrontendPageUrl(tab?.url)) {
      debugLog("user-session", traceId, "当前标签页不是本站页面", { tabId });
      return null;
    }
  } catch (error) {
    debugWarn("user-session", traceId, "读取当前标签页地址失败", {
      error: error instanceof Error ? error.message : String(error),
      tabId
    });
    return null;
  }

  return getTokenFromTab(tabId, traceId);
}

async function getTokenFromTab(tabId, traceId) {
  if (!Number.isInteger(tabId)) {
    debugWarn("user-session", traceId, "标签页 ID 无效，跳过 localStorage", {
      tabId
    });
    return null;
  }

  const startedAt = Date.now();
  debugLog("user-session", traceId, "读取页面 localStorage", {
    storageKey: USER_TOKEN_STORAGE_KEY,
    tabId
  });

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [USER_TOKEN_STORAGE_KEY],
      func: readLocalStorageValue
    });
    const token = normalizeUserToken(result);
    debugLog("user-session", traceId, "页面 localStorage 读取完成", {
      durationMs: Date.now() - startedAt,
      found: Boolean(token)
    });
    return token;
  } catch (error) {
    // 页面可能已跳转或不允许脚本注入，此时继续检查临时登录会话。
    debugWarn("user-session", traceId, "页面 localStorage 读取失败", {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

async function getTokenFromOpenFrontendTabs(excludedTabId, traceId) {
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: [...FRONTEND_TAB_URL_PATTERNS] });
  } catch (error) {
    debugWarn("user-session", traceId, "查询站点标签页失败", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }

  const candidateTabs = tabs.filter(
    ({ id }) => Number.isInteger(id) && id !== excludedTabId
  );
  debugLog("user-session", traceId, "开始从已打开的站点标签页恢复登录状态", {
    candidateTabCount: candidateTabs.length
  });

  for (const tab of candidateTabs) {
    const token = await getTokenFromTab(tab.id, traceId);
    if (token) {
      debugLog("user-session", traceId, "已从站点标签页读取登录令牌", {
        tabId: tab.id,
        tokenLength: token.length
      });
      return token;
    }
  }

  return null;
}

// 该函数会被序列化后注入页面，不能依赖模块作用域中的变量。
function readLocalStorageValue(storageKey) {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}
