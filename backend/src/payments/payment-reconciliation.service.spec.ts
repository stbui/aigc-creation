import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaymentReconciliationService } from './payment-reconciliation.service';

afterEach(() => {
  vi.useRealTimers();
});

describe('PaymentReconciliationService.assertBillDate', () => {
  it('上海时区深夜仍拒绝当天账单，并正确计算 90 天窗口', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T15:30:00.000Z')); // 上海 23:30
    const service = new PaymentReconciliationService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    expect(() => (service as any).assertBillDate('2026-11-05')).toThrow(
      /不能晚于昨天/,
    );
    expect(() => (service as any).assertBillDate('2026-11-04')).not.toThrow();
    expect(() => (service as any).assertBillDate('2026-08-07')).not.toThrow();
    expect(() => (service as any).assertBillDate('2026-08-06')).toThrow(
      /只能对账最近 90 天/,
    );
  });
});

describe('PaymentReconciliationService.compare', () => {
  it('同一商户订单号出现第二个不同交易号时标记重复扣款', async () => {
    const { service, stored } = makeHarness({
      id: 'order-1',
      orderNo: 'HJ-ORDER-1',
      status: 'paid',
      providerTradeNo: 'TRADE-A',
      paidCents: 100,
      currency: 'CNY',
    });

    const run = await compare(service, [
      billRecord('TRADE-A', '2026-11-04T02:00:00.000Z'),
      billRecord('TRADE-B', '2026-11-04T02:01:00.000Z'),
    ]);

    expect(stored.size).toBe(2);
    expect([...stored.values()].map((item) => item.result)).toEqual([
      'matched',
      'duplicate_charge',
    ]);
    expect(run).toMatchObject({ totalItems: 2, matchItems: 1, errorItems: 1 });
  });

  it('完全相同的交易号重复导出行只计一次，不覆盖首行结果', async () => {
    const { service, stored } = makeHarness({
      id: 'order-1',
      orderNo: 'HJ-ORDER-1',
      status: 'paid',
      providerTradeNo: 'TRADE-A',
      paidCents: 100,
      currency: 'CNY',
    });

    const run = await compare(service, [
      billRecord('TRADE-A', '2026-11-04T02:00:00.000Z'),
      billRecord('TRADE-A', '2026-11-04T02:00:00.000Z'),
    ]);

    expect(stored.size).toBe(1);
    expect([...stored.values()].map((item) => item.result)).toEqual(['matched']);
    expect(run).toMatchObject({ totalItems: 1, matchItems: 1, errorItems: 0 });
  });

  it('历史订单没有本地交易号时仍能识别第二笔不同流水', async () => {
    const { service, stored } = makeHarness({
      id: 'order-1',
      orderNo: 'HJ-ORDER-1',
      status: 'paid',
      providerTradeNo: null,
      paidCents: 100,
      currency: 'CNY',
    });

    const run = await compare(service, [
      billRecord('TRADE-A', '2026-11-04T02:00:00.000Z'),
      billRecord('TRADE-B', '2026-11-04T02:01:00.000Z'),
    ]);

    expect([...stored.values()].map((item) => item.result)).toEqual([
      'matched',
      'duplicate_charge',
    ]);
    expect(run).toMatchObject({ totalItems: 2, matchItems: 1, errorItems: 1 });
  });
});

function makeHarness(order: Record<string, unknown>) {
  const stored = new Map<string, Record<string, unknown>>();
  const prisma = {
    order: {
      findUnique: vi.fn().mockResolvedValue(order),
      findMany: vi.fn().mockResolvedValue([]),
    },
    paymentReconciliationItem: {
      upsert: vi.fn(async ({ where, create, update }) => {
        const key = [
          where.runId_merchantOrderNo_providerTradeNo.runId,
          where.runId_merchantOrderNo_providerTradeNo.merchantOrderNo,
          where.runId_merchantOrderNo_providerTradeNo.providerTradeNo,
        ].join('|');
        const existing = stored.get(key);
        if (existing) Object.assign(existing, update);
        else stored.set(key, { ...create });
        return existing ?? create;
      }),
    },
    paymentReconciliationRun: {
      update: vi.fn(async ({ data }) => ({
        id: 'run-1',
        providerId: 'alipay',
        configId: 'config-1',
        billDate: '2026-11-04',
        attempt: 1,
        source: 'provider',
        fileName: null,
        status: data.status,
        totalItems: data.totalItems,
        matchItems: data.matchItems,
        recoveredItems: data.recoveredItems,
        errorItems: data.errorItems,
        error: data.error,
        startedBy: null,
        startedAt: new Date(),
        completedAt: data.completedAt,
      })),
    },
  };
  const service = new PaymentReconciliationService(
    prisma as never,
    {} as never,
    {} as never,
    {
      recordManual: vi.fn().mockResolvedValue({}),
      recordOpen: vi.fn().mockResolvedValue({}),
      autoRefundCancelledPayment: vi
        .fn()
        .mockResolvedValue({ case: {}, outcome: 'manual_review' }),
    } as never,
  );
  return { service, stored };
}

function compare(
  service: PaymentReconciliationService,
  records: ReturnType<typeof billRecord>[],
) {
  return (service as any).compare(
      'run-1',
      'alipay',
      'config-1',
      records,
      '2026-11-04',
    );
}

function billRecord(providerTradeNo: string, paidAt: string) {
  return {
    merchantOrderNo: 'HJ-ORDER-1',
    providerTradeNo,
    amountCents: 100,
    currency: 'CNY' as const,
    paidAt: new Date(paidAt),
    providerStatus: 'TRADE_SUCCESS',
  };
}
