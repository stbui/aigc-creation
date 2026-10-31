/**
 * 协议请求的传输边界 —— 插件声明请求，宿主负责发出去。
 *
 * 移植自 open-ai-canvas `internal/app/provider_protocol_request.go` 的
 * `executeProtocolBinaryRequest` 一线。这里是声明式插件与网络之间唯一的通道，
 * 因此 URL 校验（SSRF）、凭证注入、超时、体积上限与代理全部在这一层完成：
 * 插件无法通过自定义请求规格绕过其中任何一条。
 *
 * 请求体编码按 `contentType` 分四路，与参考实现一致：JSON、表单、
 * multipart（含素材文件）与二进制（含 data URL 解包）。其余类型直接拒绝，
 * 不做「尽力而为」的转换 —— 猜格式只会让上游报参数错误。
 */

import { Injectable } from '@nestjs/common';
import { OutboundHeader, outboundRequest } from '../infra/outbound';
import { applyProtocolAuth, getHeader, setHeader, type ProtocolCredentials } from './auth';
import type { MediaReference, ProtocolRequestFilePart, ProtocolRequestSpec } from './runtime';

/** 单次上游响应的体积上限（与参考实现 `maxProviderResponseBytes` 一致） */
export const MAX_PROVIDER_RESPONSE_BYTES = 64 << 20;
/** 单次上游请求的超时（与参考实现 `providerHTTPTimeout` 一致） */
export const PROVIDER_HTTP_TIMEOUT_MS = 5 * 60 * 1000;
/** 素材下载体积上限：视频结果可能较大，但仍必须有上界 */
export const MAX_MEDIA_BYTES = 256 << 20;

/** 渠道运行期配置（凭证与出口参数由宿主解密后传入） */
export interface ProtocolChannelRuntime {
  baseUrl: string;
  credentials: ProtocolCredentials;
  /** 渠道级自定义请求头 */
  headers?: OutboundHeader[];
  proxyUrl?: string | null;
  timeoutMs?: number;
  /** 自定义渠道：启用更严格的保留网段判定 */
  strictRelay?: boolean;
}

export interface ProtocolHttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  text: string;
  /** 实际请求地址，供调用记录与排障 */
  url: string;
  durationMs: number;
}

/** 可识别的 API 版本前缀（与参考实现 `channelAPIPrefixes` 一致） */
const CHANNEL_API_PREFIXES = ['/api/plan/v3', '/api/v3', '/api/v1', '/v1beta', '/v1', '/v2', '/v3'];
const DEFAULT_API_PREFIX = '/v1';

function requestApiPrefix(path: string): string {
  const lower = path.toLowerCase();
  for (const prefix of CHANNEL_API_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix}/`) || lower.startsWith(`${prefix}?`) || lower.startsWith(`${prefix}#`)) {
      return prefix;
    }
  }
  return '';
}

function baseApiPrefix(base: string): string {
  const lower = base.toLowerCase().replace(/\/+$/, '');
  for (const prefix of CHANNEL_API_PREFIXES) {
    if (lower === prefix || lower.endsWith(prefix)) return prefix;
  }
  return '';
}

/**
 * 渠道地址 + 协议路径拼接。
 *
 * 渠道地址可能写成 `host` / `host/` / `host/v1` / `host/v1/`：协议路径里显式
 * 写出的版本前缀优先，其次用渠道地址里的版本，最后才补默认 `/v1`。两处都
 * 补一次会得到 `/v1/v1/images/generations`，这是最难排查的一类 404。
 */
export function apiUrl(baseUrl: string, path: string): string {
  return apiUrlWithPrefix(baseUrl, path, DEFAULT_API_PREFIX);
}

/**
 * 同 `apiUrl`，但可指定缺失版本前缀时的默认值。
 *
 * 中转入口按协议决定默认前缀：Gemini 的 REST 版本是 `/v1beta`，其余走 `/v1`。
 * 写死 `/v1` 会让 Gemini 中转稳定 404，而任务路径不受影响 —— 只在代理上复现。
 */
export function apiUrlWithPrefix(baseUrl: string, path: string, defaultPrefix: string): string {
  const base = String(baseUrl ?? '').trim().replace(/\/+$/, '');
  let requestPath = String(path ?? '').trim();
  if (requestPath === '') return base;
  if (!requestPath.startsWith('/')) requestPath = `/${requestPath}`;

  const requestPrefix = requestApiPrefix(requestPath);
  const basePrefix = baseApiPrefix(base);
  if (requestPrefix !== '') {
    if (basePrefix === requestPrefix) return base + requestPath.slice(requestPrefix.length);
    return base.slice(0, base.length - basePrefix.length) + requestPath;
  }
  if (basePrefix !== '') return base + requestPath;
  return base + defaultPrefix + requestPath;
}

/** 把协议请求拼成最终 URL（含 `originPath` 与查询参数） */
export function protocolRequestUrl(baseUrl: string, spec: ProtocolRequestSpec): string {
  let target: URL;
  if (spec.originPath) {
    const base = new URL(String(baseUrl ?? '').trim());
    const requestPath = new URL(spec.path, base);
    base.pathname = requestPath.pathname;
    base.search = requestPath.search;
    base.hash = '';
    target = base;
  } else {
    target = new URL(apiUrl(baseUrl, spec.path));
  }
  for (const [key, values] of Object.entries(spec.query ?? {})) {
    for (const value of values) target.searchParams.append(key, value);
  }
  return target.toString();
}

/** 解析 data URL；不是 data URL 返回 null */
export function decodeDataUrl(value: string): { mimeType: string; data: Buffer } | null {
  const text = String(value ?? '').trim();
  if (!text.startsWith('data:')) return null;
  const comma = text.indexOf(',');
  if (comma < 0) throw new Error('素材 data URL 缺少数据段');
  const meta = text.slice(5, comma);
  const payload = text.slice(comma + 1);
  const mimeType = meta.split(';')[0] || 'application/octet-stream';
  const data = meta.includes(';base64') ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
  return { mimeType, data };
}

/** 素材字节：data URL 直接解包，URL 走统一出站请求下载 */
export async function resolveMediaBytes(reference: MediaReference, channel: ProtocolChannelRuntime): Promise<{ data: Buffer; mimeType: string }> {
  const dataUrl = String(reference.dataUrl ?? '').trim();
  if (dataUrl !== '') {
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) throw new Error('素材声明了 dataUrl 但内容不是 data URL');
    return { data: decoded.data, mimeType: decoded.mimeType || reference.mimeType || '' };
  }
  const url = String(reference.url ?? '').trim();
  if (url === '') throw new Error('素材既没有 url 也没有 dataUrl');
  const response = await outboundRequest(url, {
    method: 'GET',
    timeoutMs: channel.timeoutMs ?? PROVIDER_HTTP_TIMEOUT_MS,
    proxyUrl: channel.proxyUrl ?? null,
    strictRelay: channel.strictRelay ?? false,
    maxBodyBytes: MAX_MEDIA_BYTES,
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`下载素材失败（HTTP ${response.status}）：${url}`);
  }
  const headerType = String(response.headers['content-type'] ?? '').split(';')[0].trim();
  return { data: response.body, mimeType: reference.mimeType || headerType };
}

/** 表单值展开：数组按同名多值展开，标量转字符串 */
function formValues(value: any): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => formValues(item));
  if (typeof value === 'string') return [value];
  if (typeof value === 'boolean') return [value ? 'true' : 'false'];
  if (typeof value === 'number' || typeof value === 'bigint') return [String(value)];
  return [JSON.stringify(value)];
}

function safeFilename(value: string): string {
  const base = String(value ?? '').trim().split(/[/\\]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, '');
  return cleaned === '' ? 'upload.bin' : cleaned;
}

interface MultipartPart {
  name: string;
  filename: string;
  mimeType: string;
  data: Buffer;
}

function encodeMultipart(boundary: string, fields: Array<[string, string]>, parts: MultipartPart[]): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, value] of fields) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name.replace(/"/g, '\\"')}"\r\n\r\n`, 'utf8'));
    chunks.push(Buffer.from(value, 'utf8'));
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  for (const part of parts) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name.replace(/"/g, '\\"')}"; filename="${part.filename.replace(/"/g, '\\"')}"\r\nContent-Type: ${part.mimeType || 'application/octet-stream'}\r\n\r\n`,
        'utf8',
      ),
    );
    chunks.push(part.data);
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return Buffer.concat(chunks);
}

/**
 * 构造请求体与最终 content type。
 * 无请求体时返回空 content type —— 给 GET 带 `Content-Type: application/json`
 * 会让部分上游按「有体但空」处理并返回 400。
 */
export async function buildProtocolRequestBody(
  spec: ProtocolRequestSpec,
  channel: ProtocolChannelRuntime,
): Promise<{ body: Buffer | undefined; contentType: string }> {
  const contentType = String(spec.contentType ?? '').toLowerCase().split(';')[0].trim();
  const files = spec.files ?? [];
  if (spec.body === undefined || spec.body === null) {
    if (files.length === 0) return { body: undefined, contentType: '' };
  }
  switch (contentType) {
    case '':
    case 'application/json': {
      if (spec.body === undefined || spec.body === null) return { body: undefined, contentType: '' };
      return { body: Buffer.from(JSON.stringify(spec.body), 'utf8'), contentType: 'application/json' };
    }
    case 'application/x-www-form-urlencoded': {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(spec.body ?? {})) {
        for (const item of formValues(value)) params.append(key, item);
      }
      return { body: Buffer.from(params.toString(), 'utf8'), contentType };
    }
    case 'multipart/form-data': {
      const boundary = `----yingce${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
      const fields: Array<[string, string]> = [];
      for (const key of Object.keys(spec.body ?? {}).sort()) {
        for (const item of formValues((spec.body ?? {})[key])) fields.push([key, item]);
      }
      const parts: MultipartPart[] = [];
      for (const file of files) parts.push(await resolveFilePart(file, channel));
      return { body: encodeMultipart(boundary, fields, parts), contentType: `multipart/form-data; boundary=${boundary}` };
    }
    case 'application/octet-stream': {
      if (Buffer.isBuffer(spec.body)) return { body: spec.body, contentType };
      if (typeof spec.body === 'string') {
        const decoded = decodeDataUrl(spec.body);
        if (decoded) return { body: decoded.data, contentType: decoded.mimeType || contentType };
        return { body: Buffer.from(spec.body, 'utf8'), contentType };
      }
      throw new Error('二进制协议请求体必须是字节或字符串');
    }
    default:
      throw new Error(`声明式协议暂不支持 ${spec.contentType} 请求体`);
  }
}

async function resolveFilePart(file: ProtocolRequestFilePart, channel: ProtocolChannelRuntime): Promise<MultipartPart> {
  let resolved: { data: Buffer; mimeType: string };
  try {
    resolved = await resolveMediaBytes(file.reference, channel);
  } catch (error) {
    throw new Error(`读取 multipart 文件 ${file.name} 失败：${(error as Error).message}`);
  }
  return {
    name: file.name,
    filename: safeFilename(file.filename ?? file.reference.name ?? ''),
    mimeType: String(file.mimeType ?? '').trim() || resolved.mimeType,
    data: resolved.data,
  };
}

@Injectable()
export class ProtocolExecutor {
  /**
   * 发送一条协议请求。
   *
   * 返回原始响应而不做解析：调用方（同步执行器 / 异步轮询器）各有自己的
   * 解析入口，提前解析会让「上游 4xx 但响应体里带结构化错误」这类情况
   * 丢掉原始 body。
   */
  async send(spec: ProtocolRequestSpec, channel: ProtocolChannelRuntime): Promise<ProtocolHttpResponse> {
    const url = protocolRequestUrl(channel.baseUrl, spec);
    const { body, contentType } = await buildProtocolRequestBody(spec, channel);

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(spec.headers ?? {})) setHeader(headers, name, value);
    if (contentType !== '' && !getHeader(headers, 'content-type')) setHeader(headers, 'Content-Type', contentType);
    // 渠道级自定义头在协议头之后写入：管理员显式配置的覆盖项应当生效
    for (const header of channel.headers ?? []) setHeader(headers, header.name, header.value);

    const target = new URL(url);
    applyProtocolAuth({ method: spec.method, url: target, headers, body }, spec.auth, channel.credentials);

    const startedAt = Date.now();
    const response = await outboundRequest(target.toString(), {
      method: spec.method,
      headers,
      body: body ?? undefined,
      timeoutMs: channel.timeoutMs ?? PROVIDER_HTTP_TIMEOUT_MS,
      proxyUrl: channel.proxyUrl ?? null,
      strictRelay: channel.strictRelay ?? false,
      maxBodyBytes: MAX_PROVIDER_RESPONSE_BYTES,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
      text: response.text,
      url: target.toString(),
      durationMs: Date.now() - startedAt,
    };
  }

  /** 下载一份结果媒体（异步任务成功后，宿主必须持久化临时地址） */
  async download(reference: MediaReference, channel: ProtocolChannelRuntime): Promise<{ data: Buffer; mimeType: string }> {
    return resolveMediaBytes(reference, channel);
  }
}
