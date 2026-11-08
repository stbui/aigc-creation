/**
 * 支付主链路冒烟（2026-11 支付重构后）。
 *
 * 按真实顺序覆盖：
 *   渠道列表 → 下单 → 发起 intent → 沙箱回调 → 入账/幂等 → 金额不符/未知单
 *   → 查单/关单 → 退款（全额/部分/超限）→ 0 元单不可退 → 后台渠道/订单/商品/对账。
 *
 * 环境：
 *   API_BASE   后端地址（默认 http://127.0.0.1:4100）
 *   NODE_ENV   决定连哪个库（与 scripts/db-url.js 同一套档位）
 *
 * 例：
 *   NODE_ENV=development node scripts/smoke-payments.js
 *
 * 说明：
 *   · 先 `npm run build`（脚本读取 `dist/admin/permissions` 的权限矩阵）。
 *   · 需要后端已启动，并且沙箱渠道已启用（开发环境默认启用）。
 *   · 会新建用户/订单/支付/退款数据，使用 RUN 后缀保证可重复运行。
 *   · 后台动作使用脚本新建的 admin 夹具账号（不依赖 seed:admin 的一次性密码）。
 */
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const { loadEnvOnce, resolveDbUrl } = require('./db-url');

loadEnvOnce();

const BASE = (process.env.API_BASE || 'http://127.0.0.1:4100').replace(/\/$/, '') + '/api/v1';
const prisma = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});
const RUN = `${Date.now()}`;

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { httpStatus: res.status, ...json };
}

async function upload(path, token, file, fields) {
  const fd = new FormData();
  fd.append('file', new Blob([file.content], { type: 'text/csv' }), file.name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { httpStatus: res.status, ...json };
}

/** 取原始响应（CSV / 文本，不套 JSON 信封） */
async function raw(path, token) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    httpStatus: res.status,
    contentType: res.headers.get('content-type') ?? '',
    text: await res.text(),
  };
}

async function reconciliationItems(runId, token, result) {
  const items = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await call(
      'GET',
      `/admin/payments/reconciliations/${runId}/items?result=${result}&page=${page}&pageSize=100`,
      token,
    );
    if (response.code !== 0) return [];
    const batch = response.data?.items ?? [];
    items.push(...batch);
    if (batch.length === 0 || items.length >= (response.data?.total ?? 0)) break;
  }
  return items;
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function shanghaiDate(offsetDays) {
  const shifted = new Date(Date.now() + 8 * 3600 * 1000 - offsetDays * 24 * 3600 * 1000);
  return shifted.toISOString().slice(0, 10);
}

(async () => {
  // ── 夹具：普通用户 + 管理员 ──────────────────────────────────────
  const userA = await call('POST', '/auth/register', null, {
    email: `smoke-pay-a-${RUN}@test.local`,
    password: 'test123456',
    name: '支付冒烟 A',
  });
  if (userA.code !== 0) throw new Error(`注册 A 失败: ${userA.message}`);
  const TA = userA.data.accessToken;

  const hash = await bcrypt.hash('test123456', 10);
  const adminUser = await prisma.user.create({
    data: {
      email: `smoke-pay-admin-${RUN}@test.local`,
      passwordHash: hash,
      name: '支付冒烟管理员',
      role: 'admin',
    },
  });
  const { ROLE_PERMISSIONS } = require('../dist/admin/permissions');
  const adminPerms = JSON.stringify(ROLE_PERMISSIONS.admin);
  await prisma.adminRole.upsert({
    where: { code: 'admin' },
    update: { permissions: adminPerms },
    create: { code: 'admin', name: '管理员', permissions: adminPerms },
  });
  const adminLogin = await call('POST', '/auth/login', null, {
    email: adminUser.email,
    password: 'test123456',
  });
  const TADMIN = adminLogin.data?.accessToken;
  if (!TADMIN) throw new Error(`管理员登录失败: ${adminLogin.message}`);

  const product = await prisma.product.findFirst({
    where: {
      status: 'active',
      kind: 'credits',
      credits: { gt: 0 },
      priceCents: { gt: 0 },
      grantType: 'immediate',
    },
    orderBy: { priceCents: 'asc' },
  });
  if (!product) throw new Error('库里没有可购买的积分包，先跑 npm run seed:commerce');

  const idem = (tag) => `smoke-pay-${RUN}-${tag}`;

  async function newOrder(tag) {
    const r = await call('POST', '/orders', TA, {
      productId: product.id,
      quantity: 1,
      idempotencyKey: idem(tag),
    });
    if (r.code !== 0) throw new Error(`下单失败 (${tag}): ${r.message}`);
    return r.data;
  }

  async function intend(order, providerId = 'sandbox') {
    const r = await call('POST', `/payments/${order.id}/intent`, TA, { providerId });
    if (r.code !== 0) throw new Error(`发起支付失败 (${order.orderNo}): ${r.message}`);
    return r.data;
  }

  function callback(order, intent, tradeTag) {
    const tradeNo = `SMOKE-${tradeTag}-${RUN}`;
    return {
      tradeNo,
      request: call('POST', `/payments/callback/sandbox/${intent.configId}`, null, {
        orderNo: order.orderNo,
        tradeNo,
        amountCents: order.paidCents,
      }),
    };
  }

  function callbackBody(order, intent, tradeNo, amountCents) {
    return call('POST', `/payments/callback/sandbox/${intent.configId}`, null, {
      orderNo: order.orderNo,
      tradeNo,
      amountCents: amountCents ?? order.paidCents,
    });
  }

  // ── 1. 渠道列表 ──────────────────────────────────────────────────
  console.log('\n【渠道列表】');
  const providers = await call('GET', '/payments/providers', TA);
  check('登录用户可读支付渠道', providers.code === 0 && Array.isArray(providers.data?.items), providers.message);
  check(
    '渠道列表包含沙箱',
    (providers.data?.items ?? []).some((p) => p.id === 'sandbox' && p.sandbox === true),
  );
  const providersAnon = await call('GET', '/payments/providers', null);
  check('未登录不可读支付渠道 (401)', providersAnon.httpStatus === 401, providersAnon.message);
  // 支付设置是公开的：商品页在登录前就要按默认币种排序
  const cSettings = await call('GET', '/payments/settings', null);
  check(
    'C 端支付设置可公开读取',
    cSettings.code === 0 && ['CNY', 'USD'].includes(cSettings.data?.defaultCurrency),
    cSettings.message,
  );

  // ── 2. 下单 + intent + 沙箱回调入账 ─────────────────────────────
  console.log('\n【intent / 回调 / 入账】');
  const order1 = await newOrder('intent');
  const intent1 = await intend(order1);
  check('intent 返回 sandbox 模式', intent1.mode === 'sandbox' && intent1.sandbox === true, intent1.mode);
  check('intent 固定了配置版本', typeof intent1.configId === 'string' && intent1.configVersion >= 1);

  const cb1 = callback(order1, intent1, 'MATCH');
  const cb1Res = await cb1.request;
  check('沙箱回调被接受', cb1Res.httpStatus === 200 && cb1Res.success === true, JSON.stringify(cb1Res).slice(0, 160));

  const st1 = await call('GET', `/payments/${order1.id}/status`, TA);
  check('订单状态为 paid', st1.data?.status === 'paid', st1.data?.status);
  check(
    '支付流水记录渠道交易号',
    (st1.data?.payments ?? []).some((p) => p.providerTradeNo === cb1.tradeNo),
  );
  check('支付流水记录实际渠道', (st1.data?.payments ?? []).some((p) => p.providerId === 'sandbox'));

  const o1 = await call('GET', `/orders/${order1.id}`, TA);
  check('订单详情显示实际渠道', o1.data?.channel === 'sandbox', o1.data?.channel);
  check('订单发放的积分与商品一致', o1.data?.grantedCredits === product.credits, `${o1.data?.grantedCredits}`);
  const bal1 = await call('GET', '/credits/balance', TA);
  check('积分到账', bal1.data?.balance === product.credits, `${bal1.data?.balance}`);

  const rawPayment = await prisma.payment.findFirst({ where: { orderId: order1.id, status: 'succeeded' } });
  check('回调原始报文已留档', !!rawPayment?.rawPayload && rawPayment.rawPayload.includes(cb1.tradeNo));
  const notification = await prisma.paymentNotification.findFirst({
    where: { merchantOrderNo: order1.orderNo, status: 'processed' },
  });
  check('回调收件箱标记 processed', !!notification?.id);

  const dup = await callbackBody(order1, intent1, cb1.tradeNo);
  check('重复回调 ack 成功', dup.httpStatus === 200 && dup.success === true, JSON.stringify(dup).slice(0, 120));
  const bal1b = await call('GET', '/credits/balance', TA);
  check('重复回调不重复发积分', bal1b.data?.balance === bal1.data?.balance, `${bal1b.data?.balance}`);

  // ── 3. 异常回调 ──────────────────────────────────────────────────
  console.log('\n【回调异常】');
  const order2 = await newOrder('mismatch');
  const intent2 = await intend(order2);
  const badTrade = `SMOKE-MISMATCH-${RUN}`;
  const cbBad = await callbackBody(order2, intent2, badTrade, order2.paidCents + 100);
  check(
    '金额不符按业务终态 ack 成功（停止重试）',
    cbBad.httpStatus === 200 && cbBad.success === true,
    JSON.stringify(cbBad).slice(0, 160),
  );
  const st2 = await call('GET', `/payments/${order2.id}/status`, TA);
  check('金额不符时订单保持 pending', st2.data?.status === 'pending', st2.data?.status);
  const itemBad = await prisma.paymentReconciliationItem.findFirst({
    where: { merchantOrderNo: order2.orderNo, result: 'amount_mismatch' },
  });
  check('金额不符落对账差异', !!itemBad?.id, itemBad?.detail);

  const ghostOrderNo = `GHOST-${RUN}`;
  const cbGhost = await call('POST', `/payments/callback/sandbox/${intent2.configId}`, null, {
    orderNo: ghostOrderNo,
    tradeNo: `SMOKE-GHOST-${RUN}`,
    amountCents: 100,
  });
  check('未知订单 ack 成功且不留垃圾重试', cbGhost.httpStatus === 200 && cbGhost.success === true);
  const itemGhost = await prisma.paymentReconciliationItem.findFirst({
    where: { merchantOrderNo: ghostOrderNo, result: 'local_order_not_found' },
  });
  check('未知订单落对账差异', !!itemGhost?.id);

  const cbNoTrade = await call('POST', `/payments/callback/sandbox/${intent2.configId}`, null, {
    orderNo: order2.orderNo,
    amountCents: order2.paidCents,
  });
  check('缺少交易号被拒 (400)', cbNoTrade.httpStatus === 400 && cbNoTrade.success === false);

  // ── 4. 关单 ──────────────────────────────────────────────────────
  console.log('\n【关单】');
  const order3 = await newOrder('cancel-user');
  const intent3 = await intend(order3);
  const cancelled = await call('POST', `/orders/${order3.id}/cancel`, TA);
  check('用户取消订单成功', cancelled.code === 0 && cancelled.data?.status === 'cancelled', cancelled.message);
  const o3 = await call('GET', `/orders/${order3.id}`, TA);
  check('取消后订单为 cancelled', o3.data?.status === 'cancelled', o3.data?.status);
  check('取消后支付尝试收尾', (o3.data?.payments ?? []).every((p) => p.status !== 'pending'));

  const order4 = await newOrder('cancel-admin');
  await intend(order4);
  const adminClose = await call('POST', `/admin/payments/orders/${order4.id}/close`, TADMIN, {});
  check('管理员关单成功', adminClose.code === 0 && adminClose.data?.view?.status === 'cancelled', adminClose.message);

  const forbiddenClose = await call('POST', `/admin/payments/orders/${order3.id}/close`, TA, {});
  check('普通用户不能后台关单', forbiddenClose.httpStatus === 403, forbiddenClose.message);

  // ── 5. 退款 ──────────────────────────────────────────────────────
  console.log('\n【退款】');
  async function paidOrder(tag) {
    const o = await newOrder(tag);
    const it = await intend(o);
    const cb = callback(o, it, `REFUND-${tag.toUpperCase()}`);
    const res = await cb.request;
    if (res.httpStatus !== 200 || res.success !== true) throw new Error(`入账失败 (${tag})`);
    return o;
  }

  const refundOrder = await paidOrder('refund-full');
  const balBeforeFull = await call('GET', '/credits/balance', TA);
  const overRefund = await call('POST', `/admin/orders/${refundOrder.id}/refund`, TADMIN, {
    amountCents: refundOrder.paidCents + 1,
    reason: '冒烟脚本超额退款',
  });
  check('退款超过实付被拒 (400)', overRefund.code === 40001, overRefund.message);

  const refunded = await call('POST', `/admin/orders/${refundOrder.id}/refund`, TADMIN, {
    amountCents: refundOrder.paidCents,
    reason: '冒烟脚本全额退款',
  });
  check('全额退款成功', refunded.code === 0 && refunded.data?.state === 'succeeded', refunded.message);
  check('退款标记全额', refunded.data?.fullyRefunded === true && refunded.data?.pending === false);
  const oR = await call('GET', `/orders/${refundOrder.id}`, TA);
  check('订单置为 refunded', oR.data?.status === 'refunded', oR.data?.status);
  const refundRow = await prisma.refund.findFirst({ where: { orderId: refundOrder.id } });
  check('退款单落库 succeeded', refundRow?.status === 'succeeded');
  check('沙箱退款不伪造渠道退款单号', !refundRow?.providerRefundId, refundRow?.providerRefundId);
  const balAfterFull = await call('GET', '/credits/balance', TA);
  check(
    '全额退款回收本单积分',
    balBeforeFull.data?.balance - balAfterFull.data?.balance === product.credits,
    `${balBeforeFull.data?.balance} → ${balAfterFull.data?.balance}`,
  );
  const reclaim = await prisma.creditLedgerEntry.findFirst({
    where: { paymentOrderId: refundOrder.id, type: 'refund_reclaim' },
  });
  check('积分回收有 refund_reclaim 流水', !!reclaim?.id);

  const partialOrder = await paidOrder('refund-partial');
  const half = Math.floor(partialOrder.paidCents / 2);
  const balBeforePartial = await call('GET', '/credits/balance', TA);
  const part1 = await call('POST', `/admin/orders/${partialOrder.id}/refund`, TADMIN, {
    amountCents: half,
    reason: '冒烟脚本部分退款',
  });
  check('部分退款成功', part1.code === 0 && part1.data?.state === 'succeeded', part1.message);
  check('部分退款不是全额', part1.data?.fullyRefunded === false);
  const oP1 = await call('GET', `/orders/${partialOrder.id}`, TA);
  check('订单置为 partial_refunded', oP1.data?.status === 'partial_refunded', oP1.data?.status);
  const balAfterPartial = await call('GET', '/credits/balance', TA);
  const expectedFirstReclaim = Math.floor((product.credits * half) / partialOrder.paidCents);
  check(
    '首次部分退款按比例回收积分',
    part1.data?.creditsReclaimed === expectedFirstReclaim,
    `回收 ${part1.data?.creditsReclaimed} / 预期 ${expectedFirstReclaim}`,
  );
  check(
    '首次部分退款余额按实际回收量下降',
    balBeforePartial.data?.balance - balAfterPartial.data?.balance === part1.data?.creditsReclaimed,
    `${balBeforePartial.data?.balance} → ${balAfterPartial.data?.balance}`,
  );

  const part2 = await call('POST', `/admin/orders/${partialOrder.id}/refund`, TADMIN, {
    amountCents: partialOrder.paidCents - half,
    reason: '冒烟脚本退完剩余',
  });
  check('二次部分退款成功', part2.code === 0 && part2.data?.state === 'succeeded', part2.message);
  check('退完后标记全额', part2.data?.fullyRefunded === true);
  const oP2 = await call('GET', `/orders/${partialOrder.id}`, TA);
  check('退完后订单为 refunded', oP2.data?.status === 'refunded', oP2.data?.status);

  // ── 5.5 并发回调：两个不同交易号只允许一笔入账 ───────────────────
  console.log('\n【并发入账】');
  const raceOrder = await newOrder('race-pay');
  const raceIntent = await intend(raceOrder);
  const balBeforeRace = await call('GET', '/credits/balance', TA);
  const [raceA, raceB] = await Promise.all([
    callbackBody(raceOrder, raceIntent, `SMOKE-RACE-A-${RUN}`),
    callbackBody(raceOrder, raceIntent, `SMOKE-RACE-B-${RUN}`),
  ]);
  check('并发回调都被 ack', raceA.httpStatus === 200 && raceB.httpStatus === 200, `${raceA.httpStatus}/${raceB.httpStatus}`);
  const raceOrderView = await call('GET', `/orders/${raceOrder.id}`, TA);
  check('并发回调后订单为 paid', raceOrderView.data?.status === 'paid', raceOrderView.data?.status);
  check(
    '并发回调只发放一次积分',
    raceOrderView.data?.grantedCredits === product.credits,
    `${raceOrderView.data?.grantedCredits} / 商品 ${product.credits}`,
  );
  const balAfterRace = await call('GET', '/credits/balance', TA);
  check(
    '并发回调余额只增加一份',
    balAfterRace.data?.balance - balBeforeRace.data?.balance === product.credits,
    `${balBeforeRace.data?.balance} → ${balAfterRace.data?.balance}`,
  );
  const succeededRows = await prisma.payment.count({
    where: { orderId: raceOrder.id, status: 'succeeded' },
  });
  check('并发回调只落一条成功流水', succeededRows === 1, `${succeededRows}`);

  // ── 5.6 周期限购 / 库存并发 ──────────────────────────────────────
  console.log('\n【周期限购 / 库存并发】');
  const periodicProduct = await prisma.product.create({
    data: {
      sku: `SMOKE-PERIODIC-${RUN}`,
      name: `冒烟周期商品 ${RUN}`,
      description: '',
      kind: 'credits',
      currency: 'CNY',
      priceCents: 100,
      credits: 10,
      creditsValidDays: 0,
      grantType: 'immediate',
      status: 'active',
      saleStrategy: 'periodic',
      periodDays: 30,
      periodPurchaseLimit: 1,
      sortOrder: 9999,
    },
  });
  const periodic1 = await call('POST', '/orders', TA, {
    productId: periodicProduct.id,
    quantity: 1,
    idempotencyKey: idem('periodic-1'),
  });
  const periodic2 = await call('POST', '/orders', TA, {
    productId: periodicProduct.id,
    quantity: 1,
    idempotencyKey: idem('periodic-2'),
  });
  check('周期限购首单成功', periodic1.code === 0, periodic1.message);
  check('周期限购第二单被拒 (400)', periodic2.code === 40001, periodic2.message);
  if (periodic1.code === 0) {
    await call('POST', `/orders/${periodic1.data.id}/cancel`, TA);
  }
  await prisma.product.update({ where: { id: periodicProduct.id }, data: { status: 'offline' } });

  const inventoryProduct = await prisma.product.create({
    data: {
      sku: `SMOKE-INVENTORY-${RUN}`,
      name: `冒烟库存商品 ${RUN}`,
      description: '',
      kind: 'credits',
      currency: 'CNY',
      priceCents: 100,
      credits: 10,
      creditsValidDays: 0,
      grantType: 'immediate',
      status: 'active',
      saleStrategy: 'inventory',
      stockTotal: 1,
      sortOrder: 9999,
    },
  });
  const [invA, invB] = await Promise.all([
    call('POST', '/orders', TA, {
      productId: inventoryProduct.id,
      quantity: 1,
      idempotencyKey: idem('inventory-a'),
    }),
    call('POST', '/orders', TA, {
      productId: inventoryProduct.id,
      quantity: 1,
      idempotencyKey: idem('inventory-b'),
    }),
  ]);
  const invWinners = [invA, invB].filter((r) => r.code === 0);
  check(
    '库存并发只成功一单（不超卖）',
    invWinners.length === 1,
    `${invA.code}/${invB.code} ${invA.message || ''} ${invB.message || ''}`,
  );
  const invAfter = await prisma.product.findUnique({ where: { id: inventoryProduct.id } });
  check('库存只占用一份', invAfter?.stockReserved === 1, `${invAfter?.stockReserved}`);
  if (invWinners[0]) {
    await call('POST', `/orders/${invWinners[0].data.id}/cancel`, TA);
  }
  const invReleased = await prisma.product.findUnique({ where: { id: inventoryProduct.id } });
  check('取消订单释放库存占用', invReleased?.stockReserved === 0, `${invReleased?.stockReserved}`);
  await prisma.product.update({ where: { id: inventoryProduct.id }, data: { status: 'offline' } });

  // ── 6. 0 元单 ────────────────────────────────────────────────────
  console.log('\n【0 元单】');
  const freeProduct = await prisma.product.findFirst({
    where: { priceCents: 0, status: 'active', kind: 'credits', credits: { gt: 0 } },
    orderBy: { credits: 'asc' },
  });
  if (!freeProduct) {
    console.log('  SKIP  没有可用的 0 元商品');
  } else {
    const freeOrderRes = await call('POST', '/orders', TA, {
      productId: freeProduct.id,
      quantity: 1,
      idempotencyKey: idem('free'),
    });
    check('0 元单创建成功', freeOrderRes.code === 0, freeOrderRes.message);
    const freeOrder = freeOrderRes.data;
    const freeIntent = await call('POST', `/payments/${freeOrder.id}/intent`, TA, { providerId: 'sandbox' });
    check('0 元单直接完成', freeIntent.code === 0 && freeIntent.data?.mode === 'free', freeIntent.message);
    const freeRefund = await call('POST', `/admin/orders/${freeOrder.id}/refund`, TADMIN, {
      amountCents: 100,
      reason: '冒烟脚本尝试退 0 元单',
    });
    check('0 元单不可退款 (400)', freeRefund.code === 40001, freeRefund.message);
  }

  // ── 7. 后台支付页 API ────────────────────────────────────────────
  console.log('\n【后台支付 API】');
  const adminProviders = await call('GET', '/admin/payments/providers', TADMIN);
  const providerItems = adminProviders.data?.items ?? [];
  const expectedProviders = ['sandbox', 'alipay', 'wechat', 'paypal', 'stripe', 'epay', 'zpay'];
  check(
    '管理员可读七渠道配置',
    adminProviders.code === 0 &&
      providerItems.length === expectedProviders.length &&
      expectedProviders.every((id) => providerItems.some((item) => item.id === id)),
    providerItems.map((item) => item.id).join(','),
  );
  const secretFieldNames = new Set([
    'merchantPrivateKey',
    'alipayPublicKey',
    'apiV3Key',
    'wechatPayPublicKey',
    'clientSecret',
    'secretKey',
    'webhookSecret',
    'key',
  ]);
  const leakedSecret = (adminProviders.data?.items ?? []).some((p) =>
    Object.entries(p.values ?? {}).some(
      ([key, value]) =>
        secretFieldNames.has(key) || /BEGIN [A-Z ]*PRIVATE KEY/.test(String(value)),
    ),
  );
  check('渠道配置不回传密钥明文', !leakedSecret);
  const settings = await call('GET', '/admin/payments/settings', TADMIN);
  check('管理员可读支付设置', settings.code === 0 && !!settings.data?.defaultCurrency);

  const adminOrders = await call(
    'GET',
    `/admin/payments/orders?keyword=${encodeURIComponent(order1.orderNo)}`,
    TADMIN,
  );
  check(
    '管理员可查支付订单',
    adminOrders.code === 0 && (adminOrders.data?.items ?? []).some((o) => o.orderNo === order1.orderNo),
    adminOrders.message,
  );
  const adminOrderDetail = await call('GET', `/admin/payments/orders/${order1.id}`, TADMIN);
  check('支付订单详情可用', adminOrderDetail.code === 0 && adminOrderDetail.data?.order?.status === 'credited');
  const ordersCsv = await raw(
    `/admin/payments/orders/export.csv?keyword=${encodeURIComponent(order1.orderNo)}`,
    TADMIN,
  );
  check(
    '支付订单可导出 CSV',
    ordersCsv.httpStatus === 200 &&
      ordersCsv.contentType.includes('text/csv') &&
      ordersCsv.text.includes(order1.orderNo),
    ordersCsv.contentType,
  );
  const ordersCsvForbidden = await raw('/admin/payments/orders/export.csv', TA);
  check('普通用户不能导出支付订单', ordersCsvForbidden.httpStatus === 403, ordersCsvForbidden.text.slice(0, 80));
  const queryPaid = await call('POST', `/admin/payments/orders/${order1.id}/query`, TADMIN, {});
  check('已支付订单可同步', queryPaid.code === 0, queryPaid.message);
  const closePaid = await call('POST', `/admin/payments/orders/${order1.id}/close`, TADMIN, {});
  check('已支付订单不可关闭 (409)', closePaid.httpStatus === 409, closePaid.message);

  const productCreated = await call('POST', '/admin/payments/products', TADMIN, {
    kind: 'credits',
    name: `冒烟测试商品 ${RUN}`,
    currency: 'CNY',
    priceCents: 100,
    credits: 10,
    status: 'offline',
    saleStrategy: 'unlimited',
  });
  check('后台商品创建成功（kind 必填）', productCreated.code === 0, productCreated.message);
  if (productCreated.code === 0) {
    const pid = productCreated.data.product.id;
    const productUpdated = await call('PUT', `/admin/payments/products/${pid}`, TADMIN, {
      kind: 'credits',
      name: `冒烟测试商品 ${RUN}`,
      currency: 'CNY',
      priceCents: 200,
      credits: 10,
      status: 'offline',
      saleStrategy: 'unlimited',
    });
    check('后台商品更新成功', productUpdated.code === 0, productUpdated.message);
    await prisma.product.delete({ where: { id: pid } }).catch(() => undefined);
  }
  const zeroStock = await call('POST', '/admin/payments/products', TADMIN, {
    kind: 'credits',
    name: `冒烟零库存 ${RUN}`,
    currency: 'CNY',
    priceCents: 100,
    credits: 10,
    status: 'offline',
    saleStrategy: 'inventory',
    stockTotal: 0,
  });
  check('库存商品 0 库存被拒 (400)', zeroStock.code === 40001, zeroStock.message);
  const badOriginal = await call('POST', '/admin/payments/products', TADMIN, {
    kind: 'credits',
    name: `冒烟划线价 ${RUN}`,
    currency: 'CNY',
    priceCents: 100,
    originalPriceCents: 50,
    credits: 10,
    status: 'offline',
    saleStrategy: 'unlimited',
  });
  check('划线价低于售价被拒 (400)', badOriginal.code === 40001, badOriginal.message);

  // ── 8. 对账 ──────────────────────────────────────────────────────
  console.log('\n【对账】');
  const billDate = shanghaiDate(1);
  const channelOnlyOrderNo = `SMOKE-CHANNEL-ONLY-${RUN}`;
  const csv = [
    '商户订单号,渠道交易号,金额,状态,完成时间',
    `${channelOnlyOrderNo},SMOKE-TRADE-ONLY-${RUN},500,成功,${billDate} 10:01:00`,
  ].join('\n');
  const unsupportedImport = await upload(
    '/admin/payments/reconciliations/import',
    TADMIN,
    { name: `smoke-bill-unsupported-${RUN}.csv`, content: csv },
    { providerId: 'sandbox', billDate },
  );
  check(
    '不支持对账的渠道拒绝 CSV 导入',
    unsupportedImport.code === 40001,
    unsupportedImport.message,
  );
  const imported = await upload(
    '/admin/payments/reconciliations/import',
    TADMIN,
    { name: `smoke-bill-${RUN}.csv`, content: csv },
    { providerId: 'alipay', billDate },
  );
  check('对账 CSV 导入成功', imported.code === 0 && imported.data?.run?.status === 'completed', imported.message);
  const runId = imported.data?.run?.id;
  const importedRun = imported.data?.run;
  check(
    '对账统计识别渠道独有订单',
    importedRun?.totalItems === 1 && importedRun?.matchItems === 0 && importedRun?.errorItems === 1,
    JSON.stringify(importedRun),
  );
  if (runId) {
    const missingItems = await reconciliationItems(runId, TADMIN, 'local_order_not_found');
    const missingOrderNos = missingItems.map((i) => i.merchantOrderNo);
    check('识别本地缺单', missingOrderNos.includes(channelOnlyOrderNo), missingOrderNos.join(','));
    const runsCsv = await raw('/admin/payments/reconciliations/export.csv?providerId=alipay', TADMIN);
    check(
      '对账运行可导出 CSV',
      runsCsv.httpStatus === 200 && runsCsv.contentType.includes('text/csv'),
      runsCsv.contentType,
    );
    const itemsCsv = await raw(
      `/admin/payments/reconciliations/${runId}/items/export.csv`,
      TADMIN,
    );
    check(
      '对账明细可导出 CSV',
      itemsCsv.httpStatus === 200 &&
        itemsCsv.contentType.includes('text/csv') &&
        itemsCsv.text.includes(channelOnlyOrderNo),
      itemsCsv.contentType,
    );
  }
  const failedRun = await call('POST', '/admin/payments/reconciliations', TADMIN, {
    providerId: 'sandbox',
    billDate,
    retryFailed: true,
  });
  check(
    '沙箱不支持自动对账时返回明确错误',
    failedRun.code === 40001 && failedRun.message?.includes('不支持自动对账'),
    failedRun.message,
  );

  const staleDate = shanghaiDate(2);
  const staleLatest = await prisma.paymentReconciliationRun.aggregate({
    where: { providerId: 'sandbox', billDate: staleDate },
    _max: { attempt: true },
  });
  const staleRun = await prisma.paymentReconciliationRun.create({
    data: {
      providerId: 'sandbox',
      configId: null,
      billDate: staleDate,
      attempt: (staleLatest._max.attempt ?? 0) + 1,
      source: 'provider',
      status: 'running',
      startedAt: new Date(Date.now() - 31 * 60_000),
      startedBy: 'smoke',
    },
  });
  const recoveredRun = await call('POST', '/admin/payments/reconciliations', TADMIN, {
    providerId: 'sandbox',
    billDate: staleDate,
    retryFailed: true,
  });
  check(
    '超时运行先被回收，再返回渠道不支持错误',
    recoveredRun.code === 40001 && recoveredRun.message?.includes('不支持自动对账'),
    recoveredRun.message,
  );
  const staleAfter = await prisma.paymentReconciliationRun.findUnique({ where: { id: staleRun.id } });
  check('原 running 行被标记 failed', staleAfter?.status === 'failed', staleAfter?.status);
  await prisma.paymentReconciliationRun.deleteMany({ where: { id: staleRun.id } });

  const forbiddenProviders = await call('GET', '/admin/payments/providers', TA);
  check('普通用户不能读后台支付配置', forbiddenProviders.httpStatus === 403, forbiddenProviders.message);
  const forbiddenRefund = await call('POST', `/admin/orders/${order1.id}/refund`, TA, {
    amountCents: 1,
    reason: '普通用户不该成功',
  });
  check('普通用户不能退款', forbiddenRefund.httpStatus === 403, forbiddenRefund.message);

  // ── 9. 未支付订单上限 ────────────────────────────────────────────
  console.log('\n【未支付订单上限】');
  const userB = await call('POST', '/auth/register', null, {
    email: `smoke-pay-b-${RUN}@test.local`,
    password: 'test123456',
    name: '支付冒烟 B',
  });
  if (userB.code === 0) {
    const TB = userB.data.accessToken;
    const capProduct = await prisma.product.create({
      data: {
        sku: `SMOKE-CAP-${RUN}`,
        name: `冒烟上限商品 ${RUN}`,
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
    const created = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await call('POST', '/orders', TB, {
        productId: capProduct.id,
        quantity: 1,
        idempotencyKey: `smoke-cap-${RUN}-${i}`,
      });
      if (r.code === 0) created.push(r.data);
    }
    check('可同时保留 5 笔未支付订单', created.length === 5, `${created.length}`);
    const sixth = await call('POST', '/orders', TB, {
      productId: capProduct.id,
      quantity: 1,
      idempotencyKey: `smoke-cap-${RUN}-5`,
    });
    check(
      '第 6 笔未支付订单被拒 (400)',
      sixth.code === 40001 && String(sixth.message).includes('未支付订单'),
      sixth.message,
    );
    for (const o of created) {
      await call('POST', `/orders/${o.id}/cancel`, TB).catch(() => undefined);
    }
    await prisma.product.update({ where: { id: capProduct.id }, data: { status: 'offline' } });
  } else {
    console.log(`  SKIP  注册用户 B 失败: ${userB.message}`);
  }

  console.log(`\n合计: ${pass} 通过 / ${fail} 失败\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (error) => {
  console.error('\n冒烟脚本异常终止:', error?.stack || error?.message || error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
