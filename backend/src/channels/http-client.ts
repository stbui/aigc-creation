/**
 * 通道 HTTP 客户端 —— 邮件 / 短信共用的 POST 调用。
 *
 * 两种请求体：
 *   - `postJson` —— 通用 HTTP 通道（`EMAIL_PROVIDER=http` / `SMS_PROVIDER=http`）
 *   - `postForm` —— `application/x-www-form-urlencoded`，阿里云 RPC 类接口用
 * 重试与超时策略只在 `postRaw` 里维护一份。
 *
 * 为什么手写而不引 axios / got
 * ---------------------------
 * Node ≥ 22 的全局 `fetch` 已够用，且本项目依赖纪律要求零新增包。
 *
 * 重试策略
 * --------
 * 3 次尝试（首次 + 2 次重试），指数退避 500ms / 1000ms：
 *   - 网络错误（DNS / 连接被拒 / 超时）→ 重试；
 *   - HTTP 429 / 5xx → 重试（服务端瞬时故障）；
 *   - 其余 4xx → **不重试**，重试只会把「API Key 错了」变成三次无效请求，
 *     还会让调用方多等两轮退避。
 *
 * 超时 15s/次。短信与邮件都在请求链路里（忘记密码接口），超时必须明确，
 * 否则一个卡住的第三方服务会把整个 Nest 事件循环的该请求挂住。
 */

export interface HttpPostOptions {
  url: string;
  headers?: Record<string, string>;
  body: unknown;
  timeoutMs?: number;
  /** 总尝试次数（含首次），默认 3 */
  attempts?: number;
}

export interface HttpPostResult {
  ok: boolean;
  status?: number;
  /** 服务端返回的文本（截断到 2KB，只用于排障与提取 messageId） */
  bodyText?: string;
  /** 最终失败原因，已脱敏 */
  error?: string;
  attempts: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 两种请求体的共同实现 —— 重试与超时策略只在 `postRaw` 里维护一份 */
interface RawPostOptions {
  url: string;
  headers?: Record<string, string>;
  body: string;
  contentType: string;
  timeoutMs?: number;
  attempts?: number;
}

async function postRaw(opts: RawPostOptions): Promise<HttpPostResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxAttempts = Math.max(1, opts.attempts ?? 3);
  let lastError = '';
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(opts.url, {
        method: 'POST',
        headers: {
          'content-type': opts.contentType,
          accept: 'application/json',
          ...(opts.headers || {}),
        },
        body: opts.body,
        signal: controller.signal,
      });
      const bodyText = (await res.text().catch(() => '')).slice(0, 2048);
      lastStatus = res.status;
      if (res.ok) {
        return { ok: true, status: res.status, bodyText, attempts: attempt };
      }
      lastError = `HTTP ${res.status}${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`;
      if (!RETRYABLE_STATUS.has(res.status)) {
        return { ok: false, status: res.status, bodyText, error: lastError, attempts: attempt };
      }
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      lastError = aborted ? `请求超时（${timeoutMs}ms）` : `网络错误: ${(err as Error).message}`;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < maxAttempts) {
      // 500ms、1000ms 指数退避
      await sleep(500 * 2 ** (attempt - 1));
    }
  }

  return { ok: false, status: lastStatus, error: lastError, attempts: maxAttempts };
}

export async function postJson(opts: HttpPostOptions): Promise<HttpPostResult> {
  return postRaw({
    url: opts.url,
    headers: opts.headers,
    body: JSON.stringify(opts.body ?? {}),
    contentType: 'application/json',
    timeoutMs: opts.timeoutMs,
    attempts: opts.attempts,
  });
}

export interface HttpPostFormOptions extends Omit<HttpPostOptions, 'body'> {
  /**
   * 请求体。
   *
   * 传**预先编码好的字符串**而不是字段表：阿里云 RPC 的签名串与请求体
   * 必须是同一份 canonical query（同样的排序与百分号编码）。在这里再编码
   * 一次就会出现「签的是 A、发的是 B」，服务端只回一个 SignatureDoesNotMatch。
   */
  body: string;
}

/** `application/x-www-form-urlencoded` POST —— 阿里云 RPC 类接口用 */
export async function postForm(opts: HttpPostFormOptions): Promise<HttpPostResult> {
  return postRaw({
    url: opts.url,
    headers: opts.headers,
    body: opts.body,
    contentType: 'application/x-www-form-urlencoded',
    timeoutMs: opts.timeoutMs,
    attempts: opts.attempts,
  });
}
