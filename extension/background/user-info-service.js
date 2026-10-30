import { createTraceId, debugLog } from "./debug-log.js";
import { requestJson } from "./api-client.js";

const PROFILE_PATH = "/me";

/**
 * 读取当前令牌对应的账号资料（`GET /api/v1/me`）。
 *
 * 只取扩展界面真正会展示的字段：站点资料没有头像字段
 * （`account.service.ts profile()` 只返回 id/email/name/phone/status/时间），
 * 弹窗用昵称首字兜底，不要在这里编一个 avatar。
 *
 * 返回值里的 `userId` 用于「记住上次采集分组」的本地偏好键 ——
 * 换账号时偏好不能串。
 */
export async function getCurrentUser({ token, traceId: providedTraceId } = {}) {
  const traceId = createTraceId(providedTraceId);
  debugLog("user-info", traceId, "开始获取用户资料");

  const { data } = await requestJson(PROFILE_PATH, {
    token,
    traceId,
    scope: "user-info"
  });

  const userId = normalizeOptionalString(data?.id);
  if (!userId) {
    throw new Error("用户资料接口未返回用户 ID。");
  }

  const user = {
    userId,
    name: normalizeOptionalString(data?.name),
    email: normalizeOptionalString(data?.email),
    phone: normalizeOptionalString(data?.phone),
    status: normalizeOptionalString(data?.status),
    counts: normalizeCounts(data?.counts),
    unread: Number.isFinite(data?.unread) ? data.unread : 0
  };

  debugLog("user-info", traceId, "用户资料获取完成", {
    hasEmail: Boolean(user.email),
    hasName: Boolean(user.name),
    assetCount: user.counts.assets
  });
  return user;
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCounts(value) {
  const read = (key) =>
    Number.isFinite(value?.[key]) && value[key] >= 0 ? value[key] : 0;
  return {
    projects: read("projects"),
    tasks: read("tasks"),
    assets: read("assets"),
    orders: read("orders")
  };
}
