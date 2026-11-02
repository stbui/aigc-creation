import { describe, expect, it } from 'vitest';
import { resolveOutboundHost } from './outbound';

describe('resolveOutboundHost 的 IPv6 保留网段', () => {
  it('自定义中转拒绝 discard-only 100::/64', async () => {
    await expect(resolveOutboundHost('100::1', true)).rejects.toMatchObject({ code: 'blocked_host' });
  });

  it('自定义中转拒绝文档网段 2001:db8::/32', async () => {
    await expect(resolveOutboundHost('2001:db8::1', true)).rejects.toMatchObject({ code: 'blocked_host' });
  });

  it('自定义中转仍拒绝 IPv4-mapped loopback', async () => {
    await expect(resolveOutboundHost('::ffff:127.0.0.1', true)).rejects.toMatchObject({ code: 'blocked_host' });
  });

  it('普通出站不把保留网段当成私网（严格模式才拒绝）', async () => {
    await expect(resolveOutboundHost('100::1', false)).resolves.toEqual(['100::1']);
  });
});
