/**
 * OAuth 用到的极简 HTTP 工具。
 *
 * 为什么不用 axios：项目依赖纪律是「零新增依赖」，Node 22+ 自带 fetch 已足够。
 * 这里只补两件事：超时与 form-urlencoded 解析，均不引入新包。
 */

const DEFAULT_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 把对象序列化为 application/x-www-form-urlencoded 请求体 */
export function formEncode(data: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** 把响应体解析成对象：优先 JSON，失败时按 form-urlencoded 处理 */
export async function parseTokenResponse(res: Response): Promise<Record<string, string>> {
  const text = await res.text();
  if (!text) return {};
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return JSON.parse(text) as Record<string, string>;
  }
  return Object.fromEntries(new URLSearchParams(text));
}

/** POST form，返回已解析的响应对象。非 2xx 时抛出带 provider 上下文的错误 */
export async function postForm(
  url: string,
  data: Record<string, string | number | boolean | undefined>,
  headers: Record<string, string> = {},
): Promise<Record<string, string>> {
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers },
    body: formEncode(data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OAuth token 请求失败: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return parseTokenResponse(res);
}

/** GET JSON */
export async function getJson(url: string, accessToken: string, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, ...headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OAuth userinfo 请求失败: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}
