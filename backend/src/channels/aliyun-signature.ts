import { createHmac, randomUUID } from 'crypto';

/**
 * 阿里云 RPC 风格接口签名（短信 SendSms / 邮件 SingleSendMail 共用）。
 *
 * 按官方规范实现，不引 SDK（见 CLAUDE.md「环境注意事项」第 4 条）：
 *
 *   1. 公共参数：Format=JSON、Version、AccessKeyId、SignatureMethod=HMAC-SHA1、
 *      SignatureVersion=1.0、SignatureNonce、Timestamp（ISO8601 UTC，秒级）
 *   2. CanonicalizedQueryString：所有参数（**不含 Signature**）按参数名
 *      字典序排序，逐项 `percentEncode(k)=percentEncode(v)` 后用 `&` 连接
 *   3. StringToSign：`POST&%2F&percentEncode(CanonicalizedQueryString)`
 *   4. Signature = Base64(HMAC-SHA1(StringToSign, `${AccessKeySecret}&`))
 *   5. Signature 作为最后一个参数放进请求体（不参与第 2 步）
 *
 * percentEncode 用的是 RFC3986 而不是 `encodeURIComponent` 原样：
 * encodeURIComponent 不编码 `!'()*`，阿里云要求这几个也编码（`*` → `%2A`）；
 * `~` 属 RFC3986 unreserved，保持原样。写成一次字符串替换即可，
 * 不必为了「看起来像 RFC3986」再手写一遍 UTF-8 百分号编码 —— 那正是
 * 最容易在非 ASCII 值（如中文签名「货觉AI」）上出错的写法。
 */

/** RFC3986 百分号编码（阿里云口径：`!` `'` `(` `)` `*` 必须编码，`~` 保留） */
export function percentEncode(value: string): string {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** 字典序 + 百分号编码后的 canonical query（不含 Signature） */
export function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
}

/** StringToSign = POST&%2F&percentEncode(canonicalQuery) */
export function stringToSign(params: Record<string, string>, method = 'POST'): string {
  return `${method}&${percentEncode('/')}&${percentEncode(canonicalQuery(params))}`;
}

/** HMAC-SHA1 Base64 签名 */
export function signRpc(params: Record<string, string>, accessKeySecret: string, method = 'POST'): string {
  return createHmac('sha1', `${accessKeySecret}&`).update(stringToSign(params, method)).digest('base64');
}

export interface AliyunRpcInput {
  action: string;
  version: string;
  accessKeyId: string;
  accessKeySecret: string;
  /** 业务参数（PhoneNumbers / TemplateCode / Subject …） */
  extra: Record<string, string | undefined>;
  /**
   * 测试注入用：固定 nonce 与 timestamp 才能对签名做独立复算
   * （见 `scripts/verify-channel-signatures.ts`）。生产不传。
   */
  nonce?: string;
  timestamp?: string;
  /** 地域参数，部分接口必填（如短信的 RegionId 可省略，填了就参与签名） */
  regionId?: string;
}

export interface AliyunRpcRequest {
  /** 含 Signature 的全部参数（按 canonical order 串联后的请求体） */
  body: string;
  params: Record<string, string>;
  signature: string;
}

/** 阿里云要求的 UTC ISO8601 秒级时间戳：2026-10-22T03:04:05Z */
export function isoUtcSeconds(d: Date = new Date()): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * 组装并签名一次 RPC 调用。
 *
 * 返回 `body` 直接交给 `postForm` —— 签名串与请求体是同一份字符串，
 * 不存在「签一份、发另一份」的机会。
 */
export function buildRpcRequest(input: AliyunRpcInput): AliyunRpcRequest {
  const params: Record<string, string> = {
    Format: 'JSON',
    Version: input.version,
    AccessKeyId: input.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: input.nonce ?? randomUUID(),
    Timestamp: input.timestamp ?? isoUtcSeconds(),
    Action: input.action,
  };
  if (input.regionId) params.RegionId = input.regionId;
  for (const [k, v] of Object.entries(input.extra)) {
    if (v !== undefined && v !== null && v !== '') params[k] = String(v);
  }

  const signature = signRpc(params, input.accessKeySecret);
  return { body: canonicalQuery({ ...params, Signature: signature }), params, signature };
}

/**
 * 解析阿里云 RPC 响应。
 *
 * 三个接口的失败表达并不统一：
 *   - SendSms   ：HTTP 200 + `Code != 'OK'`（如 isv.BUSINESS_LIMIT_CONTROL）
 *   - SingleSendMail：HTTP 200 + 仅失败时带 `Code`，成功只有 RequestId/EnvId
 *   - 鉴权失败  ：HTTP 4xx + `Code`（SignatureDoesNotMatch / InvalidAccessKeyId.NotFound）
 * 所以判定顺序是「先看有没有 Code/错误码，再看 HTTP 状态」，
 * 不能像 `postJson` 那样只看 `res.ok` —— 那会把「签名错」当成投递成功。
 */
export function parseRpcResult(
  bodyText: string | undefined,
  httpStatus: number | undefined,
  httpOk: boolean,
): { ok: boolean; messageId?: string; error?: string } {
  let parsed: Record<string, any> | undefined;
  try {
    parsed = bodyText ? JSON.parse(bodyText) : undefined;
  } catch {
    parsed = undefined;
  }

  const code = parsed?.Code ? String(parsed.Code) : '';
  // SendSms 成功码是 OK；SingleSendMail 成功不带 Code。空串与 OK 都算成功。
  const codeOk = !code || code.toUpperCase() === 'OK';
  const requestId = parsed?.RequestId ? String(parsed.RequestId) : undefined;

  if (codeOk && httpOk) {
    return { ok: true, messageId: parsed?.BizId ? String(parsed.BizId) : requestId };
  }

  if (!codeOk) {
    return { ok: false, error: `${code}${parsed?.Message ? `: ${parsed.Message}` : ''}` };
  }
  return { ok: false, error: `HTTP ${httpStatus ?? '未知'}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}` };
}
