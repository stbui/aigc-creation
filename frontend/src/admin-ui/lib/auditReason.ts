/**
 * 后台审计原因统一由操作上下文生成。
 *
 * 后台表单不再要求运营手填原因；这里仍为需要 reason 的既有接口提供一段
 * 可读、可追溯的默认值，避免把审计字段留空或破坏 API 兼容性。
 */
const MAX_AUDIT_REASON_LENGTH = 200;

export function auditReason(action: string): string {
  const normalized = action.trim() || '后台操作';
  const text = `后台操作：${normalized}`;
  return text.length > MAX_AUDIT_REASON_LENGTH
    ? `${text.slice(0, MAX_AUDIT_REASON_LENGTH - 1)}…`
    : text;
}
