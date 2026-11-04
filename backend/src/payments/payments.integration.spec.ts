import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
let run = '';

function api(method: 'get' | 'post' | 'put', path: string, token?: string) {
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

async function intend(orderId: string, token = userToken) {
  const res = await api('post', `/api/v1/payments/${orderId}/intent`, token).send({
    providerId: 'sandbox',
  });
  expect(res.status).toBe(201);
  expect(res.body.code).toBe(0);
  return res.body.data as { configId: string; mode: string; sandbox: boolean };
}

function callback(orderNo: string, configId: string, tradeNo: string, amountCents: number) {
  return api('post', `/api/v1/payments/callback/sandbox/${configId}`).send({
    orderNo,
    tradeNo,
    amountCents,
  });
}

function callbackGet(orderNo: string, configId: string, tradeNo: string, amountCents: number) {
  return api('get', `/api/v1/payments/callback/sandbox/${configId}`).query({
    orderNo,
    tradeNo,
    amountCents,
  });
}

async function paidOrder(tag: string) {
  const order = await createOrder(tag);
  const intent = await intend(order.id);
  const res = await callback(order.orderNo, intent.configId, `IT-PAID-${tag}-${run}`, order.paidCents);
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  return order;
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
}, 60_000);

afterAll(async () => {
  await app?.close().catch(() => undefined);
  rmSync(DB_DIR, { recursive: true, force: true });
});

describe('支付 HTTP 集成', () => {
  it('公开设置可读，渠道列表需要登录', async () => {
    const settings = await api('get', '/api/v1/payments/settings');
    expect(settings.status).toBe(200);
    expect(settings.body.data.defaultCurrency).toBe('CNY');
    expect(settings.body.data.providers.some((p: { id: string }) => p.id === 'sandbox')).toBe(true);

    const anon = await api('get', '/api/v1/payments/providers');
    expect(anon.status).toBe(401);
  });

  it('下单 → intent → 沙箱回调 → 入账，重复回调幂等', async () => {
    const order = await createOrder('paid');
    const intent = await intend(order.id);
    expect(intent.mode).toBe('sandbox');
    expect(intent.sandbox).toBe(true);

    const tradeNo = `IT-TRADE-${run}`;
    const first = await callback(order.orderNo, intent.configId, tradeNo, order.paidCents);
    expect(first.status).toBe(200);
    expect(first.body.success).toBe(true);

    const status = await api('get', `/api/v1/payments/${order.id}/status`, userToken);
    expect(status.body.data.status).toBe('paid');
    expect(status.body.data.payments[0].providerTradeNo).toBe(tradeNo);

    const detail = await api('get', `/api/v1/orders/${order.id}`, userToken);
    expect(detail.body.data.grantedCredits).toBe(100);
    expect(detail.body.data.channel).toBe('sandbox');

    const dup = await callback(order.orderNo, intent.configId, tradeNo, order.paidCents);
    expect(dup.status).toBe(200);
    expect(dup.body.success).toBe(true);
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
    expect(res.body.success).toBe(true);

    const status = await api('get', `/api/v1/payments/${order.id}/status`, userToken);
    expect(status.body.data.status).toBe('paid');
  });

  it('金额不符/未知订单：业务终态 ack 成功并落对账差异', async () => {
    const order = await createOrder('mismatch');
    const intent = await intend(order.id);
    const bad = await callback(order.orderNo, intent.configId, `IT-BAD-${run}`, order.paidCents + 1);
    expect(bad.status).toBe(200);
    expect(bad.body.success).toBe(true);

    const status = await api('get', `/api/v1/payments/${order.id}/status`, userToken);
    expect(status.body.data.status).toBe('pending');

    const item = await prisma.paymentReconciliationItem.findFirst({
      where: { merchantOrderNo: order.orderNo, result: 'amount_mismatch' },
    });
    expect(item).toBeTruthy();

    const ghost = await callback(`GHOST-${run}`, intent.configId, `IT-GHOST-${run}`, 100);
    expect(ghost.status).toBe(200);
    expect(ghost.body.success).toBe(true);
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

    const half = Math.floor(order.paidCents / 2);
    const first = await api('post', `/api/v1/admin/orders/${order.id}/refund`, adminToken).send({
      amountCents: half,
      reason: '集成测试部分退款',
    });
    expect(first.status).toBe(201);
    expect(first.body.data.state).toBe('succeeded');
    expect(first.body.data.fullyRefunded).toBe(false);
    expect(first.body.data.refundedCents).toBe(half);

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

    const done = await prisma.order.findUnique({ where: { id: order.id } });
    expect(done?.status).toBe('refunded');
    expect(done?.refundedCents).toBe(order.paidCents);
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

  it('每用户未支付订单上限 5 笔', async () => {
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
    for (let i = 0; i < 5; i += 1) {
      const res = await api('post', '/api/v1/orders', otherToken).send({
        productId: capProduct.id,
        quantity: 1,
        idempotencyKey: `it-cap-${run}-${i}`,
      });
      expect(res.body.code).toBe(0);
      created.push(res.body.data.id);
    }
    const sixth = await api('post', '/api/v1/orders', otherToken).send({
      productId: capProduct.id,
      quantity: 1,
      idempotencyKey: `it-cap-${run}-5`,
    });
    expect(sixth.status).toBe(400);
    expect(sixth.body.code).toBe(40001);
    for (const id of created) {
      await api('post', `/api/v1/orders/${id}/cancel`, otherToken);
    }
  });

  it('权限与 DTO：普通用户 403，审计原因不属于商品契约', async () => {
    const forbidden = await api('get', '/api/v1/admin/payments/providers', userToken);
    expect(forbidden.status).toBe(403);

    const admin = await api('get', '/api/v1/admin/payments/providers', adminToken);
    expect(admin.status).toBe(200);
    expect(admin.body.data.items).toHaveLength(7);

    const created = await api('post', '/api/v1/admin/payments/products', adminToken).send({
      kind: 'credits',
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
    const detail = await api('get', `/api/v1/orders/${order.id}`, userToken);
    expect(detail.body.data.status).toBe('refunded');
  });
});
