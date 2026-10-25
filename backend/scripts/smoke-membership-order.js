/**
 * 会员订阅订单链路冒烟 (2026-10-21)。
 *
 * 守住的是**钱与权益的对应关系** —— 2026-10-21 之前这里有一个真实漏洞:
 * `POST /membership/subscribe` 不校验任何订单, 任何登录用户调一次就能白拿
 * 会员与月度积分 (每月可重复)。本脚本逐条钉死修复后的契约:
 *
 *   1. 会员只能由「已支付订单」开通, 无订单请求直接被参数校验拒绝
 *   2. 订单必须属于本人 → 别人的已支付订单用不了 (403)
 *   3. 订单未支付 → 不能开通 (409), 也不能靠重复调用来"试出来"
 *   4. 一单只兑换一次: 重复调用返回 alreadyApplied, 积分不重复发放
 *   5. 订单与套餐必须匹配 (400) —— 买 basic 不能开 pro
 *   6. 会员单金额 = 套餐原价, 不套会员折扣, 券只提示不生效
 *   7. 会员单与积分商品不能混在同一订单里
 *
 * ## 环境
 *
 * 与既有冒烟不同, 本脚本**不写死端口与库**:
 *   API_BASE   后端地址 (默认 http://127.0.0.1:4100)
 *   NODE_ENV   决定连哪个库 (与 scripts/db-url.js 同一套档位逻辑)
 *
 * 例: NODE_ENV=test API_BASE=http://127.0.0.1:4100 node scripts/smoke-membership-order.js
 */
const { PrismaClient } = require('@prisma/client');
const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const { loadEnvOnce, resolveDbUrl, resolveDbPath } = require('./db-url');

loadEnvOnce();

const BASE = (process.env.API_BASE || 'http://127.0.0.1:4100').replace(/\/$/, '') + '/api/v1';
const prisma = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});

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
    json = { raw: text.slice(0, 150) };
  }
  return { httpStatus: res.status, ...json };
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

let seq = 0;
const idem = (tag) => `${tag}-${Date.now()}-${seq++}`;

(async () => {
  const bcrypt = require('bcryptjs');
  const stamp = Date.now();
  const mkUser = async (tag) => {
    const email = `${tag}-${stamp}@test.com`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash('test123456', 10), name: `会员单${tag}` },
    });
    const login = await call('POST', '/auth/login', null, { email, password: 'test123456' });
    return { user, token: login.data?.accessToken };
  };

  const A = await mkUser('mo-a');
  const B = await mkUser('mo-b');
  if (!A.token || !B.token) {
    console.error('登录失败, 无法继续:', A.token, B.token);
    process.exit(1);
  }

  const plans = await prisma.membershipPlan.findMany({ where: { status: 'active' } });
  const basic = plans.find((p) => p.code === 'basic');
  const pro = plans.find((p) => p.code === 'pro');
  if (!basic || !pro) {
    console.error('缺少 basic/pro 套餐, 请先 npm run seed:membership');
    process.exit(1);
  }

  console.log(`\n数据库 ${resolveDbPath()}`);
  console.log(`接口   ${BASE}\n`);

  // ── 1. 下单: 会员单不带 OrderItem, 金额取套餐原价 ──────────────────
  console.log('【会员下单】');
  const orderRes = await call('POST', '/orders', A.token, {
    idempotencyKey: idem('mo-create'),
    membershipPlanId: pro.id,
  });
  const order = orderRes.data;
  check('会员订单创建成功', orderRes.httpStatus === 200 || orderRes.httpStatus === 201,
    orderRes.message || order?.orderNo);
  check('订单金额 = 套餐原价', order?.totalCents === pro.priceCents,
    `${order?.totalCents} 分 vs 套餐 ${pro.priceCents} 分`);
  check('不建 OrderItem', Array.isArray(order?.items) && order.items.length === 0,
    `items=${order?.items?.length}`);
  check('订单标记了会员套餐', order?.membershipPlanId === pro.id,
    order?.membershipPlanName ?? order?.membershipPlanId);

  const mixRes = await call('POST', '/orders', A.token, {
    idempotencyKey: idem('mo-mix'),
    membershipPlanId: pro.id,
    productId: 'any-product',
    quantity: 1,
  });
  check('会员与商品不能混单 (400)', mixRes.code === 40001, mixRes.message);

  const couponRes = await call('POST', '/orders', A.token, {
    idempotencyKey: idem('mo-coupon'),
    membershipPlanId: basic.id,
    couponCode: 'NOT-A-REAL-CODE',
  });
  check('会员单不因券失败', couponRes.code === 0, couponRes.message);
  check('会员单金额不打折', couponRes.data?.paidCents === basic.priceCents,
    `${couponRes.data?.paidCents} 分`);
  check('券被明确提示未生效', typeof couponRes.data?.couponWarning === 'string',
    couponRes.data?.couponWarning);

  // ── 2. 无订单 / 未支付订单都不能开通 ─────────────────────────────
  console.log('\n【权益不能凭空发放】');
  const noOrder = await call('POST', '/membership/subscribe', A.token, { planId: pro.id });
  check('缺少 orderId 被拒 (400)', noOrder.code === 40001, noOrder.message);

  const unpaid = await call('POST', '/membership/subscribe', A.token, {
    planId: pro.id,
    orderId: order.id,
  });
  check('未支付订单不能开通 (409)', unpaid.code === 40901, unpaid.message);

  const notMine = await call('POST', '/membership/subscribe', B.token, {
    planId: pro.id,
    orderId: order.id,
  });
  check('他人订单不能开通 (403)', notMine.code === 40301, notMine.message);

  const meBefore = await call('GET', '/membership/me', A.token);
  const balBefore = await call('GET', '/credits/balance', A.token);
  check('以上尝试均未产生会员', meBefore.data?.isMember === false);
  check('以上尝试均未发放积分', balBefore.data?.balance === 0, `${balBefore.data?.balance} 积分`);

  // ── 3. 支付成功 → 自动激活 (不需要再调 subscribe) ────────────────
  console.log('\n【支付即激活】');
  const pay = await call('POST', `/orders/${order.id}/pay`, A.token, { scenario: 'success' });
  check('沙箱支付成功', pay.data?.order?.status === 'paid', pay.message);

  const me = await call('GET', '/membership/me', A.token);
  check('会员已生效', me.data?.isMember === true, me.data?.planName);
  check('权益来自套餐', me.data?.perks?.maxConcurrent === 5 || me.data?.perks?.fastChannel === true,
    JSON.stringify(me.data?.perks));

  const bal = await call('GET', '/credits/balance', A.token);
  check('首期积分已发放', bal.data?.balance === pro.monthlyCredits,
    `${bal.data?.balance} / ${pro.monthlyCredits}`);

  const applied = await prisma.order.findUnique({
    where: { id: order.id },
    select: { membershipAppliedAt: true, grantedCredits: true },
  });
  check('订单记录了权益发放时刻', applied?.membershipAppliedAt instanceof Date);
  check('订单 grantedCredits 含会员积分', applied?.grantedCredits === pro.monthlyCredits,
    `${applied?.grantedCredits}`);

  // ── 4. 一单只能兑换一次 ────────────────────────────────────────
  console.log('\n【一单只兑换一次】');
  const replay = await call('POST', '/membership/subscribe', A.token, {
    planId: pro.id,
    orderId: order.id,
  });
  check('重复兑换返回已处理', replay.code === 0 && replay.data?.alreadyApplied === true,
    replay.message);
  const balAfterReplay = await call('GET', '/credits/balance', A.token);
  check('**积分未重复发放**', balAfterReplay.data?.balance === bal.data?.balance,
    `${bal.data?.balance} → ${balAfterReplay.data?.balance}`);

  const replayPay = await call('POST', `/orders/${order.id}/pay`, A.token, { scenario: 'success' });
  check('重复支付是幂等的', replayPay.data?.idempotentHit === true, replayPay.message);
  const balAfterPay = await call('GET', '/credits/balance', A.token);
  check('重复支付未二次发积分', balAfterPay.data?.balance === bal.data?.balance,
    `${balAfterPay.data?.balance}`);

  // ── 5. 订单与套餐必须匹配 ──────────────────────────────────────
  console.log('\n【订单与套餐必须匹配】');
  const basicOrder = await call('POST', '/orders', B.token, {
    idempotencyKey: idem('mo-basic'),
    membershipPlanId: basic.id,
  });
  await call('POST', `/orders/${basicOrder.data.id}/pay`, B.token, { scenario: 'success' });
  const mismatch = await call('POST', '/membership/subscribe', B.token, {
    planId: pro.id,
    orderId: basicOrder.data.id,
  });
  check('买 basic 不能用 pro 兑换 (400)', mismatch.code === 40001, mismatch.message);

  const replayB = await call('POST', '/membership/subscribe', B.token, {
    planId: basic.id,
    orderId: basicOrder.data.id,
  });
  check('本人订单可再次确认 (幂等)', replayB.code === 0 && replayB.data?.alreadyApplied === true,
    replayB.message);
  const balB = await call('GET', '/credits/balance', B.token);
  check('B 的积分只有一期', balB.data?.balance === basic.monthlyCredits,
    `${balB.data?.balance} / ${basic.monthlyCredits}`);

  // ── 6. 续费: 新订单顺延周期, 不覆盖旧订单的发放凭据 ──────────────
  console.log('\n【续费顺延】');
  const before = await prisma.membership.findFirst({ where: { userId: A.user.id } });
  check('支付后存在会员记录', !!before);
  const renewOrder = await call('POST', '/orders', A.token, {
    idempotencyKey: idem('mo-renew'),
    membershipPlanId: pro.id,
  });
  await call('POST', `/orders/${renewOrder.data.id}/pay`, A.token, { scenario: 'success' });
  const after = await prisma.membership.findFirst({ where: { userId: A.user.id } });
  check('续期从原到期时间顺延',
    !!before && !!after && after.expiresAt.getTime() > before.expiresAt.getTime(),
    `${before?.expiresAt.toISOString().slice(0, 10)} → ${after?.expiresAt.toISOString().slice(0, 10)}`);
  check('两笔订单各自留有发放凭据',
    (await prisma.order.count({
      where: { userId: A.user.id, membershipPlanId: pro.id, membershipAppliedAt: { not: null } },
    })) === 2,
  );

  console.log(`\n合计: ${pass} 通过 / ${fail} 失败\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('冒烟执行异常:', e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
