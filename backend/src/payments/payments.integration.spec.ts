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
let membershipPlanId = '';
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

async function paidMembershipOrder(tag: string, token: string) {
  const res = await api('post', '/api/v1/orders', token).send({
    membershipPlanId,
    idempotencyKey: `it-membership-${tag}-${run}`,
  });
  expect(res.status).toBe(201);
  expect(res.body.code).toBe(0);
  const order = res.body.data as { id: string; orderNo: string; paidCents: number };
  const intent = await intend(order.id, token);
  const paid = await callback(
    order.orderNo,
    intent.configId,
    `IT-MEMBERSHIP-${tag}-${run}`,
    order.paidCents,
  );
  expect(paid.status).toBe(200);
  expect(paid.body.success).toBe(true);
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

});
