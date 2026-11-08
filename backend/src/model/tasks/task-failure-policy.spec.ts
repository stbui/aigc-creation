import { describe, expect, it } from 'vitest';

import {
  PRE_CONNECTION_FAILURES,
  preConnectionNetworkFailure,
  safeRouteFailure,
} from './task-failure-policy';

describe('建连前网络失败识别', () => {
  it.each([
    ['connect ECONNREFUSED 127.0.0.1:3900', 'outbound_connection_refused'],
    ['getaddrinfo ENOTFOUND upstream.example', 'outbound_dns_failed'],
    ['lookup EAI_AGAIN upstream.example', 'outbound_dns_failed'],
    ['connect ENETUNREACH 10.0.0.1:443', 'outbound_network_unreachable'],
    ['connect EHOSTUNREACH 10.0.0.1:443', 'outbound_network_unreachable'],
  ])('%s 归类为可安全换线', (message, expected) => {
    expect(preConnectionNetworkFailure(message)).toBe(expected);
    expect(safeRouteFailure(expected)).toBe(true);
  });

  it.each(['read ECONNRESET', 'socket hang up', 'request timeout', 'read ETIMEDOUT'])(
    '%s 不能证明请求未写出，必须继续按结果不明处理',
    (message) => {
      expect(preConnectionNetworkFailure(message)).toBeNull();
    },
  );
});

describe('安全换线策略', () => {
  it.each([...PRE_CONNECTION_FAILURES])('%s 属于明确未派发', (failureCode) => {
    expect(safeRouteFailure(failureCode)).toBe(true);
  });

  it.each(['timeout', 'outbound_network', 'outbound_5xx', 'upstream_5xx', 'upstream_no_result'])(
    '%s 可能已派发，不允许自动换线或退款',
    (failureCode) => {
      expect(safeRouteFailure(failureCode)).toBe(false);
    },
  );
});
