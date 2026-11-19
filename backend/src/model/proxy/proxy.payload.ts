/**
 * 中转报文入库格式与用量提取。
 *
 * 调用记录要能排障：管理员在后台能直接看到**请求里的提示词**与**上游返回的正文**。
 * 因此这里不再按字段名抹掉密钥类字段 —— 脱敏只保留「内嵌媒体折叠」，那一步是
 * 为了可读性与表体积（一张 1MB 的 base64 图既看不了也存不起），不是安全过滤。
 *
 * 安全边界改为访问控制：报文只经 `GET /admin/api-logs/:id`（`model.call_read`）
 * 下发，列表与 CSV 导出都不含报文；调用记录按保留期清理（默认 90 天）。
 * 上游凭证由服务端注入请求头，不会出现在报文里；客户端自带的 `?key=` 查询参数
 * 在出站前就被 `stripSecretQuery` 剥离，也不进 `upstreamUrl`。
 *
 * 用量提取与任务路径共用同一套语义：OpenAI / Anthropic / Gemini 三种
 * 字段命名都要认，缺一个就会让 Token 账单结算失败（停在 uncertain）。
 */

/** 入库报文上限：超过即截断并写明原始长度 */
const MAX_PAYLOAD_BYTES = 256 << 10;
/** 源报文上限：超过直接记一行说明，不做解析 */
const MAX_SOURCE_BYTES = 4 << 20;

/** 一次中转请求 / 响应的用量（与 `BillingUsage` 同形） */
export interface ProxyUsage {
  inputTokens: bigint;
  outputTokens: bigint;
  cachedTokens: bigint;
}

const MAX_DETAIL_CHARS = 1000;

/**
 * 生成可入库的报文文本。
 *
 * 不按字段名脱敏：后台详情要看提示词与上游正文。唯一保留的折叠是内嵌媒体
 * （data URL / base64 字段 / multipart 文件），它们既不适合展示也会把表撑大。
 *
 * @param data        原始报文
 * @param contentType 请求头里的类型；响应可传空串，由内容嗅探
 */
export function sanitizeCallPayload(data: Buffer, contentType = ''): string {
  if (!data || data.length === 0) return '';
  const mediaType = mediaTypeOf(contentType) || sniffMediaType(data);
  if (mediaType === 'multipart/form-data') {
    return sanitizeMultipart(data, contentType);
  }
  if (data.length > MAX_SOURCE_BYTES) {
    return `[报文过大，未入库，共 ${data.length} 字节]`;
  }
  const text = data.toString('utf8');
  const json = tryJson(text);
  if (json !== undefined) {
    return truncate(toPrettyJson(foldInlineMedia(json)));
  }
  if (isBinaryMedia(mediaType)) {
    return `[${mediaType || '未知类型'} 二进制报文，共 ${data.length} 字节]`;
  }
  return truncate(text);
}

/**
 * Token 计费的流式 Chat Completions 请求强制开启最终 usage 块。
 *
 * OpenAI 兼容上游默认不在流式响应里返回 usage；账单按 Token 结算时拿不到
 * 用量只能转 uncertain。非流式请求原样返回，避免改变普通接口合同；已有的
 * `stream_options` 保留其余字段，只补 `include_usage=true`。
 */
export function ensureChatCompletionStreamUsage(body: Buffer): Buffer {
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('请求报文必须是 JSON 对象');
    }
    payload = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === '请求报文必须是 JSON 对象') throw error;
    throw new Error('请求报文不是合法 JSON');
  }
  if (payload.stream !== true) return body;
  const current = payload.stream_options;
  if (current !== undefined && current !== null && (typeof current !== 'object' || Array.isArray(current))) {
    throw new Error('stream_options 必须是 JSON 对象');
  }
  payload.stream_options = { ...(current as Record<string, unknown> | undefined), include_usage: true };
  return Buffer.from(JSON.stringify(payload));
}

/** 从响应体提取用量：整段 JSON 或 SSE 的最后一条 usage 事件 */
export function extractProxyUsage(body: Buffer, streamed: boolean): ProxyUsage | null {
  if (!body || body.length === 0) return null;
  const text = body.toString('utf8');
  const direct = usageFromJson(text);
  if (direct) return direct;
  if (!streamed) return null;

  // SSE：逐事件解析，取最后一次出现的 usage（多段增量里通常只有末段带用量）
  let found: ProxyUsage | null = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;
    const usage = usageFromJson(payload);
    if (usage) found = usage;
  }
  return found;
}

function usageFromJson(text: string): ProxyUsage | null {
  const parsed = tryJson(String(text ?? '').trim());
  if (parsed === undefined || parsed === null || typeof parsed !== 'object') return null;
  const payload = parsed as Record<string, any>;
  const usage = payload.usage ?? payload.usageMetadata;
  if (!usage || typeof usage !== 'object') return null;

  const pick = (...keys: string[]): number => {
    for (const key of keys) {
      const value = usage[key];
      if (value === undefined || value === null || value === '') continue;
      const parsedValue = Number(value);
      if (Number.isFinite(parsedValue) && parsedValue >= 0) return Math.trunc(parsedValue);
    }
    return -1;
  };

  const input = pick('prompt_tokens', 'input_tokens', 'promptTokenCount', 'promptTokens', 'inputTokens');
  const output = pick('completion_tokens', 'output_tokens', 'candidatesTokenCount', 'completionTokens', 'outputTokens');
  const cachedRaw = usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens;
  const cached =
    cachedRaw !== undefined && cachedRaw !== null && cachedRaw !== ''
      ? Math.max(0, Math.trunc(Number(cachedRaw) || 0))
      : pick('cache_read_input_tokens', 'cachedContentTokenCount', 'cachedTokens');
  if (input < 0 && output < 0) return null;
  return {
    inputTokens: BigInt(Math.max(0, input)),
    outputTokens: BigInt(Math.max(0, output)),
    cachedTokens: BigInt(Math.max(0, cached)),
  };
}

/** 上游请求 id：异步结果查询与排障依赖它 */
export function extractProviderRequestId(body: Buffer): string {
  if (!body || body.length === 0) return '';
  const parsed = tryJson(body.toString('utf8'));
  if (parsed === undefined || parsed === null || typeof parsed !== 'object') return '';
  const payload = parsed as Record<string, any>;
  for (const key of ['id', 'task_id', 'taskId', 'request_id', 'requestId']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim().slice(0, 200);
  }
  return '';
}

/** 产物数量（图片 / 视频 / 音频数组长度），供调用记录统计 */
export function extractMediaCount(body: Buffer): number {
  if (!body || body.length === 0) return 0;
  const parsed = tryJson(body.toString('utf8'));
  if (parsed === undefined || parsed === null || typeof parsed !== 'object') return 0;
  const payload = parsed as Record<string, any>;
  const arrays = [payload.data, payload.images, payload.videos, payload.audios, payload.image_urls, payload.output];
  return arrays.reduce<number>((total, item) => total + (Array.isArray(item) ? item.length : 0), 0);
}

// ── 内部 ──────────────────────────────────────────────────────────

/**
 * 折叠内嵌媒体，其余字段原样保留。
 *
 * 只看值形态与字段名，不看 `authorization` / `secret` 这类词 —— 报文里出现的
 * 提示词、模型输出、上下游正文一律保留，后台详情直接展示。
 */
function foldInlineMedia(value: any, key = ''): any {
  const normalizedKey = String(key ?? '').toLowerCase().replace(/[_-]/g, '');
  if (Array.isArray(value)) return value.map((item) => foldInlineMedia(item, key));
  if (value && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = foldInlineMedia(childValue, childKey);
    }
    return result;
  }
  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      const media = value.slice(5).split(';')[0];
      return `[内嵌媒体 ${media || '未知类型'}，共 ${value.length} 字符]`;
    }
    if (normalizedKey.includes('base64') || normalizedKey.includes('b64')) {
      return `[内嵌编码数据，共 ${value.length} 字符]`;
    }
  }
  return value;
}

function sanitizeMultipart(data: Buffer, contentType: string): string {
  const boundary = /boundary=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/^"|"$/g, '');
  if (!boundary) return '[multipart 请求报文无法解析]';
  const delimiter = Buffer.from(`--${boundary}`);
  const fields: Record<string, any> = {};
  let offset = data.indexOf(delimiter);
  let index = 0;
  while (offset >= 0 && index < 100) {
    index += 1;
    const partStart = offset + delimiter.length;
    if (data.slice(partStart, partStart + 2).toString() === '--') break;
    const headerEnd = data.indexOf('\r\n\r\n', partStart);
    if (headerEnd < 0) break;
    const next = data.indexOf(delimiter, headerEnd + 4);
    if (next < 0) break;
    const headers = data.slice(partStart, headerEnd).toString('utf8');
    const name = /name="([^"]+)"/i.exec(headers)?.[1] ?? `field${index}`;
    const fileName = /filename="([^"]*)"/i.exec(headers)?.[1] ?? '';
    const content = data.slice(headerEnd + 4, next);
    fields[name] = fileName
      ? { fileName, contentType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] ?? '', size: content.length }
      : foldInlineMedia(content.toString('utf8').slice(0, MAX_PAYLOAD_BYTES + 1), name);
    offset = next;
  }
  return truncate(toPrettyJson(fields));
}

function toPrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(value: string): string {
  if (value.length <= MAX_PAYLOAD_BYTES) return value;
  let cut = MAX_PAYLOAD_BYTES;
  // 不能从代理对中间切断，否则前端 JSON 视图会出现半个字符
  while (cut > 0 && isLowSurrogate(value.charCodeAt(cut))) cut -= 1;
  return `${value.slice(0, cut)}\n[报文已截断，原始长度 ${value.length} 字符]`;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function tryJson(text: string): any {
  if (!text || (text[0] !== '{' && text[0] !== '[')) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isBinaryMedia(mediaType: string): boolean {
  return (
    mediaType.startsWith('image/') ||
    mediaType.startsWith('video/') ||
    mediaType.startsWith('audio/') ||
    mediaType === 'application/octet-stream'
  );
}

function mediaTypeOf(contentType: string): string {
  return String(contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
}

/** 按魔数粗略判断：代理响应常常缺 Content-Type */
function sniffMediaType(data: Buffer): string {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && data.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.length >= 12 && data.slice(0, 4).toString() === 'RIFF' && data.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (data.length >= 5 && data.slice(0, 5).toString() === '%PDF-') return 'application/pdf';
  return '';
}
