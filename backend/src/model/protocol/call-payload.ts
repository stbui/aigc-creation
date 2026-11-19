/**
 * 调用记录中的请求 / 响应报文预览。
 *
 * 后台「调用记录」详情要能直接看到**提示词**与**上游返回的正文**，所以这里
 * 不做按字段名的脱敏，只做两件事：
 *
 *   1. 折叠内嵌媒体（`data:` URL、base64 字段）——一张 1 MB 的图既看不了也存不起；
 *   2. 截断超长报文并写明原始长度，避免单行把 TEXT 列撑到几十 MB。
 *
 * 安全边界在访问控制层，不在写入层：报文只经 `GET /admin/api-logs/:id`
 * （`model.call_read`）下发，列表与 CSV 导出都不含报文；上游凭证由服务端注入
 * 请求头，不进入 `spec.body`。中转路径另见 `proxy.payload.formatCallPayload`。
 *
 * 三条写入路径（生成任务、后台连通性测试、文本工具）共用这里的上限，避免
 * 「任务页能看到完整响应、调用记录页只剩 4 KB」这种口径分裂。
 */

/** 入库报文上限（字符）。超过即截断并写明原始长度 */
export const CALL_PAYLOAD_PREVIEW_CHARS = 256 << 10;

const INLINE_MEDIA = /(data:[^;"]+;base64,)[A-Za-z0-9+/=]{64,}/g;

/** 截断到报文上限：不从代理对中间切开，否则前端会出现半个字符 */
export function truncateCallPayload(value: string, limit = CALL_PAYLOAD_PREVIEW_CHARS): string {
  const text = String(value ?? '');
  if (text.length <= limit) return text;
  const marker = `… [报文已截断，原始长度 ${text.length} 字符]`;
  let cut = Math.max(0, limit - marker.length);
  while (cut > 0 && isLowSurrogate(text.charCodeAt(cut))) cut -= 1;
  return `${text.slice(0, cut)}${marker}`;
}

/** JSON 请求体预览：Buffer 只报体积，内联 base64 折叠 */
export function previewCallPayload(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (Buffer.isBuffer(value)) return `<binary ${value.length} bytes>`;
  try {
    return truncateCallPayload(JSON.stringify(value).replace(INLINE_MEDIA, '$1…'));
  } catch {
    return truncateCallPayload(String(value));
  }
}

/** 非 JSON 预览：文本原样截断，二进制只报体积 */
export function previewCallText(value: unknown): string {
  return truncateCallPayload(String(value ?? ''));
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
