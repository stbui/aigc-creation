/**
 * 声明式协议的鉴权注入。
 *
 * 移植自 open-ai-canvas `internal/app/provider_protocol_auth.go`。清单只能声明
 * 「用哪种鉴权 + 凭据字段」，**签名与凭证注入全部由宿主执行** —— 插件拿不到
 * 明文凭据，也无法自定义签名算法绕过渠道安全校验。
 *
 * 支持的驱动与清单声明一一对应：
 *   none / bearer / header(api-key) / query / basic / anthropic /
 *   google-api-key(gemini) / volcengine-v4 / aws-sigv4 / tc3
 * 未声明的驱动一律报错，不静默降级成 Bearer —— 降级会把「密钥错误」变成
 * 「上游返回 401」，排障时看不出是清单写错还是凭证过期。
 */

import { createHash, createHmac } from 'node:crypto';
import type { ManifestAuth } from './types';

export interface ProtocolCredentials {
  apiKey: string;
  secretKey: string;
}

/** 签名目标：方法、最终 URL、已写入的请求头与请求体 */
export interface ProtocolAuthTarget {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: Buffer;
}

/** 大小写不敏感的请求头读取 */
export function getHeader(headers: Record<string, string>, name: string): string {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return '';
}

/** 大小写不敏感的请求头写入（已存在同名头时原地覆盖，不产生两个键） */
export function setHeader(headers: Record<string, string>, name: string, value: string): void {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) {
      headers[key] = value;
      return;
    }
  }
  headers[name] = value;
}

function credentialField(credentials: ProtocolCredentials, field: string | undefined): string {
  const name = String(field ?? '').trim().toLowerCase();
  if (name === 'secretkey' || name === 'secret_key' || name === 'secret') return credentials.secretKey;
  return credentials.apiKey;
}

/** 注入鉴权；返回前 URL 的 query 可能已被改写 */
export function applyProtocolAuth(target: ProtocolAuthTarget, auth: ManifestAuth | undefined, credentials: ProtocolCredentials): void {
  const type = String(auth?.type ?? '').trim().toLowerCase();
  if (type === '') {
    // 未声明鉴权 = 走渠道默认的 Bearer
    setHeader(target.headers, 'Authorization', `Bearer ${credentials.apiKey}`);
    return;
  }
  const credential = credentialField(credentials, auth?.field);
  switch (type) {
    case 'none':
      return;
    case 'bearer': {
      const header = String(auth?.header ?? '').trim() || 'Authorization';
      const prefix = auth?.prefix ?? 'Bearer ';
      setHeader(target.headers, header, prefix + credential);
      return;
    }
    case 'header':
    case 'api-key':
    case 'apikey': {
      const header = String(auth?.header ?? '').trim();
      if (!header) throw new Error('插件 header 鉴权缺少 header 名称');
      setHeader(target.headers, header, (auth?.prefix ?? '') + credential);
      return;
    }
    case 'query': {
      const name = String(auth?.query ?? '').trim() || String(auth?.field ?? '').trim();
      if (!name) throw new Error('插件 query 鉴权缺少参数名');
      target.url.searchParams.set(name, (auth?.prefix ?? '') + credential);
      return;
    }
    case 'basic': {
      const username = auth?.username || credential;
      const password = credentialField(credentials, auth?.secretField);
      setHeader(target.headers, 'Authorization', `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
      return;
    }
    case 'anthropic': {
      setHeader(target.headers, String(auth?.header ?? '').trim() || 'x-api-key', credential);
      if (!getHeader(target.headers, 'anthropic-version')) {
        setHeader(target.headers, 'anthropic-version', '2023-06-01');
      }
      return;
    }
    case 'google-api-key':
    case 'gemini': {
      setHeader(target.headers, String(auth?.header ?? '').trim() || 'x-goog-api-key', credential);
      return;
    }
    case 'volcengine-v4': {
      signVolcengineV4(target, credential, credentialField(credentials, auth?.secretField), auth);
      return;
    }
    case 'aws-sigv4': {
      signAwsSigV4(target, credential, credentialField(credentials, auth?.secretField), auth);
      return;
    }
    case 'tc3': {
      signTencentTc3(target, credential, credentialField(credentials, auth?.secretField), auth);
      return;
    }
    default:
      throw new Error(`插件声明了尚未启用的鉴权驱动 ${auth?.type}`);
  }
}

function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function bodyBuffer(target: ProtocolAuthTarget): Buffer {
  return target.body ?? Buffer.alloc(0);
}

/** RFC3986 编码（AWS / 腾讯云规范查询串都要求 %20 而不是 +） */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** 排序后的规范查询串；同键多值按值排序 */
function canonicalQuery(searchParams: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  for (const [key, value] of searchParams.entries()) pairs.push([encodeRfc3986(key), encodeRfc3986(value)]);
  pairs.sort((left, right) => (left[0] === right[0] ? left[1].localeCompare(right[1]) : left[0].localeCompare(right[0])));
  return pairs.map(([key, value]) => `${key}=${value}`).join('&');
}

function timestamp(date: Date): { amzDate: string; dateStamp: string } {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/* ─────────────── AWS SigV4（Bedrock 等） ─────────────── */

const AWS_UNSIGNED_HEADERS = new Set(['authorization', 'user-agent', 'content-length', 'expect']);

function canonicalHeaderBlock(headers: Record<string, string>, host: string): { canonical: string; signed: string } {
  const values = new Map<string, string>([['host', host.toLowerCase()]]);
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.trim().toLowerCase();
    if (AWS_UNSIGNED_HEADERS.has(lower)) continue;
    values.set(lower, value.trim().split(/\s+/).join(' '));
  }
  const keys = [...values.keys()].sort();
  const canonical = keys.map((key) => `${key}:${values.get(key)}\n`).join('');
  return { canonical, signed: keys.join(';') };
}

function signAwsSigV4(target: ProtocolAuthTarget, accessKey: string, secretKey: string, auth: ManifestAuth | undefined): void {
  if (accessKey.trim() === '' || secretKey.trim() === '') {
    throw new Error('AWS SigV4 鉴权需要 Access Key ID 和 Secret Access Key');
  }
  const service = String(auth?.service ?? '').trim() || 'bedrock';
  let region = String(auth?.region ?? '').trim();
  if (region === '') {
    // 形如 `bedrock-runtime.us-east-1.amazonaws.com`：service 后紧跟 region
    const parts = target.url.hostname.toLowerCase().split('.');
    const index = parts.findIndex((part, position) => part.startsWith(service) && position + 1 < parts.length);
    if (index >= 0) region = parts[index + 1];
  }
  if (region === '') {
    throw new Error('AWS SigV4 鉴权无法从 Base URL 推断 region，请使用包含区域的 Bedrock Runtime 地址');
  }
  const now = new Date();
  const { amzDate, dateStamp } = timestamp(now);
  const payloadHash = sha256Hex(bodyBuffer(target));
  setHeader(target.headers, 'X-Amz-Date', amzDate);
  setHeader(target.headers, 'X-Amz-Content-Sha256', payloadHash);
  const { canonical, signed } = canonicalHeaderBlock(target.headers, target.url.host);
  const canonicalRequest = [
    target.method,
    target.url.pathname || '/',
    canonicalQuery(target.url.searchParams),
    canonical,
    signed,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const dateKey = hmac(`AWS4${secretKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  setHeader(
    target.headers,
    'Authorization',
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  );
}

/* ─────────────── 腾讯云 TC3（混元等） ─────────────── */

function signTencentTc3(target: ProtocolAuthTarget, secretId: string, secretKey: string, auth: ManifestAuth | undefined): void {
  if (secretId.trim() === '' || secretKey.trim() === '') {
    throw new Error('腾讯云 TC3 鉴权需要 SecretId 和 SecretKey');
  }
  const service = String(auth?.service ?? '').trim() || 'hunyuan';
  const now = new Date();
  const timestampSeconds = Math.floor(now.getTime() / 1000);
  const dateStamp = now.toISOString().slice(0, 10);
  const contentType = getHeader(target.headers, 'content-type') || 'application/json';
  setHeader(target.headers, 'Content-Type', contentType);
  setHeader(target.headers, 'X-TC-Timestamp', String(timestampSeconds));
  const region = String(auth?.region ?? '').trim();
  if (region !== '') setHeader(target.headers, 'X-TC-Region', region);
  const canonicalHeaders = `content-type:${contentType.trim().toLowerCase()}\nhost:${target.url.host.toLowerCase()}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = [
    target.method,
    target.url.pathname || '/',
    canonicalQuery(target.url.searchParams),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(bodyBuffer(target)),
  ].join('\n');
  const scope = `${dateStamp}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(timestampSeconds), scope, sha256Hex(canonicalRequest)].join('\n');
  const secretDate = hmac(`TC3${secretKey}`, dateStamp);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
  setHeader(
    target.headers,
    'Authorization',
    `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );
}

/* ─────────────── 火山引擎 V4（方舟） ─────────────── */

/**
 * 火山引擎 V4 与 AWS SigV4 同族但有三处差异：算法名是 `HMAC-SHA256`、
 * 必须带 `X-Content-Sha256` 且参与签名、scope 结尾是 `request` 而非
 * `aws4_request`。照抄 AWS 会得到 403，且错误信息只说签名不匹配。
 */
function signVolcengineV4(target: ProtocolAuthTarget, accessKey: string, secretKey: string, auth: ManifestAuth | undefined): void {
  if (accessKey.trim() === '' || secretKey.trim() === '') {
    throw new Error('火山引擎 V4 鉴权需要 Access Key 和 Secret Key');
  }
  const service = String(auth?.service ?? '').trim();
  if (service === '') throw new Error('火山引擎 V4 鉴权缺少 service');
  const region = String(auth?.region ?? '').trim() || 'cn-north-1';
  const now = new Date();
  const xDate = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = xDate.slice(0, 10).replace(/-/g, '');
  const payloadHash = sha256Hex(bodyBuffer(target));
  setHeader(target.headers, 'X-Date', xDate);
  setHeader(target.headers, 'X-Content-Sha256', payloadHash);
  if (!getHeader(target.headers, 'content-type')) setHeader(target.headers, 'Content-Type', 'application/json');
  const { canonical, signed } = canonicalHeaderBlock(target.headers, target.url.host);
  const canonicalRequest = [
    target.method,
    target.url.pathname || '/',
    canonicalQuery(target.url.searchParams),
    canonical,
    signed,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${region}/${service}/request`;
  const stringToSign = ['HMAC-SHA256', xDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(secretKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  setHeader(
    target.headers,
    'Authorization',
    `HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  );
}
