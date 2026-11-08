import { beforeEach, describe, expect, it, vi } from 'vitest';

const { adapterMock } = vi.hoisted(() => ({
  adapterMock: {
    verifyNotification: vi.fn(),
    ack: vi.fn(),
  },
}));

vi.mock('./adapters', () => ({
  getAdapter: () => adapterMock,
}));

import { PaymentNotificationService } from './payment-notification.service';
import type { NotificationResult } from './adapters/types';

const ORDER_NO = 'HJ202611030001';
const CONFIG_ID = 'cfg_stripe_1';
const NOTIFICATION_ID = 'notif_1';

function paidResult(providerRef?: string): NotificationResult {
  return {
    ok: true,
    eventId: 'evt_1',
    merchantOrderNo: ORDER_NO,
    providerTradeNo: 'pi_1',
    providerRef,
    amountCents: 1005,
    currency: 'CNY',
    state: 'paid',
    providerStatus: 'checkout.session.completed:paid',
    ackSuccess: true,
    rawPayload: '{"id":"evt_1"}',
  };
}

function makeHarness(notification: NotificationResult = paidResult('cs_old')) {
  const notificationRow = {
    id: NOTIFICATION_ID,
    providerId: 'stripe',
    providerEventId: 'evt_1',
    providerConfigId: CONFIG_ID,
    merchantOrderNo: ORDER_NO,
    normalizedJson: '{}',
    status: 'pending',
    attempts: 0,
    payloadCipher: 'cipher',
    lastError: null,
    nextAttemptAt: new Date(),
    processedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const prisma = {
    paymentNotification: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string } }) =>
        where.id ? notificationRow : null,
      ),
      create: vi.fn().mockResolvedValue(notificationRow),
      update: vi.fn().mockResolvedValue(notificationRow),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    order: {
      findUnique: vi.fn().mockResolvedValue({ id: 'order_1' }),
    },
    payment: {
      findFirst: vi.fn().mockResolvedValue({ id: 'pay_old' }),
    },
    paymentReconciliationRun: {
      findFirst: vi.fn().mockResolvedValue(null),
      aggregate: vi.fn().mockResolvedValue({ _max: { attempt: null } }),
      create: vi.fn().mockResolvedValue({ id: 'run_1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    paymentReconciliationItem: {
      upsert: vi.fn().mockResolvedValue({}),
      groupBy: vi.fn().mockResolvedValue([{ result: 'credit_failed', _count: { _all: 1 } }]),
    },
  };
  const cipher = {
    encrypt: vi.fn().mockReturnValue('cipher'),
    decrypt: vi.fn().mockReturnValue('{}'),
  };
  const configs = {
    byId: vi.fn().mockResolvedValue({
      id: CONFIG_ID,
      providerId: 'stripe',
      version: 1,
      values: { webhookSecret: 'whsec_test' },
    }),
  };
  const orders = {
    applyPaymentResult: vi.fn().mockResolvedValue({ applied: true, idempotentHit: false }),
  };
  const exceptions = {
    recordManual: vi.fn().mockResolvedValue({}),
    autoRefundCancelledPayment: vi
      .fn()
      .mockResolvedValue({ case: {}, outcome: 'manual_review' }),
  };
  adapterMock.verifyNotification.mockResolvedValue(notification);
  adapterMock.ack.mockImplementation((result: NotificationResult) => ({
    status: result.ok && result.ackSuccess ? 200 : 400,
    body: result.ok && result.ackSuccess ? 'ok' : 'fail',
    contentType: 'text/plain; charset=utf-8',
  }));

  const service = new PaymentNotificationService(
    prisma as never,
    cipher as never,
    configs as never,
    orders as never,
    exceptions as never,
  );
  return { service, prisma, orders, exceptions, notificationRow };
}

async function ingest(service: PaymentNotificationService) {
  return service.ingest({
    providerId: 'stripe',
    configId: CONFIG_ID,
    headers: { 'stripe-signature': 'signed' },
    rawBody: Buffer.from('{"id":"evt_1"}'),
    body: { id: 'evt_1' },
  });
}

describe('PaymentNotificationService providerRef 精确匹配', () => {
  beforeEach(() => {
    adapterMock.verifyNotification.mockReset();
    adapterMock.ack.mockReset();
  });

  it('带 providerRef 的回调只绑定对应 Payment，并把渠道单据号传给入账', async () => {
    const { service, prisma, orders } = makeHarness(paidResult('cs_old'));

    await ingest(service);

    const query = prisma.payment.findFirst.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy?: unknown;
    };
    expect(query.where).toMatchObject({
      orderId: 'order_1',
      channel: 'stripe',
      providerConfigId: CONFIG_ID,
      providerRef: 'cs_old',
    });
    expect(query.orderBy).toBeUndefined();
    expect(orders.applyPaymentResult).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'pay_old', providerRef: 'cs_old' }),
    );

    const created = prisma.paymentNotification.create.mock.calls[0][0] as {
      data: { normalizedJson: string };
    };
    expect(JSON.parse(created.data.normalizedJson)).toMatchObject({ providerRef: 'cs_old' });
  });

  it('providerRef 找不到 Payment 时永久失败并记录差异，绝不回落到最新尝试', async () => {
    const { service, prisma, orders } = makeHarness(paidResult('cs_missing'));
    prisma.payment.findFirst.mockResolvedValue(null);

    await ingest(service);

    const query = prisma.payment.findFirst.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy?: unknown;
    };
    expect(query.where).toMatchObject({ providerRef: 'cs_missing' });
    expect(query.orderBy).toBeUndefined();
    expect(orders.applyPaymentResult).not.toHaveBeenCalled();
    expect(prisma.paymentReconciliationItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          result: 'credit_failed',
          detail: expect.stringContaining('cs_missing'),
        }),
      }),
    );
    expect(prisma.paymentNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('无 providerRef 的历史回调保留按同渠道最新 Payment 匹配的兼容逻辑', async () => {
    const { service, prisma, orders } = makeHarness(paidResult());

    await ingest(service);

    const query = prisma.payment.findFirst.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy?: unknown;
    };
    expect(query.where).not.toHaveProperty('providerRef');
    expect(query.orderBy).toEqual({ createdAt: 'desc' });
    expect(orders.applyPaymentResult).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'pay_old' }),
    );
  });
});

describe('PaymentNotificationService 收件箱并发闸', () => {
  beforeEach(() => {
    adapterMock.verifyNotification.mockReset();
    adapterMock.ack.mockReset();
  });

  it('同步处理前先把行 claim 成 processing，与 worker 抢同一把锁', async () => {
    const { service, prisma } = makeHarness();

    await ingest(service);

    const claim = prisma.paymentNotification.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(claim.where).toMatchObject({
      id: NOTIFICATION_ID,
      status: { in: ['pending', 'failed'] },
    });
    expect(claim.data).toMatchObject({
      status: 'processing',
      attempts: { increment: 1 },
    });
  });

  it('行已被另一条路径占住时 ack 失败，不重复入账', async () => {
    const { service, prisma, orders, notificationRow } = makeHarness();
    prisma.paymentNotification.updateMany.mockResolvedValue({ count: 0 });
    prisma.paymentNotification.findUnique.mockImplementation(
      async ({ where }: { where: { id?: string } }) =>
        where.id ? { ...notificationRow, status: 'processing' } : null,
    );

    const ack = await ingest(service);

    expect(ack.status).toBe(400);
    expect(orders.applyPaymentResult).not.toHaveBeenCalled();
  });

  it('行已处理完时直接 ack 成功，渠道停止重试', async () => {
    const { service, prisma, orders, notificationRow } = makeHarness();
    prisma.paymentNotification.updateMany.mockResolvedValue({ count: 0 });
    prisma.paymentNotification.findUnique.mockImplementation(
      async ({ where }: { where: { id?: string } }) =>
        where.id ? { ...notificationRow, status: 'processed' } : null,
    );

    const ack = await ingest(service);

    expect(ack.status).toBe(200);
    expect(orders.applyPaymentResult).not.toHaveBeenCalled();
  });

  it('处理过程抛异常时把行退回可重试状态，而不是留在 processing', async () => {
    const { service, prisma } = makeHarness();
    prisma.order.findUnique.mockRejectedValue(new Error('db down'));

    const ack = await ingest(service);

    expect(ack.status).toBe(400);
    expect(prisma.paymentNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: NOTIFICATION_ID },
        data: expect.objectContaining({
          status: 'failed',
          nextAttemptAt: expect.any(Date),
        }),
      }),
    );
  });
});
