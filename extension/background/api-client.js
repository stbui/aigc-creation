import {
  createTraceId,
  debugError,
  debugLog,
  describeUrl
} from "./debug-log.js";
import { API_BASE_URL } from "./environment.js";

const DEFAULT_TIMEOUT_MS = 15000;

/** 后端「未认证 / 令牌失效 / 密码已变更 / 账号禁用」的错误码 */
const LOGIN_REQUIRED_CODES = new Set([40101, 40102, 40302]);

/**
 * 用户未登录或登录已失效。
 *
 * 名字与 code 刻意与 `user-session.js` 的判定保持同一套：上层只认
 * `isUserLoginRequiredError()`，任何一层抛出的登录错误都能触发登录引导。
 */
export class UserLoginRequiredError extends Error {
  constructor(message = "未检测到登录状态，请先登录后重试。") {
    super(message);
    this.name = "UserLoginRequiredError";
    this.code = "HUOJUE_LOGIN_REQUIRED";
  }
}

/**
 * JSON 请求：自动加鉴权头、超时、拆后端响应信封 `{ code, data, message }`。
 *
 * 成功判定以 **`code === 0`** 为准而不是 HTTP 状态：信封是后端的统一契约，
 * 只看 `response.ok` 会把业务错误当成成功，把 `data` 写成 `{ code: 40101 }`。
 */
export async function requestJson(
  path,
  {
    method = "GET",
    body,
    token,
    traceId: providedTraceId,
    scope = "api-client",
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}
) {
  const traceId = createTraceId(providedTraceId);
  const endpoint = buildEndpoint(path);
  const startedAt = Date.now();
  const headers = buildHeaders({ token, traceId });
  const request = { method, headers };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    request.body = JSON.stringify(body);
  }

  debugLog(scope, traceId, "开始请求后端接口", {
    method,
    endpoint: describeUrl(endpoint)
  });

  try {
    const response = await fetchWithTimeout(endpoint, request, timeoutMs);
    const payload = await readJsonResponse(response);
    const ok = response.ok && payload?.code === 0;

    debugLog(scope, traceId, "后端接口响应", {
      durationMs: Date.now() - startedAt,
      requestId: response.headers.get("x-request-id"),
      status: response.status,
      success: ok
    });

    if (!ok) throw createApiError(response, payload);

    return {
      data: payload?.data ?? null,
      message: payload?.message ?? null,
      requestId: response.headers.get("x-request-id") || null
    };
  } catch (error) {
    debugError(scope, traceId, "后端接口请求失败", error, {
      durationMs: Date.now() - startedAt,
      endpoint: describeUrl(endpoint)
    });
    throw error;
  }
}

/**
 * multipart 请求（素材上传）。
 *
 * 不能复用 `requestJson` 的 JSON 分支：FormData 的 Content-Type 必须由
 * 浏览器自己生成（带 boundary），手写会让服务端解析不到任何字段。
 */
export async function requestForm(
  path,
  formData,
  {
    method = "POST",
    token,
    traceId: providedTraceId,
    scope = "api-client",
    timeoutMs = 60000
  } = {}
) {
  const traceId = createTraceId(providedTraceId);
  const endpoint = buildEndpoint(path);
  const startedAt = Date.now();

  if (typeof token !== "string" || !token.trim()) {
    throw new UserLoginRequiredError();
  }

  debugLog(scope, traceId, "开始上传表单", {
    fields: [...formData.keys()],
    endpoint: describeUrl(endpoint)
  });

  try {
    const response = await fetchWithTimeout(
      endpoint,
      { method, headers: buildHeaders({ token, traceId }), body: formData },
      timeoutMs
    );
    const payload = await readJsonResponse(response);
    const ok = response.ok && payload?.code === 0;

    debugLog(scope, traceId, "表单上传响应", {
      durationMs: Date.now() - startedAt,
      requestId: response.headers.get("x-request-id"),
      status: response.status,
      success: ok
    });

    if (!ok) throw createApiError(response, payload);

    return {
      data: payload?.data ?? null,
      message: payload?.message ?? null,
      requestId: response.headers.get("x-request-id") || null
    };
  } catch (error) {
    debugError(scope, traceId, "表单上传失败", error, {
      durationMs: Date.now() - startedAt,
      endpoint: describeUrl(endpoint)
    });
    throw error;
  }
}

function buildHeaders({ token, traceId }) {
  const headers = {
    Accept: "application/json",
    "Accept-Language": normalizeLanguage(globalThis.navigator?.language),
    "Time-Zone": getTimeZone(),
    "X-Request-Id": traceId
  };
  if (typeof token === "string" && token.trim()) {
    headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

function buildEndpoint(path) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error("接口路径无效。");
  }
  return `${API_BASE_URL}${path}`;
}

/**
 * 把后端失败响应翻译成 Error。
 *
 * 401 / 40101 / 40102 / 40302 一律抛 `UserLoginRequiredError`：上层据此
 * 打开登录页并在登录后自动重试，不需要区分「没登」与「登录过期」。
 */
function createApiError(response, payload) {
  const code = typeof payload?.code === "number" ? payload.code : null;
  if (response.status === 401 || LOGIN_REQUIRED_CODES.has(code)) {
    return new UserLoginRequiredError(
      payload?.message || "登录已失效，请重新登录后重试。"
    );
  }

  const message =
    payload?.message ||
    (response.status === 0
      ? "网络请求失败，请检查网络后重试。"
      : `请求失败（HTTP ${response.status}）。`);
  const error = new Error(message);
  error.name = "HuojueApiError";
  error.code = code ?? "HUOJUE_API_ERROR";
  error.status = response.status;
  return error;
}

function normalizeLanguage(value = "") {
  if (value.toLowerCase().startsWith("zh")) {
    return /tw|hant|hk|mo/i.test(value) ? "zh-TW" : "zh-CN";
  }
  return value.split("-")[0] || "en";
}

function getTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("请求超时，请检查网络后重试。");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
