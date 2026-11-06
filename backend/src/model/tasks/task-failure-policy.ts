/**
 * 上游失败是否允许自动换线 / 退款的唯一策略。
 *
 * 这里只回答一个问题：**请求是否可能已经到达上游并建立任务**。
 * `RouteAttempt.dispatchState` 的四态仍负责运行时并发裁决；本模块负责把
 * 协议执行器拿到的异常归一成正确的事实，避免调用方各自维护一份白名单。
 */

/** 建连前即失败，上游不可能据此建立任务。 */
export const PRE_CONNECTION_FAILURES = new Set([
  'outbound_invalid_url',
  'outbound_blocked_host',
  'outbound_dns_failed',
  'outbound_proxy_invalid',
  'outbound_connection_refused',
  'outbound_network_unreachable',
]);

/**
 * 从出站网络异常文本识别建连前 errno。
 *
 * 刻意不包含 `ECONNRESET`、`socket hang up` 与超时：它们可能发生在请求已写出
 * 之后，必须继续按结果不明处理，宁可人工核对也不能重复调用造成双扣费。
 */
export function preConnectionNetworkFailure(message: string): string | null {
  const text = String(message ?? '').toLowerCase();
  if (text.includes('econnrefused')) return 'outbound_connection_refused';
  if (text.includes('enotfound') || text.includes('eai_again') || text.includes('getaddrinfo')) {
    return 'outbound_dns_failed';
  }
  if (text.includes('enetunreach') || text.includes('ehostunreach')) {
    return 'outbound_network_unreachable';
  }
  return null;
}

/**
 * 是否可以认定「上游没有接下这次任务」。
 *
 * 包含渠道准备失败、上游明确 HTTP 拒绝、200 明确失败，以及 TCP 建连前失败。
 * 超时、5xx、建连后中断、响应解析失败不在其中。
 */
export function safeRouteFailure(failureCode: string): boolean {
  const code = String(failureCode ?? '').trim();
  return (
    code === 'channel_unavailable' ||
    code === 'upstream_401' ||
    code === 'upstream_403' ||
    code === 'upstream_404' ||
    code === 'upstream_429' ||
    code === 'upstream_rejected' ||
    PRE_CONNECTION_FAILURES.has(code)
  );
}
