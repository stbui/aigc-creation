import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { epayCallbackSign } from './adapters/epay.adapter';

/*
 * 支付 HTTP 集成测试（L1.6+）。
 *
 * 与 smoke 的区别：
 *   · 自建临时 SQLite，不碰 dev.db / test.db；
 *   · 同进程起真实 Nest app（superagent 打真实 HTTP 栈），不依赖已启动的服务；
 *   · 每次 `npm test` 都跑，不需要人工记得起后端。
 *
 * 需要补的仍是“真实渠道”与“多实例并发”，这里只覆盖单体 + SQLite 的契约。
 */
const BACKEND_ROOT = process.cwd();
const DB_DIR = mkdtempSync(join(tmpdir(), 'huojue-pay-it-'));
const DB_PATH = join(DB_DIR, 'payments.db');
const DB_URL = `file:${DB_PATH}`;

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = DB_URL;
process.env.PAYMENT_WORKER_ENABLED = 'false';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-do-not-reuse-in-prod';
process.env.PAYMENT_NOTIFY_BASE = 'http://127.0.0.1:4100';

let app: INestApplication;
// Prisma 的真实类型由 @prisma/client 生成；集成测试里只用到少数方法，避免拉全量类型
let prisma: any;
let baseUrl = '';
let userToken = '';
let adminToken = '';
let productId = '';
let membershipPlanId = '';
let membershipService: any;
let orderService: any;
let userGroupService: any;
let paymentGateway: any;
let run = '';

function api(method: 'get' | 'post' | 'put' | 'patch', path: string, token?: string) {
  // supertest 传 URL 字符串时不会自己 listen/close，并发请求不会互相关掉临时监听
  const req = request(baseUrl)[method](path);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
}

async function register(email: string) {
  const res = await api('post', '/api/v1/auth/register').send({
    email,
    password: 'test123456',
    name: '集成测试用户',
  });
  expect(res.status).toBe(201);
  expect(res.body.code).toBe(0);
  return res.body.data.accessToken as string;
}

async function createOrder(tag: string, token = userToken, targetProductId = productId) {
  const res = await api('post', '/api/v1/orders', token).send({
    productId: targetProductId,
    quantity: 1,
    idempotencyKey: `it-${run}-${tag}`,
  });
  expect(res.status).toBe(201);
  expect(res.body.code).toBe(0);
  return res.body.data as { id: string; orderNo: string; paidCents: number };
}

const EPAY_API_BASE = 'https://epay.example.com';
const EPAY_MCH_ID = 'it-mch';
const EPAY_KEY = 'it-secret';

async function intend(orderId: string, token = userToken) {
  const res = await api('post', `/api/v1/payments/${orderId}/intent`, token).send({
    providerId: 'alipay',
  });
  expect(res.status).toBe(201);
  expect(res.body.code).toBe(0);
  return res.body.data as {
    configId: string;
    mode: string;
    sandbox: boolean;
    providerId: string;
    payUrl?: string;
    checkoutValue?: string;
  };
}

/**
 * 易支付回调以 `Payment.providerRef` 作为渠道订单号；这里从历史支付尝试
 * 反查，确保回调能精确命中当初固化的 providerMethod。
 */
async function paymentAttempt(orderNo: string, configId: string) {
  const order = await prisma.order.findUnique({ where: { orderNo } });
  if (!order) throw new Error(`测试订单不存在: ${orderNo}`);
  const payment = await prisma.payment.findFirst({
    where: { orderId: order.id, channel: 'epay', providerConfigId: configId },
    orderBy: { createdAt: 'desc' },
  });
  if (!payment?.providerRef) throw new Error(`测试支付尝试缺少 providerRef: ${orderNo}`);
  return { order, payment, providerRef: String(payment.providerRef) };
}

function epayCallbackBody(
  orderNo: string,
  providerRef: string,
  type: '1' | '2',
  priceCents: number,
  reallyPriceCents: number,
) {
  const price = (priceCents / 100).toFixed(2);
  const reallyPrice = (reallyPriceCents / 100).toFixed(2);
  return {
    mchId: EPAY_MCH_ID,
    orderId: providerRef,
    param: orderNo,
    type,
    price,
    reallyPrice,
    sign: epayCallbackSign(providerRef, orderNo, type, price, reallyPrice, EPAY_KEY),
  };
}

async function callback(
  orderNo: string,
  configId: string,
  _tradeNo: string,
  amountCents: number,
) {
  const { order, payment, providerRef } = await paymentAttempt(orderNo, configId);
  const type = payment.providerMethod === 'wechat' ? '1' : '2';
  return api('post', `/api/v1/payments/callback/epay/${configId}`).send(
    epayCallbackBody(orderNo, providerRef, type, order.paidCents, amountCents),
  );
}

async function canonicalCallback(
  orderNo: string,
  configId: string,
  amountCents: number,
) {
  const { order, payment, providerRef } = await paymentAttempt(orderNo, configId);
  const type = payment.providerMethod === 'wechat' ? '1' : '2';
  return api('post', '/api/v1/payment/webhook/easypay').send(
    epayCallbackBody(orderNo, providerRef, type, order.paidCents, amountCents),
  );
}

async function callbackGet(
  orderNo: string,
  configId: string,
  _tradeNo: string,
  amountCents: number,
) {
  const { order, payment, providerRef } = await paymentAttempt(orderNo, configId);
  const type = payment.providerMethod === 'wechat' ? '1' : '2';
  return api('get', `/api/v1/payments/callback/epay/${configId}`).query(
    epayCallbackBody(orderNo, providerRef, type, order.paidCents, amountCents),
  );
}

/** 没有历史 Payment 的易支付回调：验签前就应被拒绝。 */
function unknownCallback(orderNo: string, configId: string) {
  const providerRef = `UNKNOWN-${orderNo}`;
  return api('post', `/api/v1/payments/callback/epay/${configId}`).send(
    epayCallbackBody(orderNo, providerRef, '2', 100, 100),
  );
}

async function paidOrder(tag: string) {
  const order = await createOrder(tag);
  const intent = await intend(order.id);
  const res = await callback(order.orderNo, intent.configId, `IT-PAID-${tag}-${run}`, order.paidCents);
  expect(res.status).toBe(200);
  expect(res.text).toBe('success');
  return order;
}

async function createMembershipOrder(
  tag: string,
  token: string,
  targetPlanId = membershipPlanId,
) {
  const res = await api('post', '/api/v1/orders', token).send({
    membershipPlanId: targetPlanId,
    idempotencyKey: `it-membership-${tag}-${run}`,
  });
  expect(res.status).toBe(201);
  expect(res.body.code).toBe(0);
  return res.body.data as { id: string; orderNo: string; paidCents: number };
}

async function payOrder(order: { id: string; orderNo: string; paidCents: number }, token: string, tag: string) {
  const intent = await intend(order.id, token);
  const paid = await callback(
    order.orderNo,
    intent.configId,
    `IT-MEMBERSHIP-${tag}-${run}`,
    order.paidCents,
  );
  expect(paid.status).toBe(200);
  expect(paid.text).toBe('success');
  return order;
}

async function paidMembershipOrder(
  tag: string,
  token: string,
  targetPlanId = membershipPlanId,
) {
  const order = await createMembershipOrder(tag, token, targetPlanId);
  return payOrder(order, token, tag);
}

beforeAll(async () => {
  run = `${Date.now()}`;
  // 用 Prisma CLI 建一份独立 schema；--url 显式覆盖 config 里的库路径
  execFileSync(join(BACKEND_ROOT, 'node_modules', '.bin', 'prisma'), ['db', 'push', '--url', DB_URL], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: DB_URL },
    stdio: 'pipe',
  });

  const { AppModule } = await import('../app.module');
  const { ResponseInterceptor } = await import('../common/response.interceptor');
  const { PrismaService } = await import('../prisma/prisma.service');
  const { MembershipService } = await import('../membership/membership.service');
  const { OrderService } = await import('../orders/order.service');
  const { PaymentGateway } = await import('../payments/payment-gateway');
  const { UserGroupService } = await import('../model/user-groups/user-group.service');
  const { SchedulerService } = await import('../admin/scheduler.service');
  const { ROLE_PERMISSIONS } = await import('../admin/permissions');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // 调度器会起真实定时器，集成测试里替换为空实现
    .overrideProvider(SchedulerService)
    .useValue({
      onModuleInit: () => undefined,
      onModuleDestroy: () => undefined,
      tick: async () => undefined,
      taskStatus: () => [],
      runNow: async () => ({ name: 'noop' }),
    })
    .compile();

  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  await app.init();
  // 先监听一个真实随机端口：supertest 传 URL 字符串，并发请求不会互相关监听
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
  prisma = app.get(PrismaService);
  membershipService = app.get(MembershipService);
  orderService = app.get(OrderService);
  paymentGateway = app.get(PaymentGateway);
  userGroupService = app.get(UserGroupService);

  const product = await prisma.product.create({
    data: {
      sku: `IT-PAY-${run}`,
      name: `集成测试积分包 ${run}`,
      description: '',
      kind: 'credits',
      currency: 'CNY',
      priceCents: 1000,
      credits: 100,
      creditsValidDays: 0,
      grantType: 'immediate',
      status: 'active',
      saleStrategy: 'unlimited',
      sortOrder: 9999,
    },
  });
  productId = product.id;

  const membershipPlan = await prisma.membershipPlan.create({
    data: {
      code: `IT-MEMBER-${run}`,
      name: `集成测试会员 ${run}`,
      description: '',
      priceCents: 300,
      durationDays: 30,
      monthlyCredits: 25,
      perks: JSON.stringify({ fastChannel: true, maxConcurrent: 2, addonDiscountBps: 9500 }),
      status: 'active',
      sortOrder: 9999,
    },
  });
  membershipPlanId = membershipPlan.id;

  const admin = await prisma.user.create({
    data: {
      email: `it-admin-${run}@test.local`,
      passwordHash: await bcrypt.hash('test123456', 10),
      name: '集成测试管理员',
      role: 'admin',
    },
  });
  await prisma.adminRole.upsert({
    where: { code: 'admin' },
    update: { permissions: JSON.stringify(ROLE_PERMISSIONS.admin) },
    create: {
      code: 'admin',
      name: '管理员',
      permissions: JSON.stringify(ROLE_PERMISSIONS.admin),
    },
  });

  userToken = await register(`it-user-${run}@test.local`);
  const adminLogin = await api('post', '/api/v1/auth/login').send({
    email: `it-admin-${run}@test.local`,
    password: 'test123456',
  });
  expect(adminLogin.status).toBe(201);
  adminToken = adminLogin.body.data.accessToken;

  /*
   * 集成测试走真实 EasyPay 协议链路，但把网络限制在本地 mock：
   * createOrder 返回固定收银台，getOrder 统一返回已关闭（state=-1），
   * 这样取消订单的“先查单再关单”路径可以完成本地关单。
   */
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const raw =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw);
      if (url.hostname === 'epay.example.com') {
        if (url.pathname.endsWith('/api/createOrder')) {
          const payId = url.searchParams.get('payId') ?? '';
          return new Response(
            JSON.stringify({
              code: 1,
              data: {
                orderId: `EPAY-${payId}`,
                payId,
                state: 0,
                price: url.searchParams.get('price') ?? '0.00',
                payUrl: `https://epay.example.com/pay/${payId}`,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        if (url.pathname.endsWith('/api/getOrder')) {
          const providerRef = url.searchParams.get('orderId') ?? '';
          const payId =
            url.searchParams.get('payId') ??
            (providerRef.startsWith('EPAY-') ? providerRef.slice(5) : providerRef);
          return new Response(
            JSON.stringify({
              code: 1,
              data: { orderId: providerRef || `EPAY-${payId}`, payId, state: -1 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        throw new Error(`未模拟的易支付端点: ${url.pathname}`);
      }
      return realFetch(input, init);
    }),
  );

  const provider = await api(
    'put',
    '/api/v1/admin/payments/providers/epay/config',
    adminToken,
  ).send({
    enabled: true,
    closeAfterMinutes: 30,
    values: { apiBase: EPAY_API_BASE, mchId: EPAY_MCH_ID, key: EPAY_KEY },
  });
  expect(provider.status).toBe(200);

  const paymentSettings = await api(
    'put',
    '/api/v1/admin/payments/settings',
    adminToken,
  ).send({
    defaultCurrency: 'CNY',
    alipaySource: 'epay',
    wechatSource: 'unset',
  });
  expect(paymentSettings.status).toBe(200);

  // 支付总开关默认关闭。集成测试要走真实支付链路，必须像运营一样显式开启，
  // 否则公开渠道列表与 intent 都会按预期被拦截。
  const enabledSettings = await api('patch', '/api/v1/admin/settings', adminToken).send({
    settings: { 'payment.enabled': true },
  });
  expect(enabledSettings.status).toBe(200);

  // 易支付没有退款 API；退款编排测试只验证订单域，不验证上游协议。
  paymentGateway.refund = vi.fn().mockResolvedValue({ state: 'succeeded' });
}, 60_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  await app?.close().catch(() => undefined);
  rmSync(DB_DIR, { recursive: true, force: true });
});

describe('支付 HTTP 集成', () => {
  it('公开设置可读，渠道列表需要登录', async () => {
    const settings = await api('get', '/api/v1/payments/settings');
    expect(settings.status).toBe(200);
    expect(settings.body.data.defaultCurrency).toBe('CNY');
    expect(settings.body.data.providers.map((p: { id: string }) => p.id)).toEqual(['alipay']);

    const anon = await api('get', '/api/v1/payments/providers');
    expect(anon.status).toBe(401);
  });

  it('下单 → intent → 易支付回调 → 入账，重复回调幂等', async () => {
    const order = await createOrder('paid');
    const intent = await intend(order.id);
    expect(intent.providerId).toBe('alipay');
    expect(intent.mode).toBe('redirect');
    expect(intent.sandbox).toBe(false);

    const tradeNo = `IT-TRADE-${run}`;
    const first = await callback(order.orderNo, intent.configId, tradeNo, order.paidCents);
    expect(first.status).toBe(200);
    expect(first.text).toBe('success');

    const status = await api('get', `/api/v1/payments/${order.id}/status`, userToken);
    expect(status.body.data.status).toBe('paid');
    const attempt = await prisma.payment.findFirst({
      where: { orderId: order.id, channel: 'epay' },
    });
    expect(status.body.data.payments[0].providerTradeNo).toBe(attempt.providerRef);

    const detail = await api('get', `/api/v1/orders/${order.id}`, userToken);
    expect(detail.body.data.grantedCredits).toBe(100);
    expect(detail.body.data.channel).toBe('epay');

    const dup = await callback(order.orderNo, intent.configId, tradeNo, order.paidCents);
    expect(dup.status).toBe(200);
    expect(dup.text).toBe('success');
    const balance = await api('get', '/api/v1/credits/balance', userToken);
    expect(balance.body.data.balance).toBe(100);
  });

  it('GET 回调与 POST 共用公开回调链路', async () => {
    const order = await createOrder('get-callback');
    const intent = await intend(order.id);
    const res = await callbackGet(
      order.orderNo,
      intent.configId,
      `IT-GET-${run}`,
      order.paidCents,
    );
    expect(res.status).toBe(200);
    expect(res.text).toBe('success');

    const status = await api('get', `/api/v1/payments/${order.id}/status`, userToken);
    expect(status.body.data.status).toBe('paid');
  });

  it('固定 EasyPay Webhook 从历史 Payment 反查配置版本并完成入账', async () => {
    const order = await createOrder('canonical-webhook');
    const intent = await intend(order.id);

    const res = await canonicalCallback(order.orderNo, intent.configId, order.paidCents);
    expect(res.status).toBe(200);
    expect(res.text).toBe('success');

    const status = await api('get', `/api/v1/payments/${order.id}/status`, userToken);
    expect(status.body.data.status).toBe('paid');
    const notification = await prisma.paymentNotification.findFirst({
      where: { providerId: 'epay', merchantOrderNo: order.orderNo },
    });
    expect(notification?.providerConfigId).toBe(intent.configId);
  });

  it('金额不符落对账差异；无历史支付尝试的易支付回调直接拒绝', async () => {
    const order = await createOrder('mismatch');
    const intent = await intend(order.id);
    const bad = await callback(order.orderNo, intent.configId, `IT-BAD-${run}`, order.paidCents + 1);
    expect(bad.status).toBe(200);
    expect(bad.text).toBe('success');

    const status = await api('get', `/api/v1/payments/${order.id}/status`, userToken);
    expect(status.body.data.status).toBe('pending');

    const item = await prisma.paymentReconciliationItem.findFirst({
      where: { merchantOrderNo: order.orderNo, result: 'amount_mismatch' },
    });
    expect(item).toBeTruthy();

    const ghost = await unknownCallback(`GHOST-${run}`, intent.configId);
    expect(ghost.status).toBe(400);
    expect(ghost.text).toBe('fail');
    expect(
      await prisma.paymentNotification.count({
        where: { merchantOrderNo: `GHOST-${run}` },
      }),
    ).toBe(0);
  });

  it('同一商户订单号的多条渠道流水可在同次对账中分别留痕', async () => {
    const reconciliationRun = await prisma.paymentReconciliationRun.create({
      data: {
        providerId: 'alipay',
        billDate: `IT-${run}`,
        attempt: 1,
        source: 'provider',
        status: 'completed',
        completedAt: new Date(),
      },
    });
    const common = {
      runId: reconciliationRun.id,
      providerId: 'alipay',
      merchantOrderNo: `IT-DUPLICATE-${run}`,
      amountCents: 100,
      currency: 'CNY',
      result: 'trade_no_mismatch',
    };
    await prisma.paymentReconciliationItem.create({
      data: { ...common, providerTradeNo: `IT-TRADE-A-${run}` },
    });
    await prisma.paymentReconciliationItem.create({
      data: { ...common, providerTradeNo: `IT-TRADE-B-${run}` },
    });

    expect(
      await prisma.paymentReconciliationItem.count({
        where: { runId: reconciliationRun.id, merchantOrderNo: common.merchantOrderNo },
      }),
    ).toBe(2);
  });

  it('用户取消未支付订单', async () => {
    const order = await createOrder('cancel');
    await intend(order.id);
    const res = await api('post', `/api/v1/orders/${order.id}/cancel`, userToken);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('cancelled');
  });

  it('全额退款：订单终态、积分回收、退款单落库', async () => {
    const order = await createOrder('refund');
    const intent = await intend(order.id);
    await callback(order.orderNo, intent.configId, `IT-REFUND-${run}`, order.paidCents);

    const before = await api('get', '/api/v1/credits/balance', userToken);
    const refund = await api('post', `/api/v1/admin/orders/${order.id}/refund`, adminToken).send({
      amountCents: order.paidCents,
      reason: '集成测试全额退款',
    });
    expect(refund.status).toBe(201);
    expect(refund.body.data.state).toBe('succeeded');
    expect(refund.body.data.fullyRefunded).toBe(true);

    const after = await api('get', '/api/v1/credits/balance', userToken);
    expect(before.body.data.balance - after.body.data.balance).toBe(100);
    const orderAfter = await api('get', `/api/v1/orders/${order.id}`, userToken);
    expect(orderAfter.body.data.status).toBe('refunded');

    const row = await prisma.refund.findFirst({ where: { orderId: order.id } });
    expect((row as { status: string }).status).toBe('succeeded');

    // 退款记账三步在同一事务里提交：退款单成功、订单状态、已退金额必须同时生效
    const settled = await prisma.order.findUnique({ where: { id: order.id } });
    expect(settled?.refundedCents).toBe(order.paidCents);
  });

  it('部分退款累加已退金额，二次退款才转全额终态', async () => {
    const order = await createOrder('partial');
    const intent = await intend(order.id);
    await callback(order.orderNo, intent.configId, `IT-PARTIAL-${run}`, order.paidCents);
    const before = await api('get', '/api/v1/credits/balance', userToken);

    const half = Math.floor(order.paidCents / 2);
    const first = await api('post', `/api/v1/admin/orders/${order.id}/refund`, adminToken).send({
      amountCents: half,
      reason: '集成测试部分退款',
    });
    expect(first.status).toBe(201);
    expect(first.body.data.state).toBe('succeeded');
    expect(first.body.data.fullyRefunded).toBe(false);
    expect(first.body.data.refundedCents).toBe(half);
    expect(first.body.data.creditsReclaimed).toBe(50);
    const afterFirst = await api('get', '/api/v1/credits/balance', userToken);
    expect(before.body.data.balance - afterFirst.body.data.balance).toBe(50);

    const mid = await prisma.order.findUnique({ where: { id: order.id } });
    expect(mid?.status).toBe('partial_refunded');
    expect(mid?.refundedCents).toBe(half);

    const second = await api('post', `/api/v1/admin/orders/${order.id}/refund`, adminToken).send({
      amountCents: order.paidCents - half,
      reason: '集成测试退完剩余',
    });
    expect(second.status).toBe(201);
    expect(second.body.data.fullyRefunded).toBe(true);
    expect(second.body.data.refundedCents).toBe(order.paidCents);
    expect(second.body.data.creditsReclaimed).toBe(50);
    const afterSecond = await api('get', '/api/v1/credits/balance', userToken);
    expect(before.body.data.balance - afterSecond.body.data.balance).toBe(100);

    const done = await prisma.order.findUnique({ where: { id: order.id } });
    expect(done?.status).toBe('refunded');
    expect(done?.refundedCents).toBe(order.paidCents);
  });

  it('发票驳回后可重提，开具后可冲红且保留历史', async () => {
    const order = await paidOrder('invoice-history');
    const first = await api('post', '/api/v1/invoices', userToken).send({
      orderId: order.id,
      kind: 'personal',
      title: '集成测试发票抬头',
      content: '技术服务费',
    });
    expect(first.status).toBe(201);
    expect(first.body.data.status).toBe('pending');
    expect(first.body.data.amountCents).toBe(order.paidCents);

    const duplicate = await api('post', '/api/v1/invoices', userToken).send({
      orderId: order.id,
      kind: 'personal',
      title: '重复申请',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe(40901);

    const rejected = await api(
      'post',
      `/api/v1/admin/invoices/${first.body.data.id}/reject`,
      adminToken,
    ).send({ reason: '抬头填写有误，请重新提交' });
    expect(rejected.status).toBe(201);
    expect(rejected.body.data.status).toBe('rejected');

    const second = await api('post', '/api/v1/invoices', userToken).send({
      orderId: order.id,
      kind: 'personal',
      title: '集成测试发票抬头（重提）',
    });
    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);

    const issued = await api(
      'post',
      `/api/v1/admin/invoices/${second.body.data.id}/issue`,
      adminToken,
    ).send();
    expect(issued.status).toBe(201);
    expect(issued.body.data.status).toBe('issued');

    const fileBefore = await api('get', `/api/v1/invoices/${second.body.data.id}/file`, userToken);
    expect(fileBefore.status).toBe(200);
    expect(fileBefore.headers['content-type']).toContain('text/html');

    const flushed = await api(
      'post',
      `/api/v1/admin/invoices/${second.body.data.id}/red-flush`,
      adminToken,
    ).send({ reason: '集成测试：订单退款后冲红' });
    expect(flushed.status).toBe(201);
    expect(flushed.body.data.status).toBe('red_flushed');
    expect(flushed.body.data.redFlushReason).toBe('集成测试：订单退款后冲红');

    // 冲红仍保留原件供财务追溯，但该订单不再允许申请第三张票。
    const fileAfter = await api('get', `/api/v1/invoices/${second.body.data.id}/file`, userToken);
    expect(fileAfter.status).toBe(200);
    const third = await api('post', '/api/v1/invoices', userToken).send({
      orderId: order.id,
      kind: 'personal',
      title: '冲红后再次申请',
    });
    expect(third.status).toBe(409);

    const history = await prisma.invoice.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((item: { status: string }) => item.status)).toEqual([
      'rejected',
      'red_flushed',
    ]);
  });

  it('退款成功后带回待处理发票提示，全额退款后待开票申请不能再开具', async () => {
    const order = await paidOrder('invoice-refund-pending');
    const invoice = await api('post', '/api/v1/invoices', userToken).send({
      orderId: order.id,
      kind: 'personal',
      title: '退款联动待开票',
    });
    expect(invoice.status).toBe(201);

    const refund = await api('post', `/api/v1/admin/orders/${order.id}/refund`, adminToken).send({
      amountCents: order.paidCents,
      reason: '集成测试：退款后处理待开发票',
    });
    expect(refund.status).toBe(201);
    expect(refund.body.data.state).toBe('succeeded');
    expect(refund.body.data.invoiceFollowUp).toMatchObject({
      invoiceId: invoice.body.data.id,
      invoiceNo: invoice.body.data.invoiceNo,
      status: 'pending',
    });
    expect(refund.body.data.invoiceFollowUp.message).toContain('驳回');

    const issue = await api(
      'post',
      `/api/v1/admin/invoices/${invoice.body.data.id}/issue`,
      adminToken,
    ).send();
    expect(issue.status).toBe(409);
    expect(issue.body.code).toBe(40901);

    const alerts = await api('get', '/api/v1/admin/alerts', adminToken);
    expect(alerts.status).toBe(200);
    expect(alerts.body.data.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'invoice-refund-blocked',
          count: expect.any(Number),
        }),
      ]),
    );
  });

  it('已开具发票退款成功后带回冲红提示', async () => {
    const order = await paidOrder('invoice-refund-issued');
    const invoice = await api('post', '/api/v1/invoices', userToken).send({
      orderId: order.id,
      kind: 'personal',
      title: '退款联动已开票',
    });
    expect(invoice.status).toBe(201);
    const issued = await api(
      'post',
      `/api/v1/admin/invoices/${invoice.body.data.id}/issue`,
      adminToken,
    ).send();
    expect(issued.status).toBe(201);
    expect(issued.body.data.status).toBe('issued');

    const refund = await api('post', `/api/v1/admin/orders/${order.id}/refund`, adminToken).send({
      amountCents: order.paidCents,
      reason: '集成测试：退款后冲红已开发票',
    });
    expect(refund.status).toBe(201);
    expect(refund.body.data.invoiceFollowUp).toMatchObject({
      invoiceId: invoice.body.data.id,
      invoiceNo: invoice.body.data.invoiceNo,
      status: 'issued',
    });
    expect(refund.body.data.invoiceFollowUp.message).toContain('冲红');
  });

  it('退款处理中禁止申请发票，也禁止开具已有待开发票', async () => {
    const applyOrder = await paidOrder('invoice-refund-processing-apply');
    const applyPayment = await prisma.payment.findFirst({
      where: { orderId: applyOrder.id, status: 'succeeded' },
    });
    const applyOrderRow = await prisma.order.findUnique({ where: { id: applyOrder.id } });
    expect(applyPayment).toBeTruthy();
    expect(applyOrderRow).toBeTruthy();
    await prisma.refund.create({
      data: {
        orderId: applyOrder.id,
        paymentId: applyPayment.id,
        userId: applyOrderRow.userId,
        amountCents: applyOrder.paidCents,
        status: 'processing',
        reason: '集成测试：退款处理中',
        operatorId: 'system:test',
      },
    });
    const apply = await api('post', '/api/v1/invoices', userToken).send({
      orderId: applyOrder.id,
      kind: 'personal',
      title: '退款处理中新申请',
    });
    expect(apply.status).toBe(409);
    expect(apply.body.code).toBe(40901);

    const issueOrder = await paidOrder('invoice-refund-processing-issue');
    const invoice = await api('post', '/api/v1/invoices', userToken).send({
      orderId: issueOrder.id,
      kind: 'personal',
      title: '退款处理中待开票',
    });
    expect(invoice.status).toBe(201);
    const issuePayment = await prisma.payment.findFirst({
      where: { orderId: issueOrder.id, status: 'succeeded' },
    });
    const issueOrderRow = await prisma.order.findUnique({ where: { id: issueOrder.id } });
    expect(issuePayment).toBeTruthy();
    expect(issueOrderRow).toBeTruthy();
    await prisma.refund.create({
      data: {
        orderId: issueOrder.id,
        paymentId: issuePayment.id,
        userId: issueOrderRow.userId,
        amountCents: issueOrder.paidCents,
        status: 'processing',
        reason: '集成测试：开具前退款处理中',
        operatorId: 'system:test',
      },
    });
    const issue = await api(
      'post',
      `/api/v1/admin/invoices/${invoice.body.data.id}/issue`,
      adminToken,
    ).send();
    expect(issue.status).toBe(409);
    expect(issue.body.code).toBe(40901);
  });

  it('部分退款后票面超过剩余可开票金额时禁止开具，驳回重提后可按新余额开具', async () => {
    const order = await paidOrder('invoice-partial-refund');
    const invoice = await api('post', '/api/v1/invoices', userToken).send({
      orderId: order.id,
      kind: 'personal',
      title: '部分退款前申请',
    });
    expect(invoice.status).toBe(201);
    expect(invoice.body.data.amountCents).toBe(order.paidCents);

    const half = Math.floor(order.paidCents / 2);
    const refund = await api('post', `/api/v1/admin/orders/${order.id}/refund`, adminToken).send({
      amountCents: half,
      reason: '集成测试：部分退款后重新开票',
    });
    expect(refund.status).toBe(201);
    expect(refund.body.data.invoiceFollowUp?.status).toBe('pending');

    const blockedIssue = await api(
      'post',
      `/api/v1/admin/invoices/${invoice.body.data.id}/issue`,
      adminToken,
    ).send();
    expect(blockedIssue.status).toBe(409);
    expect(blockedIssue.body.code).toBe(40901);
    expect(blockedIssue.body.message).toContain('驳回');

    const rejected = await api(
      'post',
      `/api/v1/admin/invoices/${invoice.body.data.id}/reject`,
      adminToken,
    ).send({ reason: '订单部分退款，请按剩余可开票金额重提' });
    expect(rejected.status).toBe(201);

    const reapplied = await api('post', '/api/v1/invoices', userToken).send({
      orderId: order.id,
      kind: 'personal',
      title: '部分退款后重新申请',
    });
    expect(reapplied.status).toBe(201);
    expect(reapplied.body.data.amountCents).toBe(order.paidCents - half);
    const issued = await api(
      'post',
      `/api/v1/admin/invoices/${reapplied.body.data.id}/issue`,
      adminToken,
    ).send();
    expect(issued.status).toBe(201);
    expect(issued.body.data.status).toBe('issued');
  });

  it('退款后票面仍不超过剩余可开票金额时，不误报必须驳回且可正常开具', async () => {
    const order = await paidOrder('invoice-refund-within-balance');
    const invoice = await api('post', '/api/v1/invoices', userToken).send({
      orderId: order.id,
      kind: 'personal',
      title: '退款后仍可开具',
    });
    expect(invoice.status).toBe(201);

    // 模拟历史/人工校正后的较小票面：本次退款后余额仍足以覆盖原票面。
    await prisma.invoice.update({
      where: { id: invoice.body.data.id },
      data: { amountCents: 400 },
    });
    const refund = await api('post', `/api/v1/admin/orders/${order.id}/refund`, adminToken).send({
      amountCents: 100,
      reason: '集成测试：退款后票面仍在余额内',
    });
    expect(refund.status).toBe(201);
    expect(refund.body.data.invoiceFollowUp).toBeNull();

    const issued = await api(
      'post',
      `/api/v1/admin/invoices/${invoice.body.data.id}/issue`,
      adminToken,
    ).send();
    expect(issued.status).toBe(201);
    expect(issued.body.data.status).toBe('issued');
  });

  it('异步退款人工确认成功：退款单、订单和积分原子落账', async () => {
    const order = await paidOrder('refund-confirm-success');
    const orderRow = await prisma.order.findUnique({ where: { id: order.id } });
    const payment = await prisma.payment.findFirst({
      where: { orderId: order.id, status: 'succeeded' },
    });
    expect(orderRow).toBeTruthy();
    expect(payment).toBeTruthy();

    const pending = await prisma.refund.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        userId: orderRow.userId,
        amountCents: order.paidCents,
        status: 'processing',
        reason: '渠道异步退款中',
        operatorId: 'system:test',
        providerRefundId: 'ASYNC-SUCCESS-1',
      },
    });
    const before = await api('get', '/api/v1/credits/balance', userToken);

    const confirmed = await api(
      'post',
      `/api/v1/admin/orders/${order.id}/refunds/${pending.id}/confirm`,
      adminToken,
    ).send({
      outcome: 'succeeded',
      providerRefundId: 'ASYNC-SUCCESS-1',
      reason: '已在渠道商户后台确认退款成功',
    });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.data.state).toBe('succeeded');
    expect(confirmed.body.data.fullyRefunded).toBe(true);
    expect(confirmed.body.data.creditsReclaimed).toBe(100);

    const after = await api('get', '/api/v1/credits/balance', userToken);
    expect(before.body.data.balance - after.body.data.balance).toBe(100);
    const settledOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(settledOrder?.status).toBe('refunded');
    expect(settledOrder?.refundedCents).toBe(order.paidCents);
    const settledRefund = await prisma.refund.findUnique({ where: { id: pending.id } });
    expect(settledRefund?.status).toBe('succeeded');
    expect(JSON.parse(settledRefund?.detail ?? '{}')).toMatchObject({
      confirmedFromChannelConsole: true,
      confirmationReason: '已在渠道商户后台确认退款成功',
    });
  });

  it('异步退款人工确认失败：只关闭退款单，订单与积分不变', async () => {
    const order = await paidOrder('refund-confirm-failed');
    const orderRow = await prisma.order.findUnique({ where: { id: order.id } });
    const payment = await prisma.payment.findFirst({
      where: { orderId: order.id, status: 'succeeded' },
    });
    expect(orderRow).toBeTruthy();
    expect(payment).toBeTruthy();

    const pending = await prisma.refund.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        userId: orderRow.userId,
        amountCents: order.paidCents,
        status: 'processing',
        reason: '渠道异步退款中',
        operatorId: 'system:test',
        providerRefundId: 'ASYNC-FAILED-1',
      },
    });
    const before = await api('get', '/api/v1/credits/balance', userToken);

    const confirmed = await api(
      'post',
      `/api/v1/admin/orders/${order.id}/refunds/${pending.id}/confirm`,
      adminToken,
    ).send({
      outcome: 'failed',
      providerRefundId: 'ASYNC-FAILED-1',
      reason: '渠道商户后台显示退款失败',
    });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.data.state).toBe('failed');
    expect(confirmed.body.data.refundedCents).toBe(0);

    const after = await api('get', '/api/v1/credits/balance', userToken);
    expect(after.body.data.balance).toBe(before.body.data.balance);
    const untouchedOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(untouchedOrder?.status).toBe('paid');
    expect(untouchedOrder?.refundedCents).toBe(0);
    const failedRefund = await prisma.refund.findUnique({ where: { id: pending.id } });
    expect(failedRefund?.status).toBe('failed');
    expect(JSON.parse(failedRefund?.detail ?? '{}')).toMatchObject({
      confirmationOutcome: 'failed',
      confirmationReason: '渠道商户后台显示退款失败',
    });
  });

  it('人工确认退款失败后重试会新建退款单，不复用已被渠道拒绝的退款号', async () => {
    const order = await paidOrder('refund-confirm-failed-retry');
    const orderRow = await prisma.order.findUnique({ where: { id: order.id } });
    const payment = await prisma.payment.findFirst({
      where: { orderId: order.id, status: 'succeeded' },
    });
    expect(orderRow).toBeTruthy();
    expect(payment).toBeTruthy();

    const rejected = await prisma.refund.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        userId: orderRow.userId,
        amountCents: order.paidCents,
        status: 'processing',
        reason: '集成测试：渠道处理中',
        operatorId: 'system:test',
        providerRefundId: 'ASYNC-REJECTED-RETRY-1',
      },
    });
    const confirmed = await api(
      'post',
      `/api/v1/admin/orders/${order.id}/refunds/${rejected.id}/confirm`,
      adminToken,
    ).send({
      outcome: 'failed',
      reason: '集成测试：渠道明确拒绝本次退款',
    });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body.data.state).toBe('failed');

    const retried = await api('post', `/api/v1/admin/orders/${order.id}/refund`, adminToken).send({
      amountCents: order.paidCents,
      reason: '集成测试：修复原因后重新退款',
    });
    expect(retried.status).toBe(201);
    expect(retried.body.data.state).toBe('succeeded');
    expect(retried.body.data.refundId).not.toBe(rejected.id);

    const rows = await prisma.refund.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((row: { id: string; status: string }) => ({ id: row.id, status: row.status }))).toEqual([
      { id: rejected.id, status: 'failed' },
      { id: retried.body.data.refundId, status: 'succeeded' },
    ]);
  });

  it('渠道退款调用失败后同金额重试复用原退款单号并最终成功', async () => {
    const order = await paidOrder('refund-channel-failed-retry');
    paymentGateway.refund.mockClear();
    paymentGateway.refund
      .mockResolvedValueOnce({ state: 'failed', error: '模拟渠道网络超时' })
      .mockResolvedValue({ state: 'succeeded' });

    try {
      const first = await api(
        'post',
        `/api/v1/admin/orders/${order.id}/refund`,
        adminToken,
      ).send({
        amountCents: order.paidCents,
        reason: '集成测试：渠道退款首次失败',
      });
      expect(first.status).toBe(502);
      expect(first.body.code).toBe(50302);

      const failed = await prisma.refund.findFirst({
        where: { orderId: order.id },
      });
      expect(failed.status).toBe('failed');
      expect(JSON.parse(failed.detail)).toMatchObject({ error: '模拟渠道网络超时' });

      const retried = await api(
        'post',
        `/api/v1/admin/orders/${order.id}/refund`,
        adminToken,
      ).send({
        amountCents: order.paidCents,
        reason: '集成测试：同金额重试渠道退款',
      });
      expect(retried.status).toBe(201);
      expect(retried.body.data.state).toBe('succeeded');
      expect(retried.body.data.refundId).toBe(failed.id);

      const calls = paymentGateway.refund.mock.calls.map((call: any[]) => call[0].outRefundNo);
      expect(calls).toEqual([failed.id, failed.id]);
      expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(1);
      expect(
        await prisma.refund.count({ where: { orderId: order.id, status: 'succeeded' } }),
      ).toBe(1);
    } finally {
      paymentGateway.refund.mockClear();
      paymentGateway.refund.mockResolvedValue({ state: 'succeeded' });
    }
  });

  it('0 元单直接完成且不可退款', async () => {
    const free = await prisma.product.create({
      data: {
        sku: `IT-FREE-${run}`,
        name: `集成测试免费包 ${run}`,
        description: '',
        kind: 'credits',
        currency: 'CNY',
        priceCents: 0,
        credits: 5,
        creditsValidDays: 0,
        grantType: 'immediate',
        status: 'active',
        saleStrategy: 'unlimited',
        sortOrder: 9999,
      },
    });
    const order = await createOrder('free', userToken, free.id);
    const intent = await api('post', `/api/v1/payments/${order.id}/intent`, userToken).send({});
    expect(intent.body.data.mode).toBe('free');

    const refund = await api('post', `/api/v1/admin/orders/${order.id}/refund`, adminToken).send({
      amountCents: 100,
      reason: '集成测试尝试退 0 元单',
    });
    expect(refund.status).toBe(400);
    expect(refund.body.code).toBe(40001);
  });

  it('支付时按下单快照决定是否自动发分，商品事后改发放方式不影响订单', async () => {
    const token = await register(`it-grant-snapshot-${run}@test.local`);
    const immediate = await prisma.product.create({
      data: {
        sku: `IT-GRANT-IMMEDIATE-${run}`,
        name: `集成测试自动发放快照 ${run}`,
        kind: 'credits',
        currency: 'CNY',
        priceCents: 100,
        credits: 7,
        creditsValidDays: 0,
        grantType: 'immediate',
        status: 'active',
        saleStrategy: 'unlimited',
        sortOrder: 9999,
      },
    });
    const manual = await prisma.product.create({
      data: {
        sku: `IT-GRANT-MANUAL-${run}`,
        name: `集成测试手工发放快照 ${run}`,
        kind: 'credits',
        currency: 'CNY',
        priceCents: 100,
        credits: 11,
        creditsValidDays: 0,
        grantType: 'manual',
        status: 'active',
        saleStrategy: 'unlimited',
        sortOrder: 9999,
      },
    });

    const immediateOrder = await createOrder('grant-immediate', token, immediate.id);
    const manualOrder = await createOrder('grant-manual', token, manual.id);

    // 下单后运营切换两个商品的发放方式；已创建订单必须保持下单时语义。
    await prisma.product.update({
      where: { id: immediate.id },
      data: { grantType: 'manual' },
    });
    await prisma.product.update({
      where: { id: manual.id },
      data: { grantType: 'immediate' },
    });

    await payOrder(immediateOrder, token, 'grant-immediate');
    await payOrder(manualOrder, token, 'grant-manual');

    const stored = await prisma.order.findMany({
      where: { id: { in: [immediateOrder.id, manualOrder.id] } },
      include: { items: true },
      orderBy: { id: 'asc' },
    });
    const byProduct = new Map<string, any>(
      stored.map((order: any) => [order.items[0].productId, order]),
    );
    expect(byProduct.get(immediate.id).items[0].grantTypeSnapshot).toBe('immediate');
    expect(byProduct.get(immediate.id).grantedCredits).toBe(7);
    expect(byProduct.get(manual.id).items[0].grantTypeSnapshot).toBe('manual');
    expect(byProduct.get(manual.id).grantedCredits).toBe(0);

    // 自动发放只产生 7 积分；手工发放商品即使后来改成 immediate 也不能补发。
    const lots = await prisma.creditLot.findMany({
      where: { orderId: { in: [immediateOrder.id, manualOrder.id] } },
    });
    expect(lots).toHaveLength(1);
    expect(lots[0].orderId).toBe(immediateOrder.id);
  });

  it('每用户未支付订单默认上限 3 笔', async () => {
    const otherToken = await register(`it-cap-${run}@test.local`);
    const capProduct = await prisma.product.create({
      data: {
        sku: `IT-CAP-${run}`,
        name: `集成测试上限包 ${run}`,
        description: '',
        kind: 'credits',
        currency: 'CNY',
        priceCents: 100,
        credits: 1,
        creditsValidDays: 0,
        grantType: 'immediate',
        status: 'active',
        saleStrategy: 'unlimited',
        sortOrder: 9999,
      },
    });
    const created: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await api('post', '/api/v1/orders', otherToken).send({
        productId: capProduct.id,
        quantity: 1,
        idempotencyKey: `it-cap-${run}-${i}`,
      });
      expect(res.body.code).toBe(0);
      created.push(res.body.data.id);
    }
    const fourth = await api('post', '/api/v1/orders', otherToken).send({
      productId: capProduct.id,
      quantity: 1,
      idempotencyKey: `it-cap-${run}-3`,
    });
    expect(fourth.status).toBe(400);
    expect(fourth.body.code).toBe(40001);
    for (const id of created) {
      await api('post', `/api/v1/orders/${id}/cancel`, otherToken);
    }
  });

  it('未支付订单上限：并发请求也不能绕过', async () => {
    const otherToken = await register(`it-cap-race-${run}@test.local`);
    const capProduct = await prisma.product.create({
      data: {
        sku: `IT-CAP-RACE-${run}`,
        name: `集成测试并发上限包 ${run}`,
        description: '',
        kind: 'credits',
        currency: 'CNY',
        priceCents: 100,
        credits: 1,
        creditsValidDays: 0,
        grantType: 'immediate',
        status: 'active',
        saleStrategy: 'unlimited',
        sortOrder: 9999,
      },
    });

    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        api('post', '/api/v1/orders', otherToken).send({
          productId: capProduct.id,
          quantity: 1,
          idempotencyKey: `it-cap-race-${run}-${index}`,
        }),
      ),
    );
    const winners = responses.filter((res) => res.body.code === 0);
    expect(winners).toHaveLength(3);
    expect(responses.filter((res) => res.status === 400 && res.body.code === 40001)).toHaveLength(3);
    expect(
      await prisma.order.count({
        where: { items: { some: { productId: capProduct.id } }, status: 'pending' },
      }),
    ).toBe(3);

    for (const res of winners) {
      await api('post', `/api/v1/orders/${res.body.data.id}/cancel`, otherToken);
    }
  });

  it('权限与 DTO：普通用户 403，审计原因不属于商品契约', async () => {
    const forbidden = await api('get', '/api/v1/admin/payments/providers', userToken);
    expect(forbidden.status).toBe(403);

    const admin = await api('get', '/api/v1/admin/payments/providers', adminToken);
    expect(admin.status).toBe(200);
    expect(admin.body.data.items).toHaveLength(7);

    // 商品已并入「商品管理」（`/admin/products`），支付域不再有独立商品接口
    const created = await api('post', '/api/v1/admin/products', adminToken).send({
      sku: `IT-NOAUDIT-${run}`,
      name: '无需审计原因商品',
      currency: 'CNY',
      priceCents: 100,
      credits: 10,
      status: 'offline',
      saleStrategy: 'unlimited',
    });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe(0);
  });

  it('订单 CSV 导出（中文文件名头）', async () => {
    const res = await api('get', '/api/v1/admin/payments/orders/export.csv', adminToken);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(res.text).toContain('订单号');
  });

  it('并发回调只入账一次', async () => {
    const order = await createOrder('race');
    const intent = await intend(order.id);
    const [a, b] = await Promise.all([
      callback(order.orderNo, intent.configId, `IT-RACE-A-${run}`, order.paidCents),
      callback(order.orderNo, intent.configId, `IT-RACE-B-${run}`, order.paidCents),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const detail = await api('get', `/api/v1/orders/${order.id}`, userToken);
    expect(detail.body.data.status).toBe('paid');
    expect(detail.body.data.grantedCredits).toBe(100);
    // Payment 流水只能有一条 succeeded；第二个交易号不能凭空多一条
    const succeeded = await prisma.payment.count({
      where: { orderId: order.id, status: 'succeeded' },
    });
    expect(succeeded).toBe(1);
  });

  it('库存并发只成功一单，取消后释放占用', async () => {
    const inventory = await prisma.product.create({
      data: {
        sku: `IT-INV-${run}`,
        name: `集成测试库存包 ${run}`,
        description: '',
        kind: 'credits',
        currency: 'CNY',
        priceCents: 100,
        credits: 1,
        creditsValidDays: 0,
        grantType: 'immediate',
        status: 'active',
        saleStrategy: 'inventory',
        stockTotal: 1,
        sortOrder: 9999,
      },
    });
    const [a, b] = await Promise.all([
      api('post', '/api/v1/orders', userToken).send({
        productId: inventory.id,
        quantity: 1,
        idempotencyKey: `it-inv-a-${run}`,
      }),
      api('post', '/api/v1/orders', userToken).send({
        productId: inventory.id,
        quantity: 1,
        idempotencyKey: `it-inv-b-${run}`,
      }),
    ]);
    const winners = [a, b].filter((r) => r.body.code === 0);
    expect(winners).toHaveLength(1);
    expect([a, b].filter((r) => r.body.code === 0).length).toBe(1);
    expect([a, b].filter((r) => r.status === 400).length).toBe(1);

    const reserved = await prisma.product.findUnique({ where: { id: inventory.id } });
    expect(reserved.stockReserved).toBe(1);
    await api('post', `/api/v1/orders/${winners[0].body.data.id}/cancel`, userToken);
    const released = await prisma.product.findUnique({ where: { id: inventory.id } });
    expect(released.stockReserved).toBe(0);
  });

  it('库存占用按订单快照结算，商品改策略不会泄漏或漏记已售', async () => {
    const makeInventory = async (tag: string) =>
      prisma.product.create({
        data: {
          sku: `IT-INV-SNAPSHOT-${tag}-${run}`,
          name: `集成测试库存快照 ${tag} ${run}`,
          description: '',
          kind: 'credits',
          currency: 'CNY',
          priceCents: 100,
          credits: 1,
          creditsValidDays: 0,
          grantType: 'immediate',
          status: 'active',
          saleStrategy: 'inventory',
          stockTotal: 1,
          sortOrder: 9999,
        },
      });

    // 场景一：下单后、支付前把商品改为不限量，仍应按快照转已售。
    const payProduct = await makeInventory('pay');
    const payOrder = await api('post', '/api/v1/orders', userToken).send({
      productId: payProduct.id,
      quantity: 1,
      idempotencyKey: `it-inv-snapshot-pay-${run}`,
    });
    expect(payOrder.body.code).toBe(0);
    await prisma.product.update({
      where: { id: payProduct.id },
      data: { saleStrategy: 'unlimited' },
    });
    const intent = await intend(payOrder.body.data.id);
    const paid = await callback(
      payOrder.body.data.orderNo,
      intent.configId,
      `IT-INV-SNAPSHOT-PAY-${run}`,
      payOrder.body.data.paidCents,
    );
    expect(paid.status).toBe(200);
    expect(paid.text).toBe('success');
    const paidProduct = await prisma.product.findUnique({ where: { id: payProduct.id } });
    expect(paidProduct.stockSold).toBe(1);
    expect(paidProduct.stockReserved).toBe(0);

    // 场景二：下单后、取消前改策略，仍应释放下单时占用的库存。
    const cancelProduct = await makeInventory('cancel');
    const cancelOrder = await api('post', '/api/v1/orders', userToken).send({
      productId: cancelProduct.id,
      quantity: 1,
      idempotencyKey: `it-inv-snapshot-cancel-${run}`,
    });
    expect(cancelOrder.body.code).toBe(0);
    await prisma.product.update({
      where: { id: cancelProduct.id },
      data: { saleStrategy: 'unlimited' },
    });
    const cancelled = await api(
      'post',
      `/api/v1/orders/${cancelOrder.body.data.id}/cancel`,
      userToken,
    );
    expect(cancelled.body.code).toBe(0);
    const cancelledProduct = await prisma.product.findUnique({ where: { id: cancelProduct.id } });
    expect(cancelledProduct.stockReserved).toBe(0);
    expect(cancelledProduct.stockSold).toBe(0);
  });

  it('限量券按待支付订单预占，支付后只核销一次', async () => {
    const couponProduct = await prisma.product.create({
      data: {
        sku: `IT-COUPON-${run}`,
        name: `集成测试券商品 ${run}`,
        description: '',
        kind: 'credits',
        currency: 'CNY',
        priceCents: 200,
        credits: 1,
        creditsValidDays: 0,
        grantType: 'immediate',
        status: 'active',
        saleStrategy: 'unlimited',
        sortOrder: 9999,
      },
    });
    const now = Date.now();
    const coupon = await prisma.coupon.create({
      data: {
        code: `IT-COUPON-${run}`,
        name: `集成测试限量券 ${run}`,
        type: 'fixed',
        value: 50,
        thresholdCents: 0,
        scope: 'all',
        totalCount: 1,
        usedCount: 0,
        perUserLimit: 1,
        validFrom: new Date(now - 60_000),
        validTo: new Date(now + 3600_000),
        status: 'on',
      },
    });
    const firstToken = await register(`it-coupon-first-${run}@test.local`);
    const secondToken = await register(`it-coupon-user-${run}@test.local`);

    const first = await api('post', '/api/v1/orders', firstToken).send({
      productId: couponProduct.id,
      quantity: 1,
      couponCode: coupon.code,
      idempotencyKey: `it-coupon-first-${run}`,
    });
    expect(first.body.code).toBe(0);
    expect(first.body.data.couponId).toBe(coupon.id);
    expect(first.body.data.paidCents).toBe(150);

    // 另一个用户在同一张限量券的名额被 pending 订单占用后，只能按原价下单。
    const second = await api('post', '/api/v1/orders', secondToken).send({
      productId: couponProduct.id,
      quantity: 1,
      couponCode: coupon.code,
      idempotencyKey: `it-coupon-second-${run}`,
    });
    expect(second.body.code).toBe(0);
    expect(second.body.data.couponId).toBeNull();
    expect(second.body.data.paidCents).toBe(200);
    expect(second.body.data.couponWarning).toContain('领完');

    const firstIntent = await intend(first.body.data.id, firstToken);
    const firstPaid = await callback(
      first.body.data.orderNo,
      firstIntent.configId,
      `IT-COUPON-FIRST-${run}`,
      first.body.data.paidCents,
    );
    expect(firstPaid.text).toBe('success');

    const secondIntent = await intend(second.body.data.id, secondToken);
    const secondPaid = await callback(
      second.body.data.orderNo,
      secondIntent.configId,
      `IT-COUPON-SECOND-${run}`,
      second.body.data.paidCents,
    );
    expect(secondPaid.text).toBe('success');

    const redeemed = await prisma.coupon.findUnique({ where: { id: coupon.id } });
    expect(redeemed.usedCount).toBe(1);
  });

  it('取消待支付订单会释放限量券预占名额', async () => {
    const couponProduct = await prisma.product.create({
      data: {
        sku: `IT-COUPON-RELEASE-${run}`,
        name: `集成测试券释放商品 ${run}`,
        description: '',
        kind: 'credits',
        currency: 'CNY',
        priceCents: 200,
        credits: 1,
        creditsValidDays: 0,
        grantType: 'immediate',
        status: 'active',
        saleStrategy: 'unlimited',
        sortOrder: 9999,
      },
    });
    const now = Date.now();
    const coupon = await prisma.coupon.create({
      data: {
        code: `CR-${run}`,
        name: `集成测试券释放 ${run}`,
        type: 'fixed',
        value: 40,
        thresholdCents: 0,
        scope: 'all',
        totalCount: 1,
        usedCount: 0,
        perUserLimit: 1,
        validFrom: new Date(now - 60_000),
        validTo: new Date(now + 3600_000),
        status: 'on',
      },
    });
    const firstToken = await register(`it-coupon-release-first-${run}@test.local`);
    const secondToken = await register(`it-coupon-release-${run}@test.local`);

    const first = await api('post', '/api/v1/orders', firstToken).send({
      productId: couponProduct.id,
      quantity: 1,
      couponCode: coupon.code,
      idempotencyKey: `it-coupon-release-first-${run}`,
    });
    expect(first.body.data.couponId).toBe(coupon.id);
    const cancelled = await api(
      'post',
      `/api/v1/orders/${first.body.data.id}/cancel`,
      firstToken,
    );
    expect(cancelled.body.code).toBe(0);

    const second = await api('post', '/api/v1/orders', secondToken).send({
      productId: couponProduct.id,
      quantity: 1,
      couponCode: coupon.code,
      idempotencyKey: `it-coupon-release-second-${run}`,
    });
    expect(second.body.code).toBe(0);
    expect(second.body.data.couponId).toBe(coupon.id);
    expect(second.body.data.paidCents).toBe(160);
    await api('post', `/api/v1/orders/${second.body.data.id}/cancel`, secondToken);
  });

  it('周期限购：同用户同商品第二单被拒', async () => {
    const periodic = await prisma.product.create({
      data: {
        sku: `IT-PERIOD-${run}`,
        name: `集成测试周期包 ${run}`,
        description: '',
        kind: 'credits',
        currency: 'CNY',
        priceCents: 100,
        credits: 1,
        creditsValidDays: 0,
        grantType: 'immediate',
        status: 'active',
        saleStrategy: 'periodic',
        periodDays: 30,
        periodPurchaseLimit: 1,
        sortOrder: 9999,
      },
    });
    const first = await api('post', '/api/v1/orders', userToken).send({
      productId: periodic.id,
      quantity: 1,
      idempotencyKey: `it-period-1-${run}`,
    });
    expect(first.body.code).toBe(0);
    const second = await api('post', '/api/v1/orders', userToken).send({
      productId: periodic.id,
      quantity: 1,
      idempotencyKey: `it-period-2-${run}`,
    });
    expect(second.status).toBe(400);
    expect(second.body.code).toBe(40001);
    await api('post', `/api/v1/orders/${first.body.data.id}/cancel`, userToken);
  });

  it('周期限购：并发两单最多成功一单', async () => {
    const periodic = await prisma.product.create({
      data: {
        sku: `IT-PERIOD-RACE-${run}`,
        name: `集成测试并发周期包 ${run}`,
        description: '',
        kind: 'credits',
        currency: 'CNY',
        priceCents: 100,
        credits: 1,
        creditsValidDays: 0,
        grantType: 'immediate',
        status: 'active',
        saleStrategy: 'periodic',
        periodDays: 30,
        periodPurchaseLimit: 1,
        sortOrder: 9999,
      },
    });
    const [a, b] = await Promise.all([
      api('post', '/api/v1/orders', userToken).send({
        productId: periodic.id,
        quantity: 1,
        idempotencyKey: `it-period-race-a-${run}`,
      }),
      api('post', '/api/v1/orders', userToken).send({
        productId: periodic.id,
        quantity: 1,
        idempotencyKey: `it-period-race-b-${run}`,
      }),
    ]);

    const winners = [a, b].filter((r) => r.body.code === 0);
    expect(winners).toHaveLength(1);
    expect([a, b].filter((r) => r.status === 400 && r.body.code === 40001)).toHaveLength(1);
    expect(
      await prisma.order.count({
        where: { userId: winners[0].body.data.userId, items: { some: { productId: periodic.id } } },
      }),
    ).toBe(1);

    await api('post', `/api/v1/orders/${winners[0].body.data.id}/cancel`, userToken);
  });

  it('并发退款最多成功一笔', async () => {
    const order = await paidOrder('refund-race');
    const [a, b] = await Promise.all([
      api('post', `/api/v1/admin/orders/${order.id}/refund`, adminToken).send({
        amountCents: order.paidCents,
        reason: '集成测试并发退款 A',
      }),
      api('post', `/api/v1/admin/orders/${order.id}/refund`, adminToken).send({
        amountCents: order.paidCents,
        reason: '集成测试并发退款 B',
      }),
    ]);
    const succeeded = [a, b].filter((r) => r.body.code === 0 && r.body.data?.state === 'succeeded');
    expect(succeeded).toHaveLength(1);
    const rows = await prisma.refund.count({
      where: { orderId: order.id, status: 'succeeded' },
    });
    expect(rows).toBe(1);
    expect(await prisma.refund.count({ where: { orderId: order.id } })).toBe(1);
    expect(
      await prisma.refund.count({ where: { orderId: order.id, status: 'processing' } }),
    ).toBe(0);
    const detail = await api('get', `/api/v1/orders/${order.id}`, userToken);
    expect(detail.body.data.status).toBe('refunded');
  });
  it('续费订单退款只撤销最新周期，不终止上一期已付会员', async () => {
    const renewToken = await register(`it-renew-${run}@test.local`);
    const firstOrder = await paidMembershipOrder('renew-first', renewToken);
    const secondOrder = await paidMembershipOrder('renew-second', renewToken);

    const firstGrant = await prisma.order.findUnique({ where: { id: firstOrder.id } });
    const secondGrant = await prisma.order.findUnique({ where: { id: secondOrder.id } });
    expect(firstGrant.membershipPeriodStartAt).toBeTruthy();
    expect(firstGrant.membershipPeriodEndAt).toBeTruthy();
    expect(secondGrant.membershipPeriodStartAt).toBeTruthy();
    expect(secondGrant.membershipPeriodStartAt.getTime()).toBe(
      firstGrant.membershipPeriodEndAt.getTime(),
    );
    expect(secondGrant.membershipPeriodEndAt.getTime()).toBeGreaterThan(
      firstGrant.membershipPeriodEndAt.getTime(),
    );

    const renewed = await prisma.membership.findFirst({
      where: { userId: firstGrant.userId },
    });
    expect(renewed.orderId).toBe(secondOrder.id);
    expect(renewed.expiresAt.getTime()).toBe(secondGrant.membershipPeriodEndAt.getTime());

    const refund = await api(
      'post',
      `/api/v1/admin/orders/${secondOrder.id}/refund`,
      adminToken,
    ).send({ amountCents: secondOrder.paidCents, reason: '集成测试：续费周期退款' });
    expect(refund.status).toBe(201);
    expect(refund.body.data.membershipTerminated).toBe(false);

    const rolledBack = await prisma.membership.findFirst({
      where: { userId: firstGrant.userId },
    });
    expect(rolledBack.status).toBe('active');
    expect(rolledBack.orderId).toBe(firstOrder.id);
    expect(rolledBack.expiresAt.getTime()).toBe(firstGrant.membershipPeriodEndAt.getTime());

    const revokedGrant = await prisma.order.findUnique({ where: { id: secondOrder.id } });
    expect(revokedGrant.membershipPeriodRevokedAt).toBeTruthy();
    const firstAfter = await prisma.order.findUnique({ where: { id: firstOrder.id } });
    expect(firstAfter.membershipPeriodRevokedAt).toBeNull();

    const finalRefund = await api(
      'post',
      `/api/v1/admin/orders/${firstOrder.id}/refund`,
      adminToken,
    ).send({ amountCents: firstOrder.paidCents, reason: '集成测试：撤销最后一期' });
    expect(finalRefund.status).toBe(201);
    expect(finalRefund.body.data.membershipTerminated).toBe(true);

    const ended = await prisma.membership.findFirst({
      where: { userId: firstGrant.userId },
    });
    expect(ended.status).toBe('expired');
    expect(ended.orderId).toBeNull();
    expect(ended.nextCreditAt).toBeNull();
  });

  it('会员过期后重新订阅复用同一投影并从当前时间开启新周期', async () => {
    const resubscribeToken = await register(`it-resubscribe-${run}@test.local`);
    const firstOrder = await paidMembershipOrder('resubscribe-first', resubscribeToken);
    const firstMembership = await prisma.membership.findFirst({
      where: { userId: (await prisma.order.findUnique({ where: { id: firstOrder.id } })).userId },
    });
    expect(firstMembership).toBeTruthy();

    const expiredAt = new Date(Date.now() - 24 * 3600 * 1000);
    await prisma.membership.update({
      where: { id: firstMembership.id },
      data: {
        status: 'expired',
        startAt: new Date(expiredAt.getTime() - 30 * 24 * 3600 * 1000),
        expiresAt: expiredAt,
        nextCreditAt: null,
      },
    });
    await prisma.order.update({
      where: { id: firstOrder.id },
      data: {
        membershipPeriodStartAt: new Date(expiredAt.getTime() - 30 * 24 * 3600 * 1000),
        membershipPeriodEndAt: expiredAt,
      },
    });

    const beforeResubscribe = Date.now();
    const secondOrder = await paidMembershipOrder('resubscribe-second', resubscribeToken);
    const afterResubscribe = Date.now();

    const memberships = await prisma.membership.findMany({
      where: { userId: firstMembership.userId },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].id).toBe(firstMembership.id);
    expect(memberships[0].status).toBe('active');
    expect(memberships[0].orderId).toBe(secondOrder.id);

    const secondGrant = await prisma.order.findUnique({ where: { id: secondOrder.id } });
    expect(secondGrant.membershipPeriodStartAt.getTime()).toBeGreaterThanOrEqual(
      beforeResubscribe,
    );
    expect(secondGrant.membershipPeriodStartAt.getTime()).toBeLessThanOrEqual(afterResubscribe);
    expect(secondGrant.membershipPeriodStartAt.getTime()).toBeGreaterThan(expiredAt.getTime());
    expect(memberships[0].expiresAt.getTime()).toBe(
      secondGrant.membershipPeriodEndAt.getTime(),
    );
  });

  it('会员订单在下单时冻结价格、周期、权益与月积分，支付前改套餐不追溯', async () => {
    const snapshotToken = await register(`it-membership-snapshot-${run}@test.local`);
    const originalPerks = {
      fastChannel: true,
      maxConcurrent: 2,
      addonDiscountBps: 9500,
    };
    const changedPerks = {
      fastChannel: false,
      maxConcurrent: 99,
      addonDiscountBps: 5000,
    };
    const originalGroup = await prisma.userGroup.create({
      data: {
        code: `snapshot-original-${run}`,
        activeKey: `snapshot-original-${run}`,
        name: `快照原分组 ${run}`,
        ratioBasisPoints: 9000,
        pointsPerUsd: 7000000n,
        pointsPerCny: 1000000n,
      },
    });
    const changedGroup = await prisma.userGroup.create({
      data: {
        code: `snapshot-changed-${run}`,
        activeKey: `snapshot-changed-${run}`,
        name: `快照新分组 ${run}`,
        ratioBasisPoints: 12000,
        pointsPerUsd: 7000000n,
        pointsPerCny: 1000000n,
      },
    });
    userGroupService.invalidate();
    const snapshotPlan = await prisma.membershipPlan.create({
      data: {
        code: `IT-SNAPSHOT-${run}`,
        name: `快照套餐 ${run}`,
        description: '',
        priceCents: 500,
        durationDays: 30,
        monthlyCredits: 25,
        perks: JSON.stringify(originalPerks),
        userGroupCode: originalGroup.code,
        status: 'active',
        sortOrder: 9999,
      },
    });

    const order = await createMembershipOrder('snapshot', snapshotToken, snapshotPlan.id);
    const pending = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    // 支付前建立默认分组缓存，确保下面的断言验证的是“激活后主动失效”，
    // 而不是恰好缓存为空时重新查库。
    expect(await userGroupService.groupCodeForUser(pending.userId)).toBe('default');
    await prisma.membershipPlan.update({
      where: { id: snapshotPlan.id },
      data: {
        priceCents: 900,
        durationDays: 90,
        monthlyCredits: 99,
        perks: JSON.stringify(changedPerks),
        userGroupCode: changedGroup.code,
      },
    });
    await payOrder(order, snapshotToken, 'snapshot');

    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.paidCents).toBe(500);
    expect(paid.membershipDurationDaysSnapshot).toBe(30);
    expect(paid.membershipMonthlyCreditsSnapshot).toBe(25);
    expect(JSON.parse(paid.membershipPerksSnapshot!)).toEqual(originalPerks);
    expect(paid.membershipUserGroupCodeSnapshot).toBe(originalGroup.code);
    expect(await userGroupService.groupCodeForUser(paid.userId)).toBe(originalGroup.code);
    expect(
      paid.membershipPeriodEndAt!.getTime() - paid.membershipPeriodStartAt!.getTime(),
    ).toBe(30 * 24 * 3600 * 1000);
    expect(paid.grantedCredits).toBe(25);

    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: paid.userId },
    });
    expect(membership.monthlyCreditsSnapshot).toBe(25);
    const resolved = await membershipService.resolve(paid.userId);
    expect(resolved.perks).toEqual(originalPerks);
    const balance = await api('get', '/api/v1/credits/balance', snapshotToken);
    expect(balance.body.data.balance).toBe(25);

    // 退款提交后也必须让已缓存的会员分组立即回落到默认分组。
    const refund = await api(
      'post',
      `/api/v1/admin/orders/${order.id}/refund`,
      adminToken,
    ).send({ amountCents: paid.paidCents, reason: '集成测试：分组缓存失效' });
    expect(refund.status).toBe(201);
    expect(await userGroupService.groupCodeForUser(paid.userId)).toBe('default');
  });

  it('提前续费到零积分套餐时，周期开始后仍切换权益与用户分组', async () => {
    const zeroToken = await register(`it-zero-renew-${run}@test.local`);
    const currentGroupCode = `it-current-${run}`.toLowerCase();
    const futureGroupCode = `it-future-${run}`.toLowerCase();
    const currentPlan = await prisma.membershipPlan.create({
      data: {
        code: `IT-ZERO-CURRENT-${run}`,
        name: `零积分测试当前套餐 ${run}`,
        description: '',
        priceCents: 300,
        durationDays: 30,
        monthlyCredits: 25,
        perks: JSON.stringify({ fastChannel: true, maxConcurrent: 2, addonDiscountBps: 9500 }),
        userGroupCode: currentGroupCode,
        status: 'active',
        sortOrder: 9999,
      },
    });
    const zeroPlan = await prisma.membershipPlan.create({
      data: {
        code: `IT-ZERO-FUTURE-${run}`,
        name: `零积分测试未来套餐 ${run}`,
        description: '',
        priceCents: 300,
        durationDays: 30,
        monthlyCredits: 0,
        perks: JSON.stringify({ fastChannel: false, maxConcurrent: 5, addonDiscountBps: 9000 }),
        userGroupCode: futureGroupCode,
        status: 'active',
        sortOrder: 9999,
      },
    });

    const firstOrder = await paidMembershipOrder('zero-first', zeroToken, currentPlan.id);
    const secondOrder = await paidMembershipOrder('zero-second', zeroToken, zeroPlan.id);
    const firstPeriod = await prisma.order.findUniqueOrThrow({ where: { id: firstOrder.id } });
    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: firstPeriod.userId },
    });

    expect((await membershipService.resolve(firstPeriod.userId)).planCode).toBe(currentPlan.code);
    expect(await userGroupService.groupCodeForUser(firstPeriod.userId)).toBe(currentGroupCode);
    expect(await prisma.creditLot.count({ where: { orderId: secondOrder.id } })).toBe(0);

    const boundary = new Date(Date.now() - 60_000);
    const secondEnd = new Date(boundary.getTime() + 30 * 24 * 3600 * 1000);
    await prisma.$transaction([
      prisma.order.update({
        where: { id: firstOrder.id },
        data: {
          membershipPeriodStartAt: new Date(boundary.getTime() - 30 * 24 * 3600 * 1000),
          membershipPeriodEndAt: boundary,
        },
      }),
      prisma.order.update({
        where: { id: secondOrder.id },
        data: { membershipPeriodStartAt: boundary, membershipPeriodEndAt: secondEnd },
      }),
      prisma.membership.update({
        where: { id: membership.id },
        data: { startAt: boundary, expiresAt: secondEnd, nextCreditAt: boundary },
      }),
    ]);

    const scheduled = await membershipService.runSchedulerTasks();
    expect(scheduled.creditsIssued).toBe(0);
    const after = await prisma.membership.findFirstOrThrow({
      where: { userId: firstPeriod.userId },
    });
    expect(after.planId).toBe(zeroPlan.id);
    expect(after.nextCreditAt).toBeNull();
    expect((await membershipService.resolve(firstPeriod.userId)).planCode).toBe(zeroPlan.code);

    // 调度器切换周期后必须主动失效用户分组缓存，即使上一轮刚读取过。
    expect(await userGroupService.groupCodeForUser(firstPeriod.userId)).toBe(futureGroupCode);
  });

  it('退掉当前有效周期后只保留未来已付周期，空档期不提前生效', async () => {
    const oldToken = await register(`it-refund-old-${run}@test.local`);
    const firstOrder = await paidMembershipOrder('refund-old-first', oldToken);
    const secondOrder = await paidMembershipOrder('refund-old-second', oldToken);

    const before = await prisma.membership.findFirst({
      where: { userId: (await prisma.order.findUniqueOrThrow({ where: { id: firstOrder.id } })).userId },
    });
    const secondGrant = await prisma.order.findUniqueOrThrow({ where: { id: secondOrder.id } });
    expect(before?.orderId).toBe(secondOrder.id);
    expect(before?.expiresAt.getTime()).toBe(secondGrant.membershipPeriodEndAt?.getTime());

    const refund = await api(
      'post',
      `/api/v1/admin/orders/${firstOrder.id}/refund`,
      adminToken,
    ).send({ amountCents: firstOrder.paidCents, reason: '集成测试：撤销较早一期' });
    expect(refund.status).toBe(201);
    // 第二期仍未开始，退款当前期后用户当下确实失去会员权益。
    expect(refund.body.data.membershipTerminated).toBe(true);

    const firstGrant = await prisma.order.findUniqueOrThrow({ where: { id: firstOrder.id } });
    expect(firstGrant.membershipPeriodRevokedAt).toBeTruthy();
    const secondAfter = await prisma.order.findUniqueOrThrow({ where: { id: secondOrder.id } });
    expect(secondAfter.membershipPeriodRevokedAt).toBeNull();

    const after = await prisma.membership.findFirst({
      where: { userId: firstGrant.userId },
    });
    expect(after?.status).toBe('active');
    expect(after?.orderId).toBe(secondOrder.id);
    expect(after?.expiresAt.getTime()).toBe(secondGrant.membershipPeriodEndAt?.getTime());
    const resolved = await membershipService.resolve(firstGrant.userId);
    expect(resolved.isMember).toBe(false);
  });

  it('月度会员积分归属发分时点订单，退款可全部回收', async () => {
    const monthlyToken = await register(`it-monthly-credit-${run}@test.local`);
    const order = await paidMembershipOrder('monthly-credit', monthlyToken);
    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).userId },
    });

    // 模拟下一期发分时间已到；会员仍在当前已付周期内。
    await prisma.membership.update({
      where: { id: membership.id },
      data: { nextCreditAt: membership.startAt },
    });
    const scheduled = await membershipService.runSchedulerTasks();
    expect(scheduled.creditsIssued).toBe(25);

    const lots = await prisma.creditLot.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(lots).toHaveLength(2);
    expect(
      lots.every(
        (lot: { remainingMicrocredits: bigint }) =>
          lot.remainingMicrocredits === 25_000_000n,
      ),
    ).toBe(true);

    const afterGrant = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(afterGrant.grantedCredits).toBe(50);
    const before = await api('get', '/api/v1/credits/balance', monthlyToken);
    expect(before.body.data.balance).toBe(50);

    const refund = await api(
      'post',
      `/api/v1/admin/orders/${order.id}/refund`,
      adminToken,
    ).send({ amountCents: order.paidCents, reason: '集成测试：回收会员月度积分' });
    expect(refund.status).toBe(201);
    expect(refund.body.data.creditsReclaimed).toBe(50);

    const after = await api('get', '/api/v1/credits/balance', monthlyToken);
    expect(after.body.data.balance).toBe(0);
  });

  it('月度积分找不到归属订单时回滚发分游标，下轮仍可重试', async () => {
    const orphanToken = await register(`it-orphan-credit-${run}@test.local`);
    const order = await paidMembershipOrder('orphan-credit', orphanToken);
    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: orderRow.userId },
    });
    const dueAt = membership.startAt;

    // 模拟周期快照缺失/被撤销：当前 Membership 仍到发分时间，但没有任何订单可承接积分。
    await prisma.order.update({
      where: { id: order.id },
      data: { membershipPeriodRevokedAt: new Date() },
    });
    await prisma.membership.update({
      where: { id: membership.id },
      data: { nextCreditAt: dueAt },
    });

    const scheduled = await membershipService.runSchedulerTasks();
    expect(scheduled.creditsIssued).toBe(0);

    const after = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(after.nextCreditAt?.getTime()).toBe(dueAt.getTime());
    expect(await prisma.creditLot.count({ where: { orderId: order.id } })).toBe(1);
    const orderAfter = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderAfter.grantedCredits).toBe(25);
  });

  it('支付后激活前发生部分退款，恢复任务仍会补开会员', async () => {
    const partialToken = await register(`it-partial-before-activate-${run}@test.local`);
    const order = await createMembershipOrder('partial-before-activate', partialToken);

    // 模拟支付事务已提交、会员激活尚未执行时，管理员先完成了一笔部分退款。
    await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'partial_refunded',
        paidAt: new Date(),
        refundedCents: 1,
        membershipAppliedAt: null,
      },
    });

    const applied = await orderService.retryPendingMembershipActivation();
    expect(applied).toBe(1);

    const activated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(activated.membershipAppliedAt).toBeTruthy();
    expect(activated.membershipPeriodStartAt).toBeTruthy();
    expect(activated.membershipPeriodEndAt).toBeTruthy();
    expect(activated.grantedCredits).toBe(25);

    const membership = await prisma.membership.findFirst({
      where: { userId: activated.userId, status: 'active' },
    });
    expect(membership).toBeTruthy();
  });

  it('提前续费不预发积分，取消续费后新周期到点仍发分并精确归属订单', async () => {
    const prepaidToken = await register(`it-prepaid-credit-${run}@test.local`);
    const firstOrder = await paidMembershipOrder('prepaid-first', prepaidToken);
    const secondOrder = await paidMembershipOrder('prepaid-second', prepaidToken);
    const firstPeriod = await prisma.order.findUniqueOrThrow({ where: { id: firstOrder.id } });
    const secondPeriod = await prisma.order.findUniqueOrThrow({ where: { id: secondOrder.id } });
    const plan = await prisma.membershipPlan.findUniqueOrThrow({ where: { id: membershipPlanId } });
    const membership = await prisma.membership.findFirstOrThrow({
      where: { userId: firstPeriod.userId },
    });

    expect(firstPeriod.grantedCredits).toBe(25);
    expect(secondPeriod.grantedCredits).toBe(0);
    expect(await prisma.creditLot.count({ where: { orderId: firstOrder.id } })).toBe(1);
    expect(await prisma.creditLot.count({ where: { orderId: secondOrder.id } })).toBe(0);
    expect(secondPeriod.membershipPeriodStartAt?.getTime()).toBe(
      firstPeriod.membershipPeriodEndAt?.getTime(),
    );

    const beforeRenewal = await membershipService.resolve(firstPeriod.userId);
    expect(beforeRenewal.isMember).toBe(true);
    expect(beforeRenewal.planCode).toBe(plan.code);
    expect(beforeRenewal.expiresAt).toBe(firstPeriod.membershipPeriodEndAt?.toISOString());
    const beforeBalance = await api('get', '/api/v1/credits/balance', prepaidToken);
    expect(beforeBalance.body.data.balance).toBe(25);

    // 取消的只是后续自动续费；已经预付的第二期仍应保留并在到点后发分。
    const cancelled = await api('post', '/api/v1/membership/cancel', prepaidToken).send();
    expect(cancelled.status).toBe(201);

    const boundary = new Date(Date.now() - 60_000);
    const firstStart = new Date(boundary.getTime() - 30 * 24 * 3600 * 1000);
    const secondEnd = new Date(boundary.getTime() + 30 * 24 * 3600 * 1000);
    await prisma.$transaction([
      prisma.order.update({
        where: { id: firstOrder.id },
        data: { membershipPeriodStartAt: firstStart, membershipPeriodEndAt: boundary },
      }),
      prisma.order.update({
        where: { id: secondOrder.id },
        data: { membershipPeriodStartAt: boundary, membershipPeriodEndAt: secondEnd },
      }),
      prisma.membership.update({
        where: { id: membership.id },
        data: { startAt: boundary, expiresAt: secondEnd, nextCreditAt: boundary },
      }),
    ]);

    // 调度时发分时点已进入第二期；积分必须挂到第二单，而不是首单。
    const scheduled = await membershipService.runSchedulerTasks();
    expect(scheduled.creditsIssued).toBe(25);
    const firstLots = await prisma.creditLot.count({ where: { orderId: firstOrder.id } });
    const secondLots = await prisma.creditLot.count({ where: { orderId: secondOrder.id } });
    expect(firstLots).toBe(1);
    expect(secondLots).toBe(1);
    const secondAfterGrant = await prisma.order.findUniqueOrThrow({ where: { id: secondOrder.id } });
    expect(secondAfterGrant.grantedCredits).toBe(25);

    const afterRenewal = await membershipService.resolve(firstPeriod.userId);
    expect(afterRenewal.isMember).toBe(true);
    expect(afterRenewal.planCode).toBe(plan.code);
    expect(afterRenewal.expiresAt).toBe(secondEnd.toISOString());
    const current = await prisma.membership.findFirstOrThrow({
      where: { userId: firstPeriod.userId },
    });
    expect(current.status).toBe('cancelled');
    expect(current.orderId).toBe(secondOrder.id);
    expect(current.expiresAt.getTime()).toBe(secondEnd.getTime());

    const refund = await api(
      'post',
      `/api/v1/admin/orders/${firstOrder.id}/refund`,
      adminToken,
    ).send({ amountCents: firstOrder.paidCents, reason: '集成测试：退较早会员周期' });
    expect(refund.status).toBe(201);
    expect(refund.body.data.membershipTerminated).toBe(false);
    expect(refund.body.data.creditsReclaimed).toBe(25);

    const balance = await api('get', '/api/v1/credits/balance', prepaidToken);
    expect(balance.body.data.balance).toBe(25);
    const currentAfterRefund = await prisma.membership.findFirstOrThrow({
      where: { userId: firstPeriod.userId },
    });
    expect(currentAfterRefund.orderId).toBe(secondOrder.id);
    expect(currentAfterRefund.status).toBe('cancelled');
  });

  it('取消自动续费后只是退掉最新续费周期，会员仍保留到上一期结束', async () => {
    const cancelToken = await register(`it-cancel-renew-${run}@test.local`);
    const firstOrder = await paidMembershipOrder('cancel-first', cancelToken);
    const secondOrder = await paidMembershipOrder('cancel-second', cancelToken);

    const cancelled = await api('post', '/api/v1/membership/cancel', cancelToken).send();
    expect(cancelled.status).toBe(201);
    expect(cancelled.body.data.expiresAt).toBeTruthy();

    const refund = await api(
      'post',
      `/api/v1/admin/orders/${secondOrder.id}/refund`,
      adminToken,
    ).send({ amountCents: secondOrder.paidCents, reason: '集成测试：取消续费后退款' });
    expect(refund.status).toBe(201);
    expect(refund.body.data.membershipTerminated).toBe(false);

    const firstGrant = await prisma.order.findUnique({ where: { id: firstOrder.id } });
    const membership = await prisma.membership.findFirst({
      where: { userId: firstGrant.userId },
    });
    expect(membership.status).toBe('cancelled');
    expect(membership.orderId).toBe(firstOrder.id);
    expect(membership.expiresAt.getTime()).toBe(firstGrant.membershipPeriodEndAt.getTime());
    expect(membership.nextCreditAt).toBeNull();
  });


  it('并发支付两笔会员订单不会丢失或重叠已付周期', async () => {
    const raceToken = await register(`it-membership-race-${run}@test.local`);
    const first = await createMembershipOrder('membership-race-a', raceToken);
    const second = await createMembershipOrder('membership-race-b', raceToken);
    const [firstIntent, secondIntent] = await Promise.all([
      intend(first.id, raceToken),
      intend(second.id, raceToken),
    ]);
    const [firstPaid, secondPaid] = await Promise.all([
      callback(
        first.orderNo,
        firstIntent.configId,
        `IT-MEMBERSHIP-RACE-A-${run}`,
        first.paidCents,
      ),
      callback(
        second.orderNo,
        secondIntent.configId,
        `IT-MEMBERSHIP-RACE-B-${run}`,
        second.paidCents,
      ),
    ]);
    expect(firstPaid.status).toBe(200);
    expect(secondPaid.status).toBe(200);
    expect(firstPaid.text).toBe('success');
    expect(secondPaid.text).toBe('success');

    const periods = await prisma.order.findMany({
      where: { id: { in: [first.id, second.id] } },
      orderBy: { membershipPeriodStartAt: 'asc' },
    });
    expect(periods).toHaveLength(2);
    expect(periods[0].membershipAppliedAt).toBeTruthy();
    expect(periods[1].membershipAppliedAt).toBeTruthy();
    expect(periods[1].membershipPeriodStartAt.getTime()).toBe(
      periods[0].membershipPeriodEndAt.getTime(),
    );

    const memberships = await prisma.membership.findMany({
      where: { userId: periods[0].userId },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0].expiresAt.getTime()).toBe(
      periods[1].membershipPeriodEndAt.getTime(),
    );
  });

  it('并发退款两笔会员订单后不会留下错误的会员投影', async () => {
    const refundRaceToken = await register(`it-membership-refund-race-${run}@test.local`);
    const first = await paidMembershipOrder('membership-refund-race-a', refundRaceToken);
    const second = await paidMembershipOrder('membership-refund-race-b', refundRaceToken);
    const orders = await prisma.order.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { userId: true },
    });
    const userId = orders[0].userId;

    const [firstRefund, secondRefund] = await Promise.all([
      api('post', `/api/v1/admin/orders/${first.id}/refund`, adminToken).send({
        amountCents: first.paidCents,
        reason: '集成测试：并发退款会员周期 A',
      }),
      api('post', `/api/v1/admin/orders/${second.id}/refund`, adminToken).send({
        amountCents: second.paidCents,
        reason: '集成测试：并发退款会员周期 B',
      }),
    ]);
    expect(firstRefund.status).toBe(201);
    expect(secondRefund.status).toBe(201);
    expect(
      [firstRefund, secondRefund].filter(
        (response) => response.body.data.membershipTerminated === true,
      ),
    ).toHaveLength(1);

    const refreshedOrders = await prisma.order.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { status: true },
    });
    expect(refreshedOrders).toHaveLength(2);
    expect(refreshedOrders.every((order: { status: string }) => order.status === 'refunded')).toBe(
      true,
    );

    const membership = await prisma.membership.findFirstOrThrow({ where: { userId } });
    expect(membership.status).toBe('expired');
    expect(membership.orderId).toBeNull();
    await expect(membershipService.resolve(userId)).resolves.toMatchObject({
      isMember: false,
      planCode: 'free',
    });
  });

});
