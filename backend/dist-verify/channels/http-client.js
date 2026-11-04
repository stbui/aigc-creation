"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.postJson = postJson;
exports.postForm = postForm;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
async function postRaw(opts) {
    const timeoutMs = opts.timeoutMs ?? 15_000;
    const maxAttempts = Math.max(1, opts.attempts ?? 3);
    let lastError = '';
    let lastStatus;
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
        }
        catch (err) {
            const aborted = err instanceof Error && err.name === 'AbortError';
            lastError = aborted ? `请求超时（${timeoutMs}ms）` : `网络错误: ${err.message}`;
        }
        finally {
            clearTimeout(timer);
        }
        if (attempt < maxAttempts) {
            // 500ms、1000ms 指数退避
            await sleep(500 * 2 ** (attempt - 1));
        }
    }
    return { ok: false, status: lastStatus, error: lastError, attempts: maxAttempts };
}
async function postJson(opts) {
    return postRaw({
        url: opts.url,
        headers: opts.headers,
        body: JSON.stringify(opts.body ?? {}),
        contentType: 'application/json',
        timeoutMs: opts.timeoutMs,
        attempts: opts.attempts,
    });
}
/** `application/x-www-form-urlencoded` POST —— 阿里云 RPC 类接口用 */
async function postForm(opts) {
    return postRaw({
        url: opts.url,
        headers: opts.headers,
        body: opts.body,
        contentType: 'application/x-www-form-urlencoded',
        timeoutMs: opts.timeoutMs,
        attempts: opts.attempts,
    });
}
//# sourceMappingURL=http-client.js.map