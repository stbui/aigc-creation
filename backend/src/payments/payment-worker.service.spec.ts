import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { adaptersMock } = vi.hoisted(() => ({
  adaptersMock: [
    {
      descriptor: { id: 'alipay', supportsReconciliation: true },
    },
  ],
}));

vi.mock('./adapters', () => ({
  allAdapters: () => adaptersMock,
}));

import { PaymentWorkerService } from './payment-worker.service';

function makeHarness() {
  const states = new Map<string, Record<string, any>>();
  const prisma = {
    paymentNotification: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findMany: vi.fn().mockResolvedValue([]) },
    order: { findMany: vi.fn().mockResolvedValue([]) },
    paymentAutoReconcileState: {
      upsert: vi.fn(async ({ where, create }: any) => {
        const key = `${where.providerId_billDate.providerId}|${where.providerId_billDate.billDate}`;
        const existing = states.get(key);
        if (existing) return existing;
        const row = { id: `state-${states.size + 1}`, ...create };
        states.set(key, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = [...states.values()].find((item) => item.id === where.id)!;
        if (data.attempts?.increment) {
          row.attempts += data.attempts.increment;
        } else if (data.attempts !== undefined) {
          row.attempts = data.attempts;
        }
        for (const [key, value] of Object.entries(data)) {
          if (key !== 'attempts') row[key] = value;
        }
        return row;
      }),
    },
  };
  const orders = {
    closeExpired: vi.fn().mockResolvedValue(0),
    query: vi.fn(),
  };
  const notifications = { retry: vi.fn() };
  const reconciliation = {
    recoverStaleRuns: vi.fn().mockResolvedValue(0),
    run: vi.fn().mockResolvedValue({
      run: { status: 'failed', error: '账单下载失败' },
      reused: false,
    }),
  };
  const configs = {
    latest: vi.fn().mockResolvedValue({ enabled: true }),
  };
  const exceptions = { recordReconciliationFailure: vi.fn().mockResolvedValue({}) };
  const service = new PaymentWorkerService(
    prisma as never,
    orders as never,
    notifications as never,
    reconciliation as never,
    configs as never,
    exceptions as never,
  );
  return { service, states, prisma, reconciliation, exceptions };
}

async function runAutoReconcile(service: PaymentWorkerService) {
  return (service as any).autoReconcile();
}

describe('PaymentWorkerService 自动对账重试', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-05T02:30:00.000Z')); // 上海 10:30
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('失败按 15/30/60 分钟退避，跨重启累计 3 次后落异常单', async () => {
    const first = makeHarness();
    await runAutoReconcile(first.service);
    let state = [...first.states.values()][0];
    expect(state).toMatchObject({ status: 'pending', attempts: 1 });
    expect(state.nextAttemptAt.getTime() - Date.now()).toBe(15 * 60_000);

    vi.setSystemTime(new Date('2026-11-05T02:45:00.000Z'));
    const second = makeHarness();
    second.states.set('alipay|2026-11-04', { ...state });
    await runAutoReconcile(second.service);
    state = [...second.states.values()][0];
    expect(state).toMatchObject({ status: 'pending', attempts: 2 });
    expect(state.nextAttemptAt.getTime() - Date.now()).toBe(30 * 60_000);

    vi.setSystemTime(new Date('2026-11-05T03:15:00.000Z'));
    const third = makeHarness();
    third.states.set('alipay|2026-11-04', { ...state });
    await runAutoReconcile(third.service);
    state = [...third.states.values()][0];
    expect(state).toMatchObject({ status: 'failed', attempts: 3 });
    expect(third.exceptions.recordReconciliationFailure).toHaveBeenCalledTimes(1);

    await runAutoReconcile(third.service);
    expect(third.reconciliation.run).toHaveBeenCalledTimes(1);
  });

  it('对账 run 返回 failed 时不能被标记为成功', async () => {
    const { service, states, reconciliation, exceptions } = makeHarness();

    await runAutoReconcile(service);

    expect(reconciliation.run).toHaveBeenCalledTimes(1);
    expect([...states.values()][0]).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: '账单下载失败',
    });
    expect(exceptions.recordReconciliationFailure).not.toHaveBeenCalled();
  });
});
