/**
 * 退款规则与系统设置写入冒烟 (B8)。
 *
 * 守住四件事:
 *   1. 系统设置**读到的字段名就是写入时要用的字段名** —— 曾经读回 `site.name`
 *      而写入接口只认 `siteName`, 前端照着 key 回传被白名单静默剥掉,
 *      结果是「保存成功但什么都没变」(实际是 400 没有需要更新的设置项)
 *   2. 退款时间窗: 超过 windowDays 的订单拒绝退 (40905)
 *   3. 可退比例上限: 超过实付 × maxRatioBps 的金额拒绝退 (40906)
 *   4. 已消耗积分: allowConsumedTask=false 时, 积分已被花掉的订单拒绝退 (40907)
 * 另验证会员订单全额退款会终止其发放的会员权益。
 *
 * 用法 (测试档, 禁止指向开发库):
 *   NODE_ENV=test API_BASE=http://127.0.0.1:4200 node scripts/smoke-refund-rules.js
 */
const { PrismaClient } = require('@prisma/client');
const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const { loadEnvOnce, resolveDbUrl } = require('./db-url');

loadEnvOnce();

const BASE = (process.env.API_BASE || 'http://127.0.0.1:4100').replace(/\/$/, '') + '/api/v1';
/**
 * 读库重试。
 *
 * SQLite 是单写者: 脚本一边发 HTTP(后端进程在写)一边直连读同一个 test.db,
 * 必然撞 "database is locked"。这不是产品缺陷, 是测试形态的固有冲突
 * (与 smoke-marketing.js 同一处理)。用扩展包一层, 调用处不必逐个包 try。
 *
 * 重试写操作是安全的: 报 SQLITE_BUSY 时语句没有提交。
 */
const base = new PrismaClient({
  adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }),
});
const prisma = base.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query }) {
        let lastErr;
        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            return await query(args);
          } catch (e) {
            if (e?.code !== 'P2039' && !/database is locked/i.test(e?.message ?? '')) throw e;
            lastErr = e;
            await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
          }
        }
        throw lastErr;
      },
    },
  },
});

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

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

const NEED_PERMS = [
  'setting.read',
  'setting.write',
  'order.read',
  'order.refund',
  'credit.read',
  'user.read',
];

async function ensureAdminRole() {
  const record = await prisma.adminRole.findUnique({ where: { code: 'admin' } });
  if (!record) {
    await prisma.adminRole.create({
      data: { code: 'admin', name: '超级管理员', permissions: JSON.stringify(NEED_PERMS) },
    });
    return;
  }
  let perms = [];
  try {
    perms = JSON.parse(record.permissions);
  } catch {
    perms = [];
  }
  const missing = NEED_PERMS.filter((p) => !perms.includes(p));
  if (missing.length) {
    // 只补缺的, 不覆盖后台调过的矩阵
    await prisma.adminRole.update({
      where: { code: 'admin' },
      data: { permissions: JSON.stringify([...perms, ...missing]) },
    });
  }
}

const DEFAULTS = { refundWindowDays: 7, refundMaxRatioBps: 10000, refundAllowConsumedTask: true };
let seq = 0;
const idem = (tag) => `rf-${tag}-${Date.now()}-${seq++}`;

(async () => {
  const bcrypt = require('bcryptjs');
  const stamp = Date.now();
  const userIds = [];
  const orderIds = [];

  await ensureAdminRole();

  const mkUser = async (tag) => {
    const email = `smoke-refund-${tag}-${stamp}@test.com`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash('test123456', 10), name: `退款冒烟${tag}` },
    });
    userIds.push(user.id);
    const login = await call('POST', '/auth/login', null, { email, password: 'test123456' });
    return { id: user.id, email, token: login.data?.accessToken };
  };

  const setRules = (patch) =>
    call('PATCH', '/admin/settings', A.token, { ...patch, reason: '退款规则冒烟' });

  /** 下单 → 沙箱支付, 返回订单详情 */
  const paidOrder = async (body) => {
    const created = await call('POST', '/orders', user.token, { ...body, idempotencyKey: idem('o') });
    const orderId = created.data?.id;
    if (!orderId) throw new Error(`下单失败: ${created.message ?? JSON.stringify(created).slice(0, 120)}`);
    orderIds.push(orderId);
    const pay = await call('POST', `/orders/${orderId}/pay`, user.token, { scenario: 'success' });
    if (pay.data?.order?.status !== 'paid') {
      throw new Error(`支付失败: ${pay.message ?? JSON.stringify(pay).slice(0, 120)}`);
    }
    return { ...created.data, ...pay.data.order };
  };

  // ── 准备账号 ────────────────────────────────────────────────────────
  console.log('\n【准备账号】');
  const adminEmail = `smoke-refund-admin-${stamp}@test.com`;
  const adminUser = await prisma.user.create({
    data: { email: adminEmail, passwordHash: await bcrypt.hash('test123456', 10), name: '退款客服' },
  });
  userIds.push(adminUser.id);
  await prisma.user.update({ where: { id: adminUser.id }, data: { role: 'admin' } });
  const adminLogin = await call('POST', '/auth/login', null, { email: adminEmail, password: 'test123456' });
  const A = { token: adminLogin.data?.accessToken };

  const user = await mkUser('buyer');

  /*
   * 商品与套餐由脚本自建, 不复用种子数据:
   *   · 种子商品可能被限时活动改了价 (B-38 限时免费会把 paidCents 变成 0),
   *     价格不确定就没法断言「退一半」这类按比例的数字
   *   · grantType 必须是 immediate, 否则支付不自动发积分, 批次断言会落空
   */
  const product = await prisma.product.create({
    data: {
      sku: `SMOKE-RF-${stamp}`,
      name: '退款冒烟积分包',
      priceCents: 1000,
      credits: 100,
      creditsValidDays: 0,
      grantType: 'immediate',
      status: 'active',
    },
  });
  const plan = await prisma.membershipPlan.create({
    data: {
      code: `smoke-refund-plan-${stamp}`,
      name: '退款冒烟会员',
      priceCents: 5000,
      durationDays: 30,
      monthlyCredits: 200,
      status: 'active',
    },
  });
  check(
    '测试账号与商品就绪',
    Boolean(A.token && user.token && product && plan),
    `product=${product.sku} plan=${plan.code}`,
  );

  // ── 设置读写往返 ────────────────────────────────────────────────────
  console.log('\n【系统设置读写】');
  const settings = await call('GET', '/admin/settings', A.token);
  const refundGroup = (settings.data?.groups ?? []).find((g) => g.key === 'refund');
  check('退款规则分组已下发', Boolean(refundGroup), refundGroup?.label);
  check(
    '每项同时下发 key 与写入用 field',
    (settings.data?.groups ?? [])
      .flatMap((g) => g.items ?? [])
      .every((i) => typeof i.key === 'string' && typeof i.field === 'string' && i.field.length > 0),
  );
  check(
    '退款三项齐全且带默认值',
    (refundGroup?.items ?? []).length === 3 &&
      refundGroup.items.every((i) => i.value !== undefined && i.type !== undefined),
    (refundGroup?.items ?? []).map((i) => `${i.field}=${i.value}`).join(' '),
  );

  const dotted = await call('PATCH', '/admin/settings', A.token, { 'refund.windowDays': 7 });
  check(
    '按点号键写入被拒（白名单只认扁平字段名）',
    dotted.httpStatus === 400,
    `${dotted.httpStatus} ${dotted.message ?? ''}`,
  );

  const saved = await setRules(DEFAULTS);
  check(
    '按 field 写入成功',
    saved.httpStatus === 200 && (saved.data?.updated ?? []).length === 3,
    JSON.stringify(saved.data?.updated ?? saved.message),
  );

  // ── 规则一：可退比例上限 ────────────────────────────────────────────
  console.log('\n【可退比例上限】');
  await setRules({ refundMaxRatioBps: 5000 });
  const o1 = await paidOrder({ productId: product.id, quantity: 1 });
  const half = Math.floor(o1.paidCents / 2);

  const over = await call('POST', `/admin/orders/${o1.id}/refund`, A.token, {
    amountCents: half + 1,
    reason: '比例上限冒烟',
  });
  check(
    '超过实付 50% 的退款被拒 40906',
    over.httpStatus === 409 && over.code === 40906,
    `${over.httpStatus} ${over.message ?? ''}`,
  );
  check(
    '拒绝时不产生退款记录',
    (await prisma.refund.count({ where: { orderId: o1.id } })) === 0,
  );

  const within = await call('POST', `/admin/orders/${o1.id}/refund`, A.token, {
    amountCents: half,
    reason: '比例内退款',
  });
  check(
    '上限内的退款成功（部分退款）',
    within.httpStatus === 200 || within.httpStatus === 201
      ? within.data?.fullyRefunded === false
      : false,
    `${within.httpStatus} refunded=${within.data?.refundedCents ?? within.message}`,
  );

  // ── 规则二：时间窗 ──────────────────────────────────────────────────
  console.log('\n【可退款时间窗】');
  await setRules({ refundMaxRatioBps: 10000, refundWindowDays: 7 });
  const o2 = await paidOrder({ productId: product.id, quantity: 1 });
  // 把支付时间拨回 10 天前, 模拟超出时间窗的存量订单
  await prisma.order.update({
    where: { id: o2.id },
    data: { paidAt: new Date(Date.now() - 10 * 24 * 3600 * 1000) },
  });
  const expired = await call('POST', `/admin/orders/${o2.id}/refund`, A.token, {
    amountCents: 1,
    reason: '时间窗冒烟',
  });
  check(
    '超出 7 天时间窗的订单拒绝退款 40905',
    expired.httpStatus === 409 && expired.code === 40905,
    `${expired.httpStatus} ${expired.message ?? ''}`,
  );

  await setRules({ refundWindowDays: 0 });
  const noWindow = await call('POST', `/admin/orders/${o2.id}/refund`, A.token, {
    amountCents: 1,
    reason: '不限时间窗',
  });
  check(
    'windowDays=0 时不限时间（同一订单可退）',
    noWindow.httpStatus === 200 || noWindow.httpStatus === 201,
    `${noWindow.httpStatus} ${noWindow.message ?? ''}`,
  );

  // ── 规则三：已消耗积分 ──────────────────────────────────────────────
  console.log('\n【已消耗积分】');
  await setRules({ refundWindowDays: 7, refundAllowConsumedTask: false });
  const o3 = await paidOrder({ productId: product.id, quantity: 1 });
  const lot = await prisma.creditLot.findFirst({ where: { orderId: o3.id } });
  check('订单积分批次已生成', Boolean(lot), `remaining=${lot?.remainingCredits}`);
  /*
   * 把该用户**全部**批次余额清零 = 模拟积分已被生成任务花掉。
   * 规则按「该用户名下可用余额」与「本单发放量」比较, 只清本单批次不足以
   * 触发 —— 前面两单退款后仍有剩余积分, 会被判定为「能扣回」。
   */
  await prisma.creditLot.updateMany({
    where: { userId: user.id },
    data: { remainingCredits: 0 },
  });

  const consumed = await call('POST', `/admin/orders/${o3.id}/refund`, A.token, {
    amountCents: o3.paidCents,
    reason: '已消耗积分冒烟',
  });
  check(
    '积分已消耗且规则禁止时拒绝退款 40907',
    consumed.httpStatus === 409 && consumed.code === 40907,
    `${consumed.httpStatus} ${consumed.message ?? ''}`,
  );

  await setRules({ refundAllowConsumedTask: true });
  const allowed = await call('POST', `/admin/orders/${o3.id}/refund`, A.token, {
    amountCents: o3.paidCents,
    reason: '允许已消耗退款',
  });
  check(
    '规则放开后可退, 且如实报告不可扣回的积分数',
    (allowed.httpStatus === 200 || allowed.httpStatus === 201) &&
      allowed.data?.fullyRefunded === true &&
      allowed.data?.creditsUnreclaimable > 0,
    `fullyRefunded=${allowed.data?.fullyRefunded} unreclaimable=${allowed.data?.creditsUnreclaimable}`,
  );

  // ── 会员订单退款 → 终止会员 ────────────────────────────────────────
  console.log('\n【会员订单全额退款】');
  await setRules(DEFAULTS);
  const membershipOrder = await paidOrder({ membershipPlanId: plan.id, quantity: 1 });
  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, status: { in: ['active', 'grace'] } },
  });
  check('会员已随支付激活', Boolean(membership), membership?.status);

  const mrefund = await call('POST', `/admin/orders/${membershipOrder.id}/refund`, A.token, {
    amountCents: membershipOrder.paidCents,
    reason: '会员订单退款冒烟',
  });
  check(
    '会员订单全额退款成功',
    (mrefund.httpStatus === 200 || mrefund.httpStatus === 201) && mrefund.data?.fullyRefunded === true,
    `${mrefund.httpStatus} ${mrefund.message ?? ''}`,
  );
  check('响应标记会员已终止', mrefund.data?.membershipTerminated === true);
  const afterMembership = await prisma.membership.findFirst({ where: { orderId: membershipOrder.id } });
  check(
    '会员状态转为 cancelled 且停发后续积分',
    afterMembership?.status === 'cancelled' && afterMembership?.nextCreditAt === null,
    `status=${afterMembership?.status} nextCreditAt=${afterMembership?.nextCreditAt}`,
  );

  // ── 还原设置 ────────────────────────────────────────────────────────
  const restored = await setRules(DEFAULTS);
  const readBack = await call('GET', '/admin/settings', A.token);
  const back = (readBack.data?.groups ?? [])
    .flatMap((g) => g.items ?? [])
    .filter((i) => i.key.startsWith('refund.'))
    .reduce((acc, i) => ({ ...acc, [i.field]: i.value }), {});
  check(
    '规则已还原为默认值',
    (restored.httpStatus === 200) &&
      back.refundWindowDays === 7 &&
      back.refundMaxRatioBps === 10000 &&
      back.refundAllowConsumedTask === true,
    JSON.stringify(back),
  );

  // ── 清理 ────────────────────────────────────────────────────────────
  console.log('\n【清理】');
  await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.creditLedger.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.creditLot.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.loginLog.updateMany({ where: { userId: { in: userIds } }, data: { userId: null } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  // 商品与套餐必须最后删: OrderItem/Order 仍以外键引用它们
  await prisma.product.deleteMany({ where: { id: product.id } });
  await prisma.membershipPlan.deleteMany({ where: { id: plan.id } });
  await prisma.$disconnect();
  console.log('  已清理测试订单与测试账号');

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error('冒烟脚本异常:', e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
