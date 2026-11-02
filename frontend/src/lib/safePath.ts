/**
 * 站内跳转路径校验。
 *
 * 凡是把 URL / 通知 link / OAuth returnTo 交给 navigate() 或 <Navigate> 的地方
 * 都必须经过这里。只接受站内绝对路径：
 *   - 必须以 `/` 开头
 *   - 不能是 `//evil.com`（协议相对 URL）
 *   - 不能包含反斜杠（浏览器会把 `\` 规范化为 `/`，`/\evil.com` 可绕过旧校验）
 *   - 不能包含控制字符
 *
 * 返回 fallback（默认 `/`）表示拒绝。调用方按场景决定 fallback。
 */
export function safeInternalPath(
  value: string | null | undefined,
  fallback = '/',
): string {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;
  if (value.includes('\\')) return fallback;
  // 控制字符（含换行、制表）在 URL 解析里可能被剥离或改变语义，直接拒绝
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  // 登录页自身不作为回跳目标，避免登录后原地打转
  if (value === '/login') return fallback;

  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
