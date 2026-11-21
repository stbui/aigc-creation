import type { ChannelHeader } from './constants';

/** 与 `backend/src/model/infra/outbound.ts` 的 `DEFAULT_USER_AGENT` 保持一致 */
export const DEFAULT_USER_AGENT = 'huojue/1.0';
export const MAX_HEADER_COUNT = 32;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_NAME_LENGTH = 128;
const MAX_VALUE_LENGTH = 4096;
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** 与后端 `blockedOutboundHeader` 同一份名单：这些头由出站层或协议适配器写入 */
const BLOCKED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'host',
  'content-length',
  'content-type',
  'accept',
  'connection',
  'proxy-connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'forwarded',
  'x-goog-api-key',
]);

/** 值里只允许可打印 ASCII 与横向制表符（与后端逐字符判定一致） */
function hasControlChar(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 9 || (code >= 32 && code !== 127)) continue;
    return true;
  }
  return false;
}

/**
 * 返回第一条错误文案；空串表示通过。
 *
 * 空行（名称与值都为空）直接跳过，不算错误 —— 用户点了「添加请求头」还没填时
 * 不应该被报错打断。
 */
export function validateChannelHeaders(headers: ChannelHeader[]): string {
  if (headers.length === 0) return '';
  if (headers.length > MAX_HEADER_COUNT) return `附加信息最多支持 ${MAX_HEADER_COUNT} 项`;
  const seen = new Set<string>();
  let total = 0;
  for (const header of headers) {
    const name = header.name.trim();
    const value = header.value.trim();
    if (!name && !value) continue;
    if (!name || !HEADER_NAME_PATTERN.test(name)) {
      return '附加信息名称无效，请检查名称格式';
    }
    const lower = name.toLowerCase();
    if (BLOCKED_HEADERS.has(lower) || lower.startsWith('x-canvas-') || lower.startsWith('x-forwarded-')) {
      return `${name} 由系统管理，不允许自定义`;
    }
    if (seen.has(lower)) return `附加信息不能重复：${name}`;
    if (hasControlChar(value)) return `${name} 的内容包含不支持的字符`;
    if (name.length > MAX_NAME_LENGTH || value.length > MAX_VALUE_LENGTH) {
      return '单项附加信息名称或内容过长';
    }
    total += name.length + value.length;
    if (total > MAX_HEADER_BYTES) return '附加信息总计不能超过 16KB';
    seen.add(lower);
  }
  return '';
}

/** 提交前裁掉首尾空白并丢弃空行，与服务端 `normalizeOutboundHeaders` 的落库形态一致 */
export function normalizeChannelHeaders(headers: ChannelHeader[]): ChannelHeader[] {
  return headers
    .map((header) => ({ name: header.name.trim(), value: header.value.trim() }))
    .filter((header) => header.name !== '' || header.value !== '');
}
