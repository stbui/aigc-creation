import { createCipheriv, randomBytes } from 'node:crypto';
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
import { AppError } from '../common/app.exception';

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

function stateResult(state: 'failed' | 'closed'): NotificationResult {
  return {
    ok: true,
    eventId: `evt_${state}`,
    merchantOrderNo: ORDER_NO,
    providerTradeNo: 'pi_1',
    providerRef: 'cs_old',
    amountCents: 0,
    currency: 'CNY',
    state,
    providerStatus: `stripe.${state}`,
    ackSuccess: true,
    reason: state === 'failed' ? 'Stripe PaymentIntent 支付失败' : 'Stripe PaymentIntent 已取消',
    rawPayload: `{"state":"${state}"}`,
  };
}

function makeHarness(notification: NotificationResult = paidResult('cs_old')) {
  const paymentRef = notification.ok ? notification.providerRef ?? null : null;
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
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(notificationRow, data);
        return notificationRow;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(notificationRow, data);
        return notificationRow;
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    order: {
      findUnique: vi.fn().mockResolvedValue({ id: 'order_1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    payment: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'pay_old',
        orderId: 'order_1',
        channel: 'stripe',
        providerConfigId: CONFIG_ID,
        providerConfigVersion: 1,
        providerInstanceId: 'default',
        providerMethod: 'alipay',
        providerRef: paymentRef,
        payTransactionId: null,
        status: 'pending',
        createdAt: new Date(),
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'pay_old',
          orderId: 'order_1',
          channel: 'stripe',
          providerConfigId: CONFIG_ID,
          providerConfigVersion: 1,
          providerInstanceId: 'default',
          providerMethod: 'alipay',
          providerRef: paymentRef,
          payTransactionId: null,
          status: 'pending',
          createdAt: new Date(),
        },
      ]),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
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
  return { service, prisma, configs, orders, exceptions, notificationRow };
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

    const query = prisma.payment.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy?: unknown;
    };
    expect(query.where).toMatchObject({
      orderId: 'order_1',
      channel: 'stripe',
      OR: [{ providerConfigId: CONFIG_ID }, { providerConfigId: null }],
      providerRef: 'cs_old',
    });
    expect(query.orderBy).toEqual({ createdAt: 'desc' });
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
    prisma.payment.findMany.mockResolvedValue([]);

    await ingest(service);

    const query = prisma.payment.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy?: unknown;
    };
    expect(query.where).toMatchObject({ providerRef: 'cs_missing' });
    expect(query.orderBy).toEqual({ createdAt: 'desc' });
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

  it('无 providerRef 的历史回调只按订单、渠道和配置唯一匹配 Payment', async () => {
    const { service, prisma, orders } = makeHarness(paidResult());

    await ingest(service);

    const query = prisma.payment.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      orderBy?: unknown;
    };
    expect(query.where).not.toHaveProperty('providerRef');
    expect(query.orderBy).toEqual({ createdAt: 'desc' });
    expect(orders.applyPaymentResult).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'pay_old' }),
    );
  });

  it('同一配置存在多个待支付尝试时不按创建时间猜测归属', async () => {
    const { service, prisma, configs, orders, exceptions } = makeHarness(paidResult());
    configs.byId.mockResolvedValue({
      id: CONFIG_ID,
      providerId: 'alipay',
      version: 1,
      instanceId: 'default',
      values: {},
    });
    const attempts = [
      {
        id: 'pay_old',
        orderId: 'order_1',
        channel: 'alipay',
        providerConfigId: CONFIG_ID,
        providerConfigVersion: 1,
        providerInstanceId: 'default',
        providerMethod: 'alipay',
        providerRef: null,
        payTransactionId: null,
        status: 'pending',
        createdAt: new Date('2026-11-03T01:00:00.000Z'),
      },
      {
        id: 'pay_new',
        orderId: 'order_1',
        channel: 'alipay',
        providerConfigId: CONFIG_ID,
        providerConfigVersion: 1,
        providerInstanceId: 'default',
        providerMethod: 'alipay',
        providerRef: null,
        payTransactionId: null,
        status: 'pending',
        createdAt: new Date('2026-11-03T02:00:00.000Z'),
      },
    ];
    prisma.payment.findMany.mockResolvedValue(attempts);
    prisma.payment.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        attempts.find((payment) => payment.id === where.id) ?? null,
    );

    const ack = await service.ingestCanonical({
      providerId: 'alipay',
      headers: {},
      rawBody: Buffer.from('{"out_trade_no":"HJ202611030001","trade_no":"trade_1"}'),
      body: { out_trade_no: ORDER_NO, trade_no: 'trade_1' },
    });

    expect(ack).toMatchObject({ status: 200 });
    expect(orders.applyPaymentResult).not.toHaveBeenCalled();
    expect(exceptions.recordManual).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.stringContaining('多个待支付尝试') }),
    );
  });

  it.each([
    ['failed', 'failed'],
    ['closed', 'closed'],
  ] as const)('非成功的 %s 回调落对应 Payment 状态但不入账', async (state, paymentStatus) => {
    const { service, prisma, orders } = makeHarness(stateResult(state));

    const ack = await ingest(service);

    expect(ack).toMatchObject({ status: 200 });
    expect(orders.applyPaymentResult).not.toHaveBeenCalled();
    expect(prisma.payment.updateMany).toHaveBeenCalledWith({
      where: { id: 'pay_old', status: 'pending' },
      data: expect.objectContaining({
        status: paymentStatus,
        providerStatus: `stripe.${state}`,
        rawPayload: `{"state":"${state}"}`,
      }),
    });
    expect(prisma.paymentNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'processed' }),
      }),
    );
  });

  it('已取消订单的迟到成功回调走自动原路退款', async () => {
    const { service, prisma, orders, exceptions } = makeHarness(paidResult('cs_old'));
    orders.applyPaymentResult.mockRejectedValue(
      new AppError(40901, '订单当前状态不可支付: cancelled', 409),
    );
    prisma.order.findUnique
      .mockResolvedValueOnce({ id: 'order_1' })
      .mockResolvedValueOnce({ status: 'cancelled' });

    const ack = await ingest(service);

    expect(ack).toMatchObject({ status: 200 });
    expect(exceptions.autoRefundCancelledPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantOrderNo: ORDER_NO,
        providerTradeNo: 'pi_1',
        amountCents: 1005,
      }),
    );
    expect(exceptions.recordManual).not.toHaveBeenCalled();
  });

  it('自动退款落单失败时让渠道重试，不能静默 ACK 成功', async () => {
    const { service, prisma, orders, exceptions } = makeHarness(paidResult('cs_old'));
    orders.applyPaymentResult.mockRejectedValue(
      new AppError(40901, '订单当前状态不可支付: cancelled', 409),
    );
    prisma.order.findUnique
      .mockResolvedValueOnce({ id: 'order_1' })
      .mockResolvedValueOnce({ status: 'cancelled' });
    exceptions.autoRefundCancelledPayment.mockRejectedValue(new Error('refund db down'));

    const ack = await ingest(service);

    expect(ack).toMatchObject({ status: 400 });
    expect(prisma.paymentNotification.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });
});

describe('PaymentNotificationService 易支付固化支付方式', () => {
  const EPAY_CONFIG_ID = 'cfg_epay_1';
  const EPAY_PROVIDER_REF = 'epay-trade-1';

  function epayPaidResult(): NotificationResult {
    return {
      ok: true,
      eventId: `epay:${EPAY_PROVIDER_REF}:paid`,
      merchantOrderNo: ORDER_NO,
      providerTradeNo: EPAY_PROVIDER_REF,
      providerRef: EPAY_PROVIDER_REF,
      amountCents: 1005,
      currency: 'CNY',
      state: 'paid',
      providerStatus: 'PAY_SUCCESS',
      ackSuccess: true,
      rawPayload: '{}',
    };
  }

  function makeEpayHarness(input: { providerMethod?: 'alipay' | 'wechat' | null } = {}) {
    const notificationRow = {
      id: NOTIFICATION_ID,
      providerId: 'epay',
      providerEventId: `epay:${EPAY_PROVIDER_REF}:paid`,
      providerConfigId: EPAY_CONFIG_ID,
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
    const payment = {
      id: 'pay_epay_1',
      orderId: 'order_epay_1',
      channel: 'epay',
      providerConfigId: EPAY_CONFIG_ID,
      providerConfigVersion: 1,
      providerInstanceId: 'default',
      providerMethod: input.providerMethod === undefined ? 'alipay' : input.providerMethod,
      providerRef: EPAY_PROVIDER_REF,
      payTransactionId: null,
      status: 'pending',
      createdAt: new Date(),
    };
    const prisma = {
      paymentNotification: {
        findUnique: vi.fn(async ({ where }: { where: { id?: string } }) =>
          where.id ? notificationRow : null,
        ),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(notificationRow, data);
          return notificationRow;
        }),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(notificationRow, data);
          return notificationRow;
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      order: {
        findUnique: vi.fn().mockResolvedValue({ id: 'order_epay_1' }),
      },
      payment: {
        findFirst: vi.fn().mockResolvedValue(payment),
        findMany: vi.fn().mockResolvedValue([payment]),
        findUnique: vi.fn().mockResolvedValue(payment),
        update: vi.fn().mockResolvedValue({}),
      },
      paymentReconciliationRun: {
        findFirst: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValue({ _max: { attempt: null } }),
        create: vi.fn().mockResolvedValue({ id: 'run_1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      paymentReconciliationItem: {
        upsert: vi.fn().mockResolvedValue({}),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    };
    const cipher = {
      encrypt: vi.fn().mockReturnValue('cipher'),
      decrypt: vi.fn().mockReturnValue('{}'),
    };
    const configs = {
      byId: vi.fn().mockResolvedValue({
        id: EPAY_CONFIG_ID,
        providerId: 'epay',
        version: 1,
        values: { mchId: 'epay-merchant', key: 'epay-secret' },
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
    const service = new PaymentNotificationService(
      prisma as never,
      cipher as never,
      configs as never,
      orders as never,
      exceptions as never,
    );
    return { service, prisma, orders };
  }

  function ingestEpay(service: PaymentNotificationService) {
    const body = {
      mchId: 'epay-merchant',
      orderId: EPAY_PROVIDER_REF,
      param: ORDER_NO,
      type: '2',
      price: '10.05',
      reallyPrice: '10.05',
      sign: 'signed',
    };
    return service.ingest({
      providerId: 'epay',
      configId: EPAY_CONFIG_ID,
      headers: {},
      rawBody: Buffer.from(new URLSearchParams(body).toString()),
      body,
    });
  }

  beforeEach(() => {
    adapterMock.verifyNotification.mockReset();
    adapterMock.ack.mockReset();
    adapterMock.ack.mockImplementation((result: NotificationResult) => ({
      status: result.ok && result.ackSuccess ? 200 : 400,
      body: result.ok && result.ackSuccess ? 'success' : 'fail',
      contentType: 'text/plain; charset=utf-8',
    }));
  });

  it('找不到历史支付尝试时在验签前拒绝，且不落收件箱', async () => {
    const { service, prisma } = makeEpayHarness();
    prisma.order.findUnique.mockResolvedValue(null);

    const ack = await ingestEpay(service);

    expect(ack).toMatchObject({ status: 400, body: 'fail' });
    expect(adapterMock.verifyNotification).not.toHaveBeenCalled();
    expect(prisma.paymentNotification.create).not.toHaveBeenCalled();
  });

  it('历史 Payment 没有 providerMethod 时分别用两种 type 验签，只接受签名通过的一种', async () => {
    const { service, prisma } = makeEpayHarness({ providerMethod: null });
    adapterMock.verifyNotification
      .mockResolvedValueOnce({
        ok: false,
        ackSuccess: false,
        reason: 'type 不匹配',
        rawPayload: '{}',
      })
      .mockResolvedValueOnce(epayPaidResult());

    const ack = await ingestEpay(service);

    expect(ack).toMatchObject({ status: 200, body: 'success' });
    expect(adapterMock.verifyNotification).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ expectedPaymentMethod: 'alipay' }),
    );
    expect(adapterMock.verifyNotification).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ expectedPaymentMethod: 'wechat' }),
    );
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'pay_epay_1' },
        data: expect.objectContaining({ providerMethod: 'wechat' }),
      }),
    );
  });

  it.each(['alipay', 'wechat'] as const)(
    '历史支付方式为 %s 时把它作为期望 type 交给验签',
    async (providerMethod) => {
      const { service, prisma, orders } = makeEpayHarness({ providerMethod });
      adapterMock.verifyNotification.mockResolvedValue(epayPaidResult());

      const ack = await ingestEpay(service);

      expect(ack).toMatchObject({ status: 200, body: 'success' });
      expect(adapterMock.verifyNotification).toHaveBeenCalledWith(
        expect.objectContaining({ expectedPaymentMethod: providerMethod }),
      );
      expect(prisma.paymentNotification.create).toHaveBeenCalledTimes(1);
      expect(orders.applyPaymentResult).toHaveBeenCalledWith(
        expect.objectContaining({
          providerId: 'epay',
          paymentId: 'pay_epay_1',
          providerRef: EPAY_PROVIDER_REF,
        }),
      );
    },
  );

  it('回调带云端 orderId 时按 providerRef 精确定位历史支付尝试', async () => {
    const { service, prisma } = makeEpayHarness();
    adapterMock.verifyNotification.mockResolvedValue({
      ok: false,
      ackSuccess: false,
      reason: '测试提前结束',
      rawPayload: '{}',
    });

    await ingestEpay(service);

    const query = prisma.payment.findFirst.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(query.where).toMatchObject({
      orderId: 'order_epay_1',
      channel: 'epay',
      providerConfigId: EPAY_CONFIG_ID,
      providerRef: EPAY_PROVIDER_REF,
    });
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

  it('worker 重试遇到未预期异常时也把行退回可重试状态', async () => {
    const { service, prisma, notificationRow } = makeHarness();
    prisma.paymentNotification.findUnique.mockImplementation(
      async ({ where }: { where: { id?: string } }) =>
        where.id
          ? {
              ...notificationRow,
              status: 'processing',
              normalizedJson: JSON.stringify({
                state: 'paid',
                providerTradeNo: 'pi_1',
                providerRef: 'cs_old',
                amountCents: 1005,
                currency: 'CNY',
                providerStatus: 'paid',
              }),
            }
          : null,
    );
    prisma.order.findUnique.mockRejectedValue(new Error('db down'));

    await expect(service.retry(NOTIFICATION_ID)).resolves.toBe('retry');

    expect(prisma.paymentNotification.updateMany).toHaveBeenLastCalledWith({
      where: { id: NOTIFICATION_ID, status: 'processing' },
      data: {
        status: 'failed',
        nextAttemptAt: expect.any(Date),
        lastError: 'db down',
      },
    });
  });
});

describe('PaymentNotificationService 规范回调历史配置', () => {
  const OLD_CONFIG_ID = 'cfg_old';
  const NEW_CONFIG_ID = 'cfg_new';

  function config(id: string, providerId: 'alipay' | 'wechat', values: Record<string, string>) {
    return {
      id,
      providerId,
      instanceId: `instance_${id}`,
      name: id,
      sortOrder: 0,
      version: id === OLD_CONFIG_ID ? 1 : 2,
      enabled: true,
      closeAfterMinutes: 30,
      minAmountCents: null,
      maxAmountCents: null,
      dailyLimitCents: null,
      refundEnabled: true,
      paymentMethods: ['alipay', 'wechat'],
      values,
    };
  }

  function makeCanonicalHarness(input: {
    providerId: 'alipay' | 'wechat';
    configs: ReturnType<typeof config>[];
    payments: Array<{
      providerConfigId: string;
      providerMethod: string | null;
      providerRef: string | null;
      payTransactionId: string | null;
    }>;
    references?: Array<{ providerConfigId: string }>;
  }) {
    const normalizedPayments = input.payments.map((payment, index) => ({
      id: `pay_canonical_${index}`,
      orderId: 'order_canonical_1',
      channel: input.providerId,
      providerConfigVersion: 1,
      providerInstanceId: `instance_${payment.providerConfigId}`,
      status: 'pending',
      createdAt: new Date(Date.now() - index * 1000),
      ...payment,
    }));
    const normalizedReferences = (input.references ?? input.payments).map(
      (payment, index) => ({
        ...normalizedPayments[index],
        ...payment,
      }),
    );
    const notificationRow = {
      id: NOTIFICATION_ID,
      providerId: input.providerId,
      providerEventId: 'evt_1',
      providerConfigId: OLD_CONFIG_ID,
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
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(notificationRow, data);
          return notificationRow;
        }),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(notificationRow, data);
          return notificationRow;
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      order: {
        findUnique: vi.fn().mockResolvedValue({ id: 'order_canonical_1' }),
      },
      payment: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce(normalizedReferences)
          .mockResolvedValue(normalizedPayments),
        findFirst: vi.fn().mockResolvedValue({
          id: 'pay_canonical_old',
          providerInstanceId: 'instance_old',
        }),
        findUnique: vi.fn().mockResolvedValue(normalizedPayments[0]),
        update: vi.fn().mockResolvedValue({}),
      },
      paymentReconciliationRun: {
        findFirst: vi.fn().mockResolvedValue(null),
        aggregate: vi.fn().mockResolvedValue({ _max: { attempt: null } }),
        create: vi.fn().mockResolvedValue({ id: 'run_1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      paymentReconciliationItem: {
        upsert: vi.fn().mockResolvedValue({}),
        groupBy: vi.fn().mockResolvedValue([]),
      },
    };
    const byId = new Map(input.configs.map((item) => [item.id, item]));
    const configs = {
      byId: vi.fn(async (id: string) => {
        const found = byId.get(id);
        if (!found) throw new Error(`missing config ${id}`);
        return found;
      }),
    };
    const cipher = {
      encrypt: vi.fn().mockReturnValue('cipher'),
      decrypt: vi.fn().mockReturnValue('{}'),
    };
    const orders = {
      applyPaymentResult: vi.fn().mockResolvedValue({ applied: true, idempotentHit: false }),
    };
    const exceptions = {
      recordManual: vi.fn().mockResolvedValue({}),
      autoRefundCancelledPayment: vi.fn().mockResolvedValue({ outcome: 'manual_review' }),
    };
    const service = new PaymentNotificationService(
      prisma as never,
      cipher as never,
      configs as never,
      orders as never,
      exceptions as never,
    );
    return { service, prisma, configs, orders };
  }

  function alipayResult(providerTradeNo = 'ali_trade_1'): NotificationResult {
    return {
      ok: true,
      eventId: `alipay:${providerTradeNo}`,
      merchantOrderNo: ORDER_NO,
      providerTradeNo,
      amountCents: 1005,
      currency: 'CNY',
      state: 'paid',
      providerStatus: 'TRADE_SUCCESS',
      ackSuccess: true,
      rawPayload: '{}',
    };
  }

  function wechatBody(orderNo: string, apiV3Key: string) {
    const nonce = randomBytes(6).toString('hex');
    const associatedData = 'transaction';
    const plain = JSON.stringify({
      out_trade_no: orderNo,
      transaction_id: 'wx_trade_1',
      trade_state: 'SUCCESS',
      success_time: '2026-11-09T10:00:00+08:00',
      amount: { total: 1005 },
    });
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(apiV3Key, 'utf8'),
      Buffer.from(nonce, 'utf8'),
    );
    cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const body = {
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64'),
        nonce,
        associated_data: associatedData,
      },
    };
    return { body, rawBody: Buffer.from(JSON.stringify(body)) };
  }

  beforeEach(() => {
    adapterMock.verifyNotification.mockReset();
    adapterMock.ack.mockReset();
    adapterMock.ack.mockImplementation((result: NotificationResult) => ({
      status: result.ok && result.ackSuccess ? 200 : 400,
      body: result.ok && result.ackSuccess ? 'success' : 'fail',
      contentType: 'text/plain; charset=utf-8',
    }));
  });

  it('配置轮换后规范回调只使用订单引用的历史配置验签', async () => {
    const { service, prisma, configs } = makeCanonicalHarness({
      providerId: 'alipay',
      configs: [
        config(OLD_CONFIG_ID, 'alipay', { appId: 'old-app' }),
        config(NEW_CONFIG_ID, 'alipay', { appId: 'new-app' }),
      ],
      payments: [
        {
          providerConfigId: OLD_CONFIG_ID,
          providerMethod: 'alipay',
          providerRef: null,
          payTransactionId: 'ali_trade_1',
        },
      ],
    });
    adapterMock.verifyNotification.mockResolvedValue(alipayResult());

    const ack = await service.ingestCanonical({
      providerId: 'alipay',
      headers: {},
      rawBody: Buffer.from('out_trade_no=HJ202611030001&trade_status=TRADE_SUCCESS'),
      body: {
        out_trade_no: ORDER_NO,
        trade_no: 'ali_trade_1',
        trade_status: 'TRADE_SUCCESS',
      },
    });

    expect(ack).toMatchObject({ status: 200, body: 'success' });
    expect(configs.byId).toHaveBeenCalledTimes(1);
    expect(configs.byId).toHaveBeenCalledWith(OLD_CONFIG_ID);
    expect(adapterMock.verifyNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ configId: OLD_CONFIG_ID }),
      }),
    );
    expect(prisma.paymentNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ providerConfigId: OLD_CONFIG_ID }),
      }),
    );
  });

  it('多个历史配置同时验签通过且交易号无法唯一消歧时拒绝处理', async () => {
    const { service, prisma } = makeCanonicalHarness({
      providerId: 'alipay',
      configs: [
        config(OLD_CONFIG_ID, 'alipay', { appId: 'same-app' }),
        config(NEW_CONFIG_ID, 'alipay', { appId: 'same-app' }),
      ],
      payments: [
        {
          providerConfigId: OLD_CONFIG_ID,
          providerMethod: 'alipay',
          providerRef: null,
          payTransactionId: 'ali_trade_old',
        },
        {
          providerConfigId: NEW_CONFIG_ID,
          providerMethod: 'alipay',
          providerRef: null,
          payTransactionId: 'ali_trade_new',
        },
      ],
    });
    adapterMock.verifyNotification.mockResolvedValue(alipayResult('ali_trade_unknown'));

    const ack = await service.ingestCanonical({
      providerId: 'alipay',
      headers: {},
      rawBody: Buffer.from('out_trade_no=HJ202611030001&trade_status=TRADE_SUCCESS'),
      body: {
        out_trade_no: ORDER_NO,
        trade_no: 'ali_trade_unknown',
        trade_status: 'TRADE_SUCCESS',
      },
    });

    expect(ack).toMatchObject({ status: 400, body: 'fail' });
    expect(adapterMock.verifyNotification).toHaveBeenCalledTimes(2);
    expect(prisma.paymentNotification.create).not.toHaveBeenCalled();
  });

  it('微信规范回调用历史 APIv3 密钥解密后，再用对应历史配置验签', async () => {
    const oldKey = '0123456789abcdef0123456789abcdef';
    const newKey = 'fedcba9876543210fedcba9876543210';
    const encrypted = wechatBody(ORDER_NO, oldKey);
    const { service, prisma, configs } = makeCanonicalHarness({
      providerId: 'wechat',
      configs: [
        config(OLD_CONFIG_ID, 'wechat', {
          apiV3Key: oldKey,
          wechatPayPublicKeyId: 'PUB_KEY_ID_OLD',
        }),
        config(NEW_CONFIG_ID, 'wechat', {
          apiV3Key: newKey,
          wechatPayPublicKeyId: 'PUB_KEY_ID_NEW',
        }),
      ],
      payments: [
        {
          providerConfigId: OLD_CONFIG_ID,
          providerMethod: 'wechat',
          providerRef: 'wx_ref_old',
          payTransactionId: 'wx_trade_1',
        },
      ],
      references: [
        { providerConfigId: OLD_CONFIG_ID },
        { providerConfigId: NEW_CONFIG_ID },
      ],
    });
    adapterMock.verifyNotification.mockResolvedValue({
      ok: true,
      eventId: 'wx_trade_1',
      merchantOrderNo: ORDER_NO,
      providerTradeNo: 'wx_trade_1',
      amountCents: 1005,
      currency: 'CNY',
      state: 'paid',
      providerStatus: 'SUCCESS',
      ackSuccess: true,
      rawPayload: '{}',
    });

    const ack = await service.ingestCanonical({
      providerId: 'wechat',
      headers: { 'wechatpay-serial': 'PUB_KEY_ID_OLD' },
      rawBody: encrypted.rawBody,
      body: encrypted.body,
    });

    expect(ack).toMatchObject({ status: 200, body: 'success' });
    expect(configs.byId).toHaveBeenCalledTimes(3);
    expect(adapterMock.verifyNotification).toHaveBeenCalledTimes(1);
    expect(adapterMock.verifyNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ configId: OLD_CONFIG_ID }),
        headers: expect.objectContaining({ 'wechatpay-serial': 'PUB_KEY_ID_OLD' }),
      }),
    );
    expect(prisma.paymentNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ providerConfigId: OLD_CONFIG_ID }),
      }),
    );
  });
});
