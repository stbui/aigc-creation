import {
  createTraceId,
  debugError,
  debugLog,
  debugWarn,
  describeUrl
} from "./debug-log.js";
import { uploadCapturedImage } from "./asset-uploader.js";
import {
  WORKBENCH_URL,
  LIBRARY_URL,
  LOGIN_URL,
  REPLICATE_URL,
  FRONTEND_TAB_URL_PATTERNS,
  isFrontendPageUrl,
  isSiteHostname
} from "./environment.js";
import {
  clearRecentProjects,
  createProject,
  listProjects,
  moveAssetsToProject,
  resolveCaptureProject
} from "./project-service.js";
import { getCurrentUser } from "./user-info-service.js";
import {
  getUserToken,
  isUserLoginRequiredError,
  openLoginPage,
  registerUserSessionConsumer,
  updateLoginState
} from "./user-session.js";

const CAPTURE_IMAGE_MESSAGE = "huojue:capture-image";
const REPLICATE_IMAGE_MESSAGE = "huojue:replicate-image";
const CONTEXT_MENU_SAVE_ID = "huojue:save-to-library";
const CONTEXT_MENU_RESULT_MESSAGE = "huojue:save-result";
const CONTEXT_MENU_PROGRESS_MESSAGE = "huojue:save-progress";
const GET_CONTEXT_TARGET_MESSAGE = "huojue:get-context-menu-target";
const GET_USER_INFO_MESSAGE = "huojue:get-user-info";
const GET_PROJECTS_MESSAGE = "huojue:get-projects";
const CREATE_PROJECT_MESSAGE = "huojue:create-project";
const MOVE_ASSETS_MESSAGE = "huojue:move-assets";
const OPEN_LOGIN_MESSAGE = "huojue:open-login";
const OPEN_PAGE_MESSAGE = "huojue:open-page";
const AUTH_STATE_MESSAGE = "huojue:auth-state";
const LOGIN_DETECTED_MESSAGE = "huojue:login-detected";
const LOGOUT_DETECTED_MESSAGE = "huojue:logout-detected";
const DISABLED_HOSTS_STORAGE_KEY = "huojueDisabledHosts";
const INSTALL_SIGNAL_MESSAGE = "huojue:extension:installed";
const INSTALL_SIGNAL_STORAGE_KEY = "huojue:extension:install-signal";

let contextMenuPromise = null;

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await ensureContextMenu();

  if (reason !== "install") {
    return;
  }

  const installedAt = Date.now();
  await chrome.storage.local.set({
    installedAt: new Date(installedAt).toISOString()
  });
  await notifyOpenFrontendTabsInstalled(installedAt);

  debugLog("service-worker", "install", "货觉AI 图片采集助手已安装");
});

chrome.runtime.onStartup.addListener(() => {
  void ensureContextMenu();
});

void ensureContextMenu();

/**
 * 安装信号：站点本身需要在「装好扩展后」刷新登录态并展示引导。
 *
 * 只投递给本站标签页。同时写 sessionStorage 与 postMessage ——
 * 页面监听器可能还没挂载完成，`postMessage` 会丢，而 sessionStorage
 * 能让稍后才注册的监听器补读到。
 */
async function notifyOpenFrontendTabsInstalled(installedAt) {
  const tabs = await chrome.tabs
    .query({ url: [...FRONTEND_TAB_URL_PATTERNS] })
    .catch((error) => {
      debugError("service-worker", "install", "查找站点标签页失败", error);
      return [];
    });

  const results = await Promise.allSettled(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) =>
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          args: [chrome.runtime.id, installedAt],
          func: (extensionId, timestamp) => {
            const signal = {
              type: "huojue:extension:installed",
              extensionId,
              installedAt: timestamp
            };
            try {
              window.sessionStorage.setItem(
                "huojue:extension:install-signal",
                JSON.stringify(signal)
              );
            } catch {
              // 个别站点禁用 sessionStorage，postMessage 仍覆盖已挂载的监听器
            }
            window.postMessage(signal, window.location.origin);
          }
        })
      )
  );

  const failedCount = results.filter(
    ({ status }) => status === "rejected"
  ).length;
  debugLog("service-worker", "install", "已投递安装信号", {
    failedCount,
    tabCount: results.length
  });
}

async function ensureContextMenu() {
  if (contextMenuPromise) {
    return contextMenuPromise;
  }

  contextMenuPromise = createContextMenu().finally(() => {
    contextMenuPromise = null;
  });
  return contextMenuPromise;
}

async function createContextMenu() {
  try {
    await chrome.contextMenus.removeAll();
    await chrome.contextMenus.create({
      id: CONTEXT_MENU_SAVE_ID,
      title: chrome.i18n.getMessage("contextMenuSave") || "保存至货觉AI",
      contexts: ["all"],
      // 先在 HTTP/HTTPS 页面创建，再由 onShown 按站点开关与图片目标动态过滤
      documentUrlPatterns: ["http://*/*", "https://*/*"]
    });
    debugLog("service-worker", "context-menu", "右键菜单已准备完成", {
      menuId: CONTEXT_MENU_SAVE_ID
    });
  } catch (error) {
    debugError("service-worker", "context-menu", "创建右键菜单失败", error);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_SAVE_ID || !Number.isInteger(tab?.id)) {
    return;
  }

  const traceId = createTraceId();
  void resolveContextMenuImageContext(info, tab.id, traceId).then((context) => {
    if (!context.imageUrl) {
      return sendToTab(tab.id, {
        type: CONTEXT_MENU_RESULT_MESSAGE,
        traceId,
        ok: false,
        error: "未找到当前 item 中的图片，请右键图片卡片后重试。"
      });
    }
    return handleContextMenuSave(context, tab, traceId);
  });
});

// 右键菜单打开前按当前页面的屏蔽规则与站点开关决定是否展示菜单项
if (chrome.contextMenus.onShown?.addListener) {
  chrome.contextMenus.onShown.addListener((info, tab) => {
    if (!Number.isInteger(tab?.id)) return;

    void resolveContextMenuVisibility(info, tab)
      .then((visible) =>
        chrome.contextMenus.update(CONTEXT_MENU_SAVE_ID, { visible })
      )
      .catch(() =>
        chrome.contextMenus.update(CONTEXT_MENU_SAVE_ID, { visible: false })
      )
      .finally(() => chrome.contextMenus.refresh());
  });
}

chrome.tabs.onActivated.addListener(({ tabId }) =>
  void refreshContextMenuVisibility(tabId)
);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    void refreshContextMenuVisibility(tabId, tab.url);
  }
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[DISABLED_HOSTS_STORAGE_KEY]) return;

  void chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(([tab]) => refreshContextMenuVisibility(tab?.id, tab?.url));
});

async function resolveContextMenuVisibility(info, tab) {
  const pageUrl = parseHttpUrl(tab.url);
  if (!pageUrl || isSiteHostname(pageUrl.hostname)) {
    return false;
  }
  if (!(await isSiteEnabled(pageUrl.hostname))) {
    return false;
  }

  // 图片上的右键直接用 srcUrl；卡片右键则问内容脚本当前被右键的是哪张图
  const isDirectImage =
    info.mediaType === "image" && Boolean(normalizeImageSource(info.srcUrl));
  if (isDirectImage) {
    return true;
  }

  const target = await chrome.tabs
    .sendMessage(tab.id, { type: GET_CONTEXT_TARGET_MESSAGE })
    .catch(() => null);
  return Boolean(target?.imageUrl);
}

async function refreshContextMenuVisibility(tabId, tabUrl) {
  if (!Number.isInteger(tabId)) return;

  const url = tabUrl ?? (await getTabUrl(tabId));
  const pageUrl = parseHttpUrl(url);
  let visible = Boolean(pageUrl && !isSiteHostname(pageUrl.hostname));
  if (visible) {
    visible = await isSiteEnabled(pageUrl.hostname);
  }
  await chrome.contextMenus
    .update(CONTEXT_MENU_SAVE_ID, { visible })
    .catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS[message?.type];
  if (!handler) {
    return false;
  }

  const traceId = createTraceId(message.traceId);
  Promise.resolve()
    .then(() => handler(message, sender, traceId))
    .then((payload) => sendResponse({ ok: true, traceId, ...payload }))
    .catch((error) =>
      sendResponse({
        ok: false,
        traceId,
        ...loginErrorFields(error),
        error: toErrorMessage(error)
      })
    );

  // 保持消息通道，等待异步处理完成
  return true;
});

const MESSAGE_HANDLERS = {
  [AUTH_STATE_MESSAGE]: handleAuthState,

  [GET_USER_INFO_MESSAGE]: async (message, sender, traceId) => {
    const tabId = resolveRequestTabId(message, sender);
    const { token } = await withLoginRecovery(tabId, traceId, {
      openLogin: false
    });
    return { user: await getCurrentUser({ token, traceId }) };
  },

  [GET_PROJECTS_MESSAGE]: (message, sender, traceId) =>
    getProjectsForTab(resolveRequestTabId(message, sender), traceId, {
      openLogin: message.openLoginOnRequired !== false
    }),

  [CREATE_PROJECT_MESSAGE]: async (message, sender, traceId) => {
    const tabId = resolveRequestTabId(message, sender);
    const { token } = await withLoginRecovery(tabId, traceId);
    const project = await createProject(
      { name: message.name },
      { token, traceId }
    );
    return { project };
  },

  [MOVE_ASSETS_MESSAGE]: async (message, sender, traceId) => {
    const tabId = resolveRequestTabId(message, sender);
    const { token } = await withLoginRecovery(tabId, traceId);
    const result = await moveAssetsToProject(
      { assetIds: message.assetIds, projectId: message.projectId },
      { token, traceId }
    );
    return { result };
  },

  [OPEN_LOGIN_MESSAGE]: async (message, sender, traceId) => {
    const loginUrl = await openLoginPage({
      returnTabId: resolveRequestTabId(message, sender),
      traceId
    });
    return { loginUrl };
  },

  [OPEN_PAGE_MESSAGE]: (message, sender, traceId) =>
    openAppPage(message, resolveRequestTabId(message, sender), traceId),

  [REPLICATE_IMAGE_MESSAGE]: (message, sender, traceId) => {
    if (!sender.tab || !normalizeImageSource(message.imageUrl)) {
      throw new Error("无效的图片复刻请求。");
    }
    return handleReplicateRequest(message.imageUrl, sender.tab.id, traceId);
  },

  [CAPTURE_IMAGE_MESSAGE]: (message, sender, traceId) => {
    if (!sender.tab || !normalizeImageSource(message.imageUrl)) {
      throw new Error("无效的图片采集请求。");
    }
    return handleCaptureRequest(message, sender.tab, traceId);
  }
};

async function handleCaptureRequest(message, tab, traceId) {
  const startedAt = Date.now();
  debugLog("service-worker", traceId, "收到图片采集请求", {
    imageUrl: describeUrl(message.imageUrl),
    tabId: tab.id
  });

  try {
    const result = await captureImageForUser(message, tab, traceId);
    debugLog("service-worker", traceId, "图片采集完成", {
      assetId: result.assetId,
      durationMs: Date.now() - startedAt,
      projectId: result.projectId,
      resultUrl: describeUrl(result.url)
    });
    return result;
  } catch (error) {
    debugError("service-worker", traceId, "图片采集失败", error, {
      durationMs: Date.now() - startedAt,
      loginRequired: isUserLoginRequiredError(error)
    });
    throw error;
  }
}

/**
 * 单张采集：取令牌 → 定分组 → 上传 → 回传素材信息。
 *
 * 登录失效时先打开登录页再抛回：原页面保留采集弹层，
 * 用户登录回来后点「重试」即可续传，不必重新找回那张图。
 */
async function captureImageForUser(message, tab, traceId) {
  const { token, user } = await withLoginRecovery(tab.id, traceId);
  await registerUserSessionConsumer(tab.id, { traceId });

  const projects = await listProjects({ token, traceId }).catch(() => []);
  const preferred = projects.find(
    (project) => project.projectId === message.projectId
  );
  const project =
    preferred ??
    (await resolveCaptureProject({ userId: user.userId, token, traceId }));

  const asset = await uploadCapturedImage(message.imageUrl, {
    token,
    traceId,
    projectId: project.projectId,
    source: createSourceContext(tab, message)
  });

  return { ...asset, projectId: project.projectId, projectName: project.name };
}

/**
 * 图片复刻：先把图存进素材库，再打开复刻页并把素材 id 带过去。
 *
 * 生成接口吃的是 `inputAssetIds`（素材 id）而不是图片 URL，
 * 所以必须走真实上传；前端约定参数为 `/viral-clone?referenceAssetId=xxx`。
 */
async function handleReplicateRequest(imageUrl, tabId, traceId) {
  const { token, user } = await withLoginRecovery(tabId, traceId);
  await registerUserSessionConsumer(tabId, { traceId });

  // 复刻前必须先有产物：落到用户的上次分组（无则默认分组），之后可在素材库改
  const project = await resolveCaptureProject({
    userId: user.userId,
    token,
    traceId
  });
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const asset = await uploadCapturedImage(imageUrl, {
    token,
    traceId,
    projectId: project.projectId,
    source: createSourceContext(tab, {})
  });

  const targetUrl = new URL(REPLICATE_URL);
  targetUrl.searchParams.set("referenceAssetId", asset.assetId);
  await chrome.tabs.create({ active: true, url: targetUrl.href });

  debugLog("service-worker", traceId, "复刻页面已打开", {
    assetId: asset.assetId,
    targetUrl: describeUrl(targetUrl.href)
  });
  return { assetId: asset.assetId, url: asset.url, targetUrl: targetUrl.href };
}

/**
 * 打开站点页面。
 *
 * `library` 带上分组参数：素材库对 `?projectId=` 直接分组到该组，
 * 用户点「查看」看到的正是刚采集的那批图，而不是整个素材库。
 */
async function openAppPage(message, tabId, traceId) {
  const baseUrl = {
    library: LIBRARY_URL,
    workbench: WORKBENCH_URL,
    login: LOGIN_URL
  }[message?.page];

  if (!baseUrl) {
    throw new Error("不支持的站点页面跳转请求。");
  }

  const targetUrl = new URL(baseUrl);
  const projectId = normalizeProjectId(message.projectId);
  if (message.page === "library" && projectId) {
    targetUrl.searchParams.set("projectId", projectId);
  }

  await chrome.tabs.create({ active: true, url: targetUrl.href });
  debugLog("service-worker", traceId, "站点页面已打开", {
    page: message.page,
    projectId,
    targetUrl: describeUrl(targetUrl.href)
  });
  return { targetUrl: targetUrl.href };
}

async function getProjectsForTab(tabId, traceId, { openLogin = true } = {}) {
  const { token, user } = await withLoginRecovery(tabId, traceId, { openLogin });
  await registerUserSessionConsumer(tabId, { traceId });

  const projects = await listProjects({ token, traceId });
  const selectedProject = await resolveCaptureProject({
    userId: user.userId,
    token,
    traceId
  }).catch((error) => {
    // 读不到「上次分组」不该阻断用户选分组，降级为列表第一项
    debugWarn("service-worker", traceId, "解析当前分组失败", {
      error: toErrorMessage(error)
    });
    return projects[0] ?? null;
  });

  return { projects, selectedProject };
}

/**
 * 取令牌与用户资料；登录失效时按需打开登录页，再把错误原样抛回。
 *
 * 就地重试没有意义：登录是新标签页里的异步动作，
 * 当前这次请求早已超时 —— 交给用户登录回来后重新发起。
 *
 * `openLogin=false` 用于被动查询（弹窗初始化、分组列表预取）：
 * 用户只是把鼠标移上去看一眼，不该凭空弹出登录页。
 */
async function withLoginRecovery(tabId, traceId, { openLogin = true } = {}) {
  try {
    const token = await getUserToken(tabId, { traceId });
    try {
      const user = await getCurrentUser({ token, traceId });
      return { token, user };
    } catch (error) {
      if (!isUserLoginRequiredError(error)) throw error;
      if (openLogin) await attemptOpenLogin(tabId, traceId, "令牌失效");
      throw error;
    }
  } catch (error) {
    if (isUserLoginRequiredError(error) && openLogin) {
      await attemptOpenLogin(tabId, traceId, "未登录");
    }
    throw error;
  }
}

async function attemptOpenLogin(tabId, traceId, reason) {
  try {
    await openLoginPage({ returnTabId: tabId, traceId });
  } catch (error) {
    debugError("service-worker", traceId, `${reason}后打开登录页失败`, error);
  }
}

async function handleAuthState(message, sender, traceId) {
  // 只接受本站页面上报：令牌来自 localStorage，来源必须可信
  if (!isFrontendPageUrl(sender.url || sender.tab?.url)) {
    throw new Error("拒绝非本站页面上报登录状态。");
  }

  const token = message.authenticated === true ? message.token : null;
  const state = await updateLoginState(token, { traceId });

  if (state.loggedOut || state.userChanged) {
    await clearRecentProjects();
    debugLog("service-worker", traceId, "已清除旧账号的最近分组", {
      loggedOut: state.loggedOut,
      userChanged: state.userChanged
    });
  }

  if (state.authenticated && Number.isInteger(state.returnTabId)) {
    await notifyTab(state.returnTabId, {
      type: LOGIN_DETECTED_MESSAGE,
      traceId
    });
  }

  if (state.loggedOut && state.affectedTabIds.length > 0) {
    const results = await Promise.allSettled(
      state.affectedTabIds.map((tabId) =>
        notifyTab(tabId, { type: LOGOUT_DETECTED_MESSAGE, traceId })
      )
    );
    debugLog("service-worker", traceId, "已广播退出登录", {
      failedCount: results.filter(({ status }) => status === "rejected").length,
      notifiedTabCount: results.length
    });
  }

  return {
    authenticated: state.authenticated,
    loggedOut: state.loggedOut,
    userChanged: state.userChanged
  };
}

async function handleContextMenuSave(context, tab, traceId) {
  const tabId = tab.id;
  await notifyTab(tabId, {
    type: CONTEXT_MENU_PROGRESS_MESSAGE,
    traceId,
    imageUrl: context.imageUrl,
    sourceTitle: context.sourceTitle,
    sourcePageUrl: context.sourcePageUrl
  });

  try {
    const { selectedProject } = await getProjectsForTab(tabId, traceId);
    const capture = await captureImageForUser(
      {
        imageUrl: context.imageUrl,
        projectId: selectedProject?.projectId,
        sourceTitle: context.sourceTitle,
        sourcePageUrl: context.sourcePageUrl
      },
      tab,
      traceId
    );
    await notifyTab(tabId, {
      type: CONTEXT_MENU_RESULT_MESSAGE,
      traceId,
      ok: true,
      imageUrl: context.imageUrl,
      sourceTitle: context.sourceTitle,
      sourcePageUrl: context.sourcePageUrl,
      url: capture.url,
      assetId: capture.assetId,
      projectId: capture.projectId,
      projectName: capture.projectName
    });
  } catch (error) {
    await notifyTab(tabId, {
      type: CONTEXT_MENU_RESULT_MESSAGE,
      traceId,
      ok: false,
      imageUrl: context.imageUrl,
      sourceTitle: context.sourceTitle,
      sourcePageUrl: context.sourcePageUrl,
      ...loginErrorFields(error),
      error: toErrorMessage(error)
    });
  }
}

async function resolveContextMenuImageContext(info, tabId, traceId) {
  const target = await chrome.tabs
    .sendMessage(tabId, { type: GET_CONTEXT_TARGET_MESSAGE, traceId })
    .catch((error) => {
      // 内容脚本未就绪时仅在有 srcUrl 的情况下继续，否则等于没目标
      if (!normalizeImageSource(info.srcUrl)) {
        debugError("service-worker", traceId, "读取右键目标失败", error);
      }
      return null;
    });

  // 右键在链接上而图片另有来源时，链接本身就是商品页，比页面地址更精确
  const linkUrl = parseHttpUrl(info.linkUrl);
  const pageUrl =
    linkUrl && linkUrl !== info.srcUrl
      ? linkUrl
      : parseHttpUrl(target?.sourcePageUrl) || "";

  return {
    imageUrl:
      normalizeImageSource(info.srcUrl) ||
      normalizeImageSource(target?.imageUrl) ||
      "",
    sourceTitle:
      typeof target?.sourceTitle === "string" ? target.sourceTitle.trim() : "",
    sourcePageUrl: pageUrl
  };
}

/**
 * 采集来源上下文：站点名 / 页面标题 / 商品页地址。
 *
 * 三者只用于溯源展示，服务端不会据此抓取或鉴权；
 * 任何一项读不到都不该让整次采集失败。
 */
function createSourceContext(tab, { sourceTitle, sourcePageUrl } = {}) {
  const title = normalizeOptionalString(sourceTitle);
  const pageUrl =
    parseHttpUrl(sourcePageUrl) || parseHttpUrl(tab?.url) || null;
  const siteUrl = parseHttpUrl(tab?.url) || pageUrl;

  return {
    ...(siteUrl
      ? { sourceSite: new URL(siteUrl).hostname.replace(/^www\./i, "") }
      : {}),
    ...(title ? { sourceTitle: title } : {}),
    ...(pageUrl ? { sourcePageUrl: pageUrl } : {})
  };
}

async function notifyTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    debugError(
      "service-worker",
      message.traceId,
      "向页面投递消息失败（不影响后台结果）",
      error
    );
  }
}

async function isSiteEnabled(hostname) {
  const host = String(hostname || "").toLowerCase();
  const stored = await chrome.storage.local
    .get(DISABLED_HOSTS_STORAGE_KEY)
    .catch(() => ({}));
  const disabledHosts = normalizeDisabledHosts(
    stored[DISABLED_HOSTS_STORAGE_KEY]
  );
  return disabledHosts[host] !== true;
}

function normalizeDisabledHosts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([host, disabled]) => typeof host === "string" && disabled === true
    )
  );
}

async function getTabUrl(tabId) {
  return (await chrome.tabs.get(tabId).catch(() => null))?.url ?? "";
}

/**
 * 校验并原样返回图片地址。
 *
 * 允许 `data:`：部分站点把图内联成 data URL，按 HTTP 收紧会直接判定「无图」；
 * `blob:` 不行 —— blob 属于页面上下文，Service Worker 下载不到。
 */
function normalizeImageSource(value) {
  if (typeof value !== "string") return "";
  const source = value.trim();
  if (!source) return "";
  if (/^data:image\//i.test(source)) return source;
  return parseHttpUrl(source) || "";
}

function parseHttpUrl(value) {
  if (typeof value !== "string" || !value) {
    return null;
  }
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeProjectId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value.trim())
    ? value.trim()
    : null;
}

function loginErrorFields(error) {
  return { loginRequired: isUserLoginRequiredError(error) };
}

function toErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message.trim();
  }
  return "保存失败，请稍后重试。";
}

function resolveRequestTabId(message, sender) {
  if (Number.isInteger(sender.tab?.id)) {
    return sender.tab.id;
  }
  return Number.isInteger(message?.tabId) ? message.tabId : null;
}
