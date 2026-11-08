import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PaymentExceptionService, type PaymentExceptionInput } from './payment-exception.service';

type Row = Record<string, any>;

function makeHarness(options: {
  order?: Row | null;
  gatewayRefund?: (input: unknown) => Promise<any>;
} = {}) {
  const cases = new Map<string, Row>();
  const refunds = new Map<string, Row>();
  let sequence = 0;
  const now = new Date('2026-11-05T10:00:00.000Z');

  const order = options.order === undefined
    ? {
        id: 'order-1',
        orderNo: 'HJ-1',
        userId: 'user-1',
        status: 'cancelled',
        currency: 'CNY',
        paidCents: 100,
        providerConfigId: 'cfg-1',
        payments: [
          {
            id: 'payment-1',
            status: 'succeeded',
            channel: 'alipay',
            providerConfigId: 'cfg-1',
            payTransactionId: 'TRADE-1',
            amountCents: 100,
            providerRef: null,
          },
        ],
      }
    : options.order;

  const matches = (row: Row, where: Row) =>
    Object.entries(where ?? {}).every(([key, expected]) => {
      if (expected && typeof expected === 'object' && 'in' in expected) {
        return (expected.in as unknown[]).includes(row[key]);
      }
      return row[key] === expected;
    });

  const prisma = {
    paymentExceptionCase: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => {
        for (const row of cases.values()) {
          if (Object.entries(where).every(([key, value]) => row[key] === value)) return row;
        }
        return null;
      }),
      create: vi.fn(async ({ data }: { data: Row }) => {
        if ([...cases.values()].some((row) => row.fingerprint === data.fingerprint)) {
          throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        }
        const row = {
          id: `case-${++sequence}`,
          ownerId: null,
          resolution: null,
          closedAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        cases.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = cases.get(where.id);
        if (!row) throw new Error('case not found');
        Object.assign(row, data, { updatedAt: now });
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = cases.get(where.id);
        if (!row || !matches(row, where)) return { count: 0 };
        Object.assign(row, data, { updatedAt: now });
        return { count: 1 };
      }),
      findMany: vi.fn(async () => [...cases.values()]),
      count: vi.fn(async () => cases.size),
    },
    order: { findUnique: vi.fn().mockResolvedValue(order) },
    refund: {
      findUnique: vi.fn(async ({ where }: { where: Row }) => refunds.get(where.id) ?? null),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Row }) => {
        const row = {
          id: `refund-${++sequence}`,
          providerRefundId: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        refunds.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = refunds.get(where.id);
        if (!row) throw new Error('refund not found');
        Object.assign(row, data, { updatedAt: now });
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        const row = refunds.get(where.id);
        if (!row || !matches(row, where)) return { count: 0 };
        Object.assign(row, data, { updatedAt: now });
        return { count: 1 };
      }),
      findMany: vi.fn(async () => [...refunds.values()]),
    },
  };
  const gateway = {
    refund: vi.fn(options.gatewayRefund ?? (async () => ({
      state: 'succeeded',
      providerRefundId: 'provider-refund-1',
      raw: {},
    }))),
  };
  const service = new PaymentExceptionService(prisma as never, gateway as never);
  return { service, prisma, gateway, cases, refunds };
}

function cancelledInput(extra: Partial<PaymentExceptionInput> = {}): PaymentExceptionInput {
  return {
    providerId: 'alipay',
    orderId: 'order-1',
    merchantOrderNo: 'HJ-1',
    providerTradeNo: 'TRADE-1',
    amountCents: 100,
    currency: 'CNY',
    kind: 'cancelled_but_paid',
    detail: '已取消订单仍扣款',
    ...extra,
  };
}

describe('PaymentExceptionService 自动退款补偿', () => {
  beforeEach(() => vi.clearAllMocks());

  it('同一事件指纹幂等，refundId 隔离同一订单的多次部分退款', async () => {
    const { service, prisma, cases } = makeHarness();

    const first = await service.recordOpen(cancelledInput());
    const duplicate = await service.recordOpen(cancelledInput({ detail: '重复回调' }));
    const secondRefund = await service.recordOpen(cancelledInput({ refundId: 'refund-other' }));

    expect(first.id).toBe(duplicate.id);
    expect(secondRefund.id).not.toBe(first.id);
    expect(cases.size).toBe(2);
    expect(prisma.paymentExceptionCase.create).toHaveBeenCalledTimes(2);
  });

  it('金额与成功支付流水不一致时禁止自动退款', async () => {
    const { service, gateway, cases } = makeHarness();
    const result = await service.autoRefundCancelledPayment({
      providerId: 'alipay',
      merchantOrderNo: 'HJ-1',
      providerTradeNo: 'TRADE-1',
      amountCents: 90,
      detail: '账单金额不一致',
    });

    expect(result.outcome).toBe('manual_review');
    expect(gateway.refund).not.toHaveBeenCalled();
    expect([...cases.values()][0]).toMatchObject({
      status: 'manual_review',
      lastError: expect.stringContaining('金额'),
    });
  });

  it('并发回调通过 CAS 只发起一次渠道退款', async () => {
    let release!: (value: unknown) => void;
    const gatewayResult = new Promise((resolve) => {
      release = resolve;
    });
    const { service, gateway, refunds } = makeHarness({
      gatewayRefund: () => gatewayResult,
    });
    const input = {
      providerId: 'alipay',
      merchantOrderNo: 'HJ-1',
      providerTradeNo: 'TRADE-1',
      amountCents: 100,
      detail: '已取消订单仍扣款',
    };

    const first = service.autoRefundCancelledPayment(input);
    const second = service.autoRefundCancelledPayment(input);
    await vi.waitFor(() => expect(gateway.refund).toHaveBeenCalledTimes(1));
    release({ state: 'succeeded', providerRefundId: 'provider-refund-1', raw: {} });

    const [a, b] = await Promise.all([first, second]);
    expect(gateway.refund).toHaveBeenCalledTimes(1);
    expect(refunds.size).toBe(1);
    expect([a.outcome, b.outcome]).toContain('refunded');
    expect([a.outcome, b.outcome]).toContain('refund_processing');
  });

  it('渠道异步处理中时保持待核销，不误记退款成功', async () => {
    const { service, refunds, cases } = makeHarness({
      gatewayRefund: async () => ({
        state: 'processing',
        providerRefundId: 'provider-refund-processing',
        raw: {},
      }),
    });
    const result = await service.autoRefundCancelledPayment({
      providerId: 'alipay',
      merchantOrderNo: 'HJ-1',
      providerTradeNo: 'TRADE-1',
      amountCents: 100,
      detail: '已取消订单仍扣款',
    });

    expect(result.outcome).toBe('refund_processing');
    expect([...refunds.values()][0].status).toBe('processing');
    expect([...cases.values()][0].status).toBe('auto_refund_pending');
  });

  it('渠道调用直接抛错时退款单落 failed 并转人工，不卡在退款中', async () => {
    const { service, refunds, cases } = makeHarness({
      gatewayRefund: async () => {
        throw new Error('network timeout');
      },
    });
    const result = await service.autoRefundCancelledPayment({
      providerId: 'alipay',
      merchantOrderNo: 'HJ-1',
      providerTradeNo: 'TRADE-1',
      amountCents: 100,
      detail: '已取消订单仍扣款',
    });

    expect(result.outcome).toBe('manual_review');
    expect([...refunds.values()][0]).toMatchObject({
      status: 'failed',
      detail: expect.stringContaining('network timeout'),
    });
    expect([...cases.values()][0]).toMatchObject({
      status: 'manual_review',
      lastError: expect.stringContaining('network timeout'),
    });
  });
});
