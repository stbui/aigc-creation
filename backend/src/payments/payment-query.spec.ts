import { describe, expect, it } from 'vitest';
import {
  buildAdminPaymentOrderWhere,
  closeLeaseOf,
  endOfShanghaiDay,
  formatShanghai,
  orderByOf,
  parseDateStrict,
  paymentOrderWhere,
  paymentStatusOf,
  shanghaiDayRange,
  startOfShanghaiDay,
  timeFieldColumn,
} from './payment-query';

const NOW = new Date('2026-11-02T10:00:00.000Z');

function statusOf(overrides: Partial<Parameters<typeof paymentStatusOf>[0]> = {}) {
  return paymentStatusOf(
    {
      status: 'pending',
      closeStartedAt: null,
      lastError: null,
      providerConfigId: null,
      checkoutMode: null,
      ...overrides,
    },
    NOW,
  );
}

describe('paymentStatusOf', () => {
  it.each([
    ['paid', 'credited'],
    ['refunded', 'refunded'],
    ['partial_refunded', 'partial_refunded'],
    ['cancelled', 'closed'],
  ])('raw %s → %s', (status, expected) => {
    expect(statusOf({ status })).toBe(expected);
  });

  it('pending + 关单租约内 → closing', () => {
    expect(statusOf({ closeStartedAt: new Date(NOW.getTime() - 60_000) })).toBe('closing');
  });

  it('关单租约恰好 5 分钟 → 不再算 closing', () => {
    expect(statusOf({ closeStartedAt: closeLeaseOf(NOW) })).toBe('created');
  });

  it('pending + lastError → create_failed', () => {
    expect(statusOf({ lastError: '渠道错误' })).toBe('create_failed');
  });

  it('pending + 已固定渠道 → pending', () => {
    expect(statusOf({ providerConfigId: 'cfg_1' })).toBe('pending');
    expect(statusOf({ checkoutMode: 'qrcode' })).toBe('pending');
  });

  it('其余 pending → created', () => {
    expect(statusOf()).toBe('created');
  });
});

describe('paymentOrderWhere', () => {
  const lease = closeLeaseOf(NOW);

  it('终态直接映射原始状态', () => {
    expect(paymentOrderWhere('credited', lease)).toEqual({ status: 'paid' });
    expect(paymentOrderWhere('refunded', lease)).toEqual({ status: 'refunded' });
    expect(paymentOrderWhere('closed', lease)).toEqual({ status: 'cancelled' });
  });

  it('closing / create_failed 的租约边界严格互补', () => {
    expect(paymentOrderWhere('closing', lease)).toEqual({
      status: 'pending',
      closeStartedAt: { gt: lease },
    });
    const createFailed = paymentOrderWhere('create_failed', lease) as {
      AND: Array<Record<string, unknown>>;
    };
    expect(createFailed.AND[1]).toEqual({ lastError: { not: null } });
    expect(createFailed.AND[2]).toEqual({
      OR: [{ closeStartedAt: null }, { closeStartedAt: { lte: lease } }],
    });
  });

  it('非法状态抛 40001', () => {
    expect(() => paymentOrderWhere('bogus' as never, lease)).toThrow(/筛选值非法/);
  });
});

describe('buildAdminPaymentOrderWhere', () => {
  it('始终带商品订单基线', () => {
    expect(buildAdminPaymentOrderWhere({}, NOW)).toEqual({ AND: [{ items: { some: {} } }] });
  });

  it('状态 + 渠道 + 时间条件进入同一个 AND', () => {
    const where = buildAdminPaymentOrderWhere(
      { status: 'pending', providerId: 'alipay', timeField: 'created', from: '2026-11-01', to: '2026-11-02' },
      NOW,
    ) as { AND: Array<Record<string, unknown>> };
    expect(where.AND).toHaveLength(4);
    expect(where.AND[1]).toMatchObject({
      AND: expect.arrayContaining([{ status: 'pending' }]),
    });
    expect(where.AND[2]).toEqual({ channel: 'alipay' });
    expect(where.AND[3]).toHaveProperty('createdAt');
  });

  it('非法渠道 / 时间字段 / 超长关键字都拒绝', () => {
    expect(() => buildAdminPaymentOrderWhere({ providerId: 'manual' }, NOW)).toThrow(/未知支付渠道/);
    expect(() => buildAdminPaymentOrderWhere({ timeField: 'refundedAt' }, NOW)).toThrow(/时间字段非法/);
    expect(() => buildAdminPaymentOrderWhere({ keyword: 'x'.repeat(121) }, NOW)).toThrow(/关键字过长/);
  });

  it('非法日期拒绝', () => {
    expect(() => buildAdminPaymentOrderWhere({ from: '2026-02-30' }, NOW)).toThrow(/日期不存在/);
    expect(() => buildAdminPaymentOrderWhere({ from: '2026-11-03', to: '2026-11-02' }, NOW)).toThrow(
      /开始日期不能晚于结束日期/,
    );
  });
});

describe('日期与排序工具', () => {
  it('上海时区日界正确', () => {
    expect(startOfShanghaiDay('2026-11-02').toISOString()).toBe('2026-11-01T16:00:00.000Z');
    expect(endOfShanghaiDay('2026-11-02').toISOString()).toBe('2026-11-02T15:59:59.999Z');
  });

  it('严格日期不接受自动滚动', () => {
    expect(parseDateStrict('2026-02-28')).toEqual({ y: 2026, m: 2, d: 28 });
    expect(() => parseDateStrict('2026-02-29')).toThrow(/日期不存在/);
  });

  it('shanghaiDayRange 保留边界', () => {
    expect(shanghaiDayRange('2026-11-01', '2026-11-02')).toEqual({
      gte: new Date('2026-10-31T16:00:00.000Z'),
      lte: new Date('2026-11-02T15:59:59.999Z'),
    });
    expect(shanghaiDayRange()).toBeUndefined();
  });

  it('排序字段白名单 + id 次排序 + nulls last', () => {
    expect(orderByOf()).toEqual([{ createdAt: 'desc' }, { id: 'asc' }]);
    expect(orderByOf('amountCents:asc')).toEqual([{ paidCents: 'asc' }, { id: 'asc' }]);
    expect(orderByOf('paidAt:desc')).toEqual([
      { paidAt: { sort: 'desc', nulls: 'last' } },
      { id: 'asc' },
    ]);
    expect(() => orderByOf('password:asc')).toThrow(/排序字段非法/);
    expect(() => orderByOf('createdAt:sideways')).toThrow(/排序字段非法/);
  });

  it('时间字段映射与上海格式化', () => {
    expect(timeFieldColumn('created')).toBe('createdAt');
    expect(timeFieldColumn('paid')).toBe('providerPaidAt');
    expect(timeFieldColumn('credited')).toBe('paidAt');
    expect(formatShanghai(new Date('2026-11-02T02:00:00.000Z'))).toBe('2026-11-02 10:00:00');
    expect(formatShanghai(null)).toBe('');
  });
});
