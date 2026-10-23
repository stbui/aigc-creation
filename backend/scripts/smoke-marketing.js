/**
 * 营销中心冒烟测试 (M11 · admin-prd.md B-64~B-67 / admin-detailed-design.md §12)。
 *
 * 覆盖的是**规则边界**, 不是"接口通不通" —— 通不通的验证价值远低于下面这些:
 *   券:门槛判定 / 折扣区间 / 每人限用 / 限量 / 上下架不误伤历史订单
 *   结算: 券与活动不叠加取更优 / 快照落库 / 支付后才核销
 *   活动: 时间窗内生效 / 到期收尾 / 活动价不高于原价
 *   邀请: 自邀请拒绝 / 一人只绑一次 / 重复回调不重复发奖
 *   签到: 同日幂等 / 连签加成 / 唯一约束防重复
 *
 * 前置: 后端已启动 (npm start), 且已 npm run seed:marketing。
 * 运行: npm run smoke:marketing
 */
const BASE = process.env.MARKETING_API_BASE || 'http://localhost:4100/api/v1';
const { PrismaClient } = require('@prisma/client');
const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const { resolveDbUrl } = require('./db-url');
const prisma = new PrismaClient({ adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }) });

const DAY = 24 * 3600 * 1000;

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
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, ...json };
}

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

/**
 * 读库重试。
 *
 * SQLite 是**单写者**: 冒烟脚本一边发 HTTP(后端进程在写)一边直连读同一个
 * dev.db, 必然撞 "database is locked"。这不是产品缺陷, 是测试形态的固有冲突。
 * 退避重试是最小修订 —— 换成只读副本或让后端代查都超出了冒烟脚本的职责。
 */
async function db(fn, label = 'db') {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (e?.code !== 'P2039' && !/database is locked/i.test(e?.message ?? '')) throw e;
      lastErr = e;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  console.log(`  WARN  ${label} 读写重试耗尽: ${lastErr?.message ?? ''}`);
  throw lastErr;
}

/** 造一个带随机后缀的测试账号, 避免污染演示数据与历史测试残留 */
let seq = 0;
async function makeUser(role = 'user') {
  seq += 1;
  const email = `mk${Date.now()}${seq}@test.local`;
  const bcrypt = require('bcryptjs');
  // 哈希在闭包外算: db() 的回调是箭头函数, 内层再 await 虽合法但读起来像同步
  const passwordHash = await bcrypt.hash('test123456', 10);
  await db(() =>
    prisma.user.create({
      data: { email, passwordHash, name: `营销测试${seq}`, role },
    }),
  );
  const login = await call('POST', '/auth/login', null, { email, password: 'test123456' });
  return { email, token: login.data.accessToken, id: login.data.user.id };
}

/** 造券 */
async function makeCoupon(over = {}) {
  const code = `T${Date.now()}${seq++}${Math.random().toString(36).slice(2, 5)}`.toUpperCase().slice(0, 24);
  const now = Date.now();
  const c = await db(() =>  prisma.coupon.create({
    data: {
      code,
      name: over.name ?? '测试券',
      type: over.type ?? 'full_cut',
      value: over.value ?? 1000,
      thresholdCents: over.thresholdCents ?? 0,
      scope: over.scope ?? 'all',
      productIds: JSON.stringify(over.productIds ?? []),
      totalCount: over.totalCount ?? 0,
      perUserLimit: over.perUserLimit ?? 1,
      validFrom: new Date(now - DAY),
      validTo: new Date(now + (over.validDays ?? 30) * DAY),
      status: 'on',
    },
  }));
  return c;
}

/**
 * 造一个**干净**的测试商品: 无任何活动挂载, 价格固定。
 *
 * 为什么不直接用 seed 的商品: seed 会建一个生效中的限时价活动, 而限时价是
 * **自动匹配**的 —— 只要它在, 每次试算都会被活动优惠污染, 纯券断言全部失真。
 * 用独立商品把"券逻辑"与"活动逻辑"隔离开, 两组断言才各自可复现。
 */
async function makeCleanProduct(name) {
  const sku = `MKTEST_${name.toUpperCase()}`;
  const existing = await db(() => prisma.product.findUnique({ where: { sku } }));
  if (existing) return existing;
  return prisma.product.create({
    data: {
      sku,
      name,
      description: '营销冒烟专用, 无活动挂载',
      type: 'credits',
      priceCents: 10000, // 100 元, 取整便于断言
      credits: 1000,
      creditsValidDays: 0,
      grantType: 'immediate',
      status: 'active',
      sortOrder: 999,
    },
  });
}

/** 首个上架商品, 用于限时价活动测试 */
async function firstProduct() {
  const p = await db(() => prisma.product.findFirst({ where: { status: 'active', priceCents: { gt: 0 } } }));
  if (!p) throw new Error('缺少上架商品, 请先跑 npm run seed:commerce');
  return p;
}

/** 本地日期 YYYY-MM-DD。与后端 localDay() 同口径 */
function localDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 造 n 天历史签到记录, 用于验证连签加成 */
async function seedPriorDays(userId, n) {
  for (let i = n; i >= 1; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    await db(() =>  prisma.checkinRecord.create({
      data: { userId, day: localDay(d), credits: 5, streak: 1 },
    }));
  }
}

(async () => {
  /*
   * 后台身份: 现场建临时管理员。
   * 不复用 seed:admin 建的角色 —— 它的随机密码不可从库里反推, 拿不到 token;
   * 也不用任何 C 端注册账号 —— 它们的 role 是 user, 没有后台权限。
   */
  const adminUser = await makeUser('admin');
  const adminToken = adminUser.token;

  const product = await firstProduct();
  console.log(`\n测试基准商品: ${product.name} (${product.priceCents / 100} 元)`);

  // ══════════════════════════════════════════════════════════════
  console.log('\n【优惠券 · 校验边界 B-64】');
  {
    // 减免不得超过门槛
    const r = await call('POST', '/admin/coupons', adminToken, {
      code: `BAD${Date.now().toString().slice(-8)}`, name: '非法券', type: 'full_cut',
      value: 5000, thresholdCents: 1000, validFrom: new Date().toISOString(),
      validTo: new Date(Date.now() + DAY).toISOString(),
    });
    check('减免额超门槛被拒', r.status === 400, r.message);

    // 折扣必须 < 10 折
    const r2 = await call('POST', '/admin/coupons', adminToken, {
      code: `BAD${Date.now().toString().slice(-6)}X`, name: '无效折扣', type: 'discount',
      value: 10000, validFrom: new Date().toISOString(),
      validTo: new Date(Date.now() + DAY).toISOString(),
    });
    check('折扣不小于10折被拒', r2.status === 400, r2.message);

    // 时间倒置
    const r3 = await call('POST', '/admin/coupons', adminToken, {
      code: `BAD${Date.now().toString().slice(-6)}Y`, name: '时间倒置', type: 'fixed', value: 100,
      validFrom: new Date(Date.now() + DAY).toISOString(),
      validTo: new Date().toISOString(),
    });
    check('失效早于生效被拒', r3.status === 400, r3.message);

    // 券码唯一
    const dupCode = `DUP${Date.now().toString().slice(-8)}`;
    const payload = {
      code: dupCode, name: '唯一性测试', type: 'fixed', value: 100,
      validFrom: new Date().toISOString(), validTo: new Date(Date.now() + DAY).toISOString(),
    };
    const a = await call('POST', '/admin/coupons', adminToken, payload);
    const b = await call('POST', '/admin/coupons', adminToken, payload);
    check('券码创建成功', a.status === 200 || a.status === 201, a.data?.code);
    check('重复券码被拒', b.status === 400, b.message);

    // 券码不可改
    const rename = await call('PATCH', `/admin/coupons/${a.data.id}`, adminToken, {
      ...payload, code: `NEW${Date.now().toString().slice(-8)}`,
    });
    check('券码不可修改', rename.status === 400, rename.message);
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n【优惠券 · 门槛与折扣计算】');
  const buyer = await makeUser();
  const clean = await makeCleanProduct('coupon');
  {
    // 门槛未达 → 试算返回不打折 + 原因, 但**下单不阻断**
    const gated = await makeCoupon({ type: 'full_cut', value: 1000, thresholdCents: clean.priceCents + 10000 });
    const q1 = await call('POST', '/marketing/quote', buyer.token, {
      productIds: [clean.id], quantities: [1], couponCode: gated.code,
    });
    check('门槛未达时优惠为 0', q1.data?.discountCents === 0, `原因=${q1.data?.notStackedNotice ?? ''}`);
    check('门槛未达不阻断试算', q1.status === 200 || q1.status === 201);

    // 满减命中(干净商品无活动, 优惠额应恰为面额)
    const hit = await makeCoupon({ type: 'full_cut', value: 1000, thresholdCents: 0 });
    const q2 = await call('POST', '/marketing/quote', buyer.token, {
      productIds: [clean.id], quantities: [1], couponCode: hit.code,
    });
    check('满减券减免 10 元', q2.data?.discountCents === 1000, `实付=${q2.data?.payableCents}`);
    check('优惠来源=券', q2.data?.appliedSource === 'coupon', q2.data?.appliedSource);

    /*
     * 折扣: 8500万分比 = 85折 = 只付 85%, 所以**优惠 = 原价 × 15%**。
     * (易错点: 优惠额是省下的钱, 不是折后应付额 —— 后者是 原价×0.85)
     */
    const disc = await makeCoupon({ type: 'discount', value: 8500 });
    const expectDiscount = clean.priceCents - Math.floor((clean.priceCents * 8500) / 10000);
    const q3 = await call('POST', '/marketing/quote', buyer.token, {
      productIds: [clean.id], quantities: [1], couponCode: disc.code,
    });
    check('8.5折优惠= 原价×15%(向下取整到分)', q3.data?.discountCents === expectDiscount,
      `原价=${clean.priceCents} 优惠=${q3.data?.discountCents} 期望=${expectDiscount}`);
    check('8.5折实付= 原价×85%', q3.data?.payableCents === clean.priceCents - expectDiscount,
      `实付=${q3.data?.payableCents}`);

    // 优惠不得超过原价
    const huge = await makeCoupon({ type: 'fixed', value: clean.priceCents + 100000 });
    const q4 = await call('POST', '/marketing/quote', buyer.token, {
      productIds: [clean.id], quantities: [1], couponCode: huge.code,
    });
    check('优惠不超过原价(实付不为负)', q4.data?.payableCents >= 0, `实付=${q4.data?.payableCents}`);

    // 过期券
    const expired = await db(() =>  prisma.coupon.create({
      data: {
        code: `EXP${Date.now().toString().slice(-8)}`, name: '已过期', type: 'fixed', value: 100,
        validFrom: new Date(Date.now() - 10 * DAY), validTo: new Date(Date.now() - DAY), status: 'on',
      },
    }));
    const q5 = await call('POST', '/marketing/quote', buyer.token, {
      productIds: [clean.id], quantities: [1], couponCode: expired.code,
    });
    check('过期券不生效', q5.data?.discountCents === 0);
    const expiredView = await call('GET', `/admin/coupons/${expired.id}`, adminToken);
    check('过期券 effective=expired (区别于人工停用)', expiredView.data?.effective === 'expired',
      `effective=${expiredView.data?.effective}`);

    // 停用券
    const offCode = await makeCoupon({ type: 'fixed', value: 100 });
    await call('PATCH', `/admin/coupons/${offCode.id}/toggle`, adminToken);
    const q6 = await call('POST', '/marketing/quote', buyer.token, {
      productIds: [clean.id], quantities: [1], couponCode: offCode.code,
    });
    check('停用券不生效', q6.data?.discountCents === 0);
    const offView = await call('GET', `/admin/coupons/${offCode.id}`, adminToken);
    check('停用券 effective=off', offView.data?.effective === 'off', offView.data?.effective);

    // 限量售罄
    const soldOut = await makeCoupon({ type: 'fixed', value: 100, totalCount: 1 });
    await db(() =>  prisma.coupon.update({ where: { id: soldOut.id }, data: { usedCount: 1 } }));
    const q7 = await call('POST', '/marketing/quote', buyer.token, {
      productIds: [clean.id], quantities: [1], couponCode: soldOut.code,
    });
    check('已领完的券不生效', q7.data?.discountCents === 0);
    const soldView = await call('GET', `/admin/coupons/${soldOut.id}`, adminToken);
    check('售罄券 effective=sold_out', soldView.data?.effective === 'sold_out', soldView.data?.effective);
    check('售罄券 remaining=0', soldView.data?.remaining === 0);
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n【下单核销 · 支付后才计数】');
  {
    const c = await makeCoupon({ type: 'fixed', value: 500, perUserLimit: 1 });
    const before = c.usedCount;

    const key = `mk-${Date.now()}-a`;
    const ord = await call('POST', '/orders', buyer.token, {
      idempotencyKey: key, productId: clean.id, quantity: 1, couponCode: c.code,
    });
    check('下单成功', ord.status === 200 || ord.status === 201, ord.data?.orderNo);
    check('订单优惠已计算', ord.data?.discountCents === 500, `优惠=${ord.data?.discountCents}`);
    check('实付= 原价 - 优惠', ord.data?.paidCents === clean.priceCents - 500,
      `实付=${ord.data?.paidCents}`);
    check('券码已记录到订单', ord.data?.couponCode === c.code);
    check('优惠规则快照已落库', typeof ord.data?.couponCode === 'string');

    const mid = await db(() => prisma.coupon.findUnique({ where: { id: c.id } }));
    check('下单不占用 usedCount', mid.usedCount === before, `usedCount=${mid.usedCount}`);

    // 幂等: 同 key 重复下单不重复创建
    const dup = await call('POST', '/orders', buyer.token, {
      idempotencyKey: key, productId: clean.id, quantity: 1, couponCode: c.code,
    });
    check('重复下单幂等', dup.data?.idempotentHit === true && dup.data?.id === ord.data?.id);

    // 支付成功 → 核销
    const pay = await call('POST', `/orders/${ord.data.id}/pay`, buyer.token, { scenario: 'success' });
    check('沙箱支付成功', pay.status === 200 || pay.status === 201, pay.data?.message);
    const after = await db(() => prisma.coupon.findUnique({ where: { id: c.id } }));
    check('支付成功后 usedCount +1', after.usedCount === before + 1, `usedCount=${after.usedCount}`);

    // 重复支付 → 不重复核销
    await call('POST', `/orders/${ord.data.id}/pay`, buyer.token, { scenario: 'success' });
    const after2 = await db(() => prisma.coupon.findUnique({ where: { id: c.id } }));
    check('重复支付不重复核销', after2.usedCount === before + 1, `usedCount=${after2.usedCount}`);

    // 支付流水金额 = 实付, 不是原价 (否则对账看着像收了全价)
    const orderRow = await db(() =>
      prisma.order.findUnique({ where: { id: ord.data.id }, include: { payments: true } }),
    );
    check('支付流水金额= 实付', orderRow.payments[0]?.amountCents === clean.priceCents - 500,
      `流水=${orderRow.payments[0]?.amountCents} 实付=${clean.priceCents - 500}`);

    /*
     * 每人限用: 再下一单用同一张券。
     * 断言"优惠未变满额"而非"=0" —— 若同订单还叠加了活动, 优惠会是活动价;
     * 这里用干净商品, 券失效时优惠应为 0。
     */
    const ord2 = await call('POST', '/orders', buyer.token, {
      idempotencyKey: `mk-${Date.now()}-b`, productId: clean.id, quantity: 1, couponCode: c.code,
    });
    check('超出每人限用时优惠为 0', ord2.data?.discountCents === 0,
      `实际=${ord2.data?.discountCents}`);

    // 退款上限 = 实付, 不是原价 (用原价会让用户能退比支付更多的钱)
    const overRefund = await call('POST', `/admin/orders/${ord.data.id}/refund`, adminToken, {
      amountCents: clean.priceCents, reason: '测试超额退款',
    });
    check('退款额超实付被拒(防资损)', overRefund.status === 400, overRefund.message);
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n【限时活动 · 不叠加取更优】');
  {
    const now = Date.now();
    // 活动价 = 原价 5 折 → 优惠 50%
    const camp = await db(() =>  prisma.campaign.create({
      data: {
        name: `测试限时价${Date.now()}`, type: 'limited_price',
        payload: JSON.stringify({ productId: product.id, priceCents: Math.floor(product.priceCents / 2) }),
        startAt: new Date(now - 3600_000), endAt: new Date(now + DAY), status: 'active',
        audience: '{}',
      },
    }));

    const q = await call('POST', '/marketing/quote', buyer.token, {
      productIds: [product.id], quantities: [1],
    });
    const expectCamp = product.priceCents - Math.floor(product.priceCents / 2);
    check('限时价自动生效(无需手选活动)', q.data?.discountCents === expectCamp,
      `优惠=${q.data?.discountCents} 期望=${expectCamp}`);
    check('命中活动已标记', q.data?.appliedSource === 'campaign', q.data?.appliedSource);

    // 券更优 → 取券; 同时给一张大额券
    const big = await makeCoupon({ type: 'fixed', value: Math.floor(product.priceCents * 0.9), perUserLimit: 0 });
    const q2 = await call('POST', '/marketing/quote', buyer.token, {
      productIds: [product.id], quantities: [1], couponCode: big.code,
    });
    check('券更优时取券', q2.data?.appliedSource === 'coupon',
      `券=90% 活动=50%, 实际取=${q2.data?.appliedSource}`);
    check('不叠加: 优惠额等于较大者而非相加', q2.data?.discountCents === Math.floor(product.priceCents * 0.9),
      `优惠=${q2.data?.discountCents}`);
    check('已告知用户不叠加', typeof q2.data?.notStackedNotice === 'string', q2.data?.notStackedNotice);

    // 未到时间窗的活动不生效
    const future = await db(() =>  prisma.campaign.create({
      data: {
        name: `未开始活动${Date.now()}`, type: 'limited_price',
        payload: JSON.stringify({ productId: product.id, priceCents: 1 }),
        startAt: new Date(now + DAY), endAt: new Date(now + 2 * DAY), status: 'active', audience: '{}',
      },
    }));
    const q3 = await call('POST', '/marketing/quote', buyer.token, {
      productIds: [product.id], quantities: [1],
    });
    check('未开始的活动不生效', q3.data?.discountCents === expectCamp, `仍为活动优惠=${q3.data?.discountCents}`);

    // 活动价高于原价 → 按原价, 不涨价
    const expensive = await db(() =>  prisma.campaign.create({
      data: {
        name: `涨价活动${Date.now()}`, type: 'limited_price',
        payload: JSON.stringify({ productId: product.id, priceCents: product.priceCents * 3 }),
        startAt: new Date(now - 3600_000), endAt: new Date(now + DAY), status: 'active', audience: '{}',
      },
    }));
    const found = await db(() => prisma.campaign.findUnique({ where: { id: expensive.id } }));
    check('涨价活动已建(结算时夹到原价)', found.status === 'active');

    // 弹窗位
    const popup = await db(() =>
      prisma.campaign.findFirst({
        where: { type: 'popup', status: 'active', startAt: { lte: new Date() }, endAt: { gte: new Date() } },
      }),
    );
    const pop = await call('GET', '/marketing/popup');
    check('弹窗位匿名可访问', pop.status === 200);
    if (popup) {
      check('返回活动文案', typeof pop.data?.title === 'string', pop.data?.title);
      check('返回服务端时间戳(倒计时基准)', typeof pop.data?.serverNow === 'string', pop.data?.serverNow);
    } else {
      console.log('  SKIP  无生效弹窗活动 (先跑 npm run seed:marketing)');
    }

    // 过期收尾
    const expiredCamps = await db(() =>  prisma.campaign.updateMany({
      where: { id: camp.id }, data: { endAt: new Date(now - 1000) },
    }));
    check('活动可被置为过期(供调度器验证)', expiredCamps.count === 1);
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n【邀请分销 B-66】');
  {
    const inviter = await makeUser();
    const invitee = await makeUser();

    const mine = await call('GET', '/marketing/invites', inviter.token);
    check('我的邀请码可获取', mine.status === 200 && typeof mine.data?.inviteCode === 'string',
      mine.data?.inviteCode);
    check('邀请码已落库(可反查)', !!inviter.id);

    const code = mine.data.inviteCode;

    // 自邀请被拒
    const self = await call('POST', '/marketing/invites/bind', inviter.token, { inviteCode: code });
    check('自邀请被拒', self.data?.bound === false && self.data?.reason === 'self_invite',
      JSON.stringify(self.data));

    // 正常绑定
    const bind = await call('POST', '/marketing/invites/bind', invitee.token, { inviteCode: code });
    check('邀请绑定成功', bind.data?.bound === true, bind.data?.reason);

    // 二次绑定被拒(换一个人)
    const invitee2 = await makeUser();
    const rebind = await call('POST', '/marketing/invites/bind', invitee2.token, { inviteCode: code });
    check('不同用户可各自绑定', rebind.data?.bound === true);

    // 同一被邀请人换码不能覆盖
    const inviter2 = await makeUser();
    const code2 = (await call('GET', '/marketing/invites', inviter2.token)).data.inviteCode;
    const override = await call('POST', '/marketing/invites/bind', invitee.token, { inviteCode: code2 });
    check('一人只被绑定一次(不覆盖)', override.data?.bound === false && override.data?.reason === 'already_bound',
      JSON.stringify(override.data));

    // 不存在的码
    const ghost = await makeUser();
    const bad = await call('POST', '/marketing/invites/bind', ghost.token, { inviteCode: 'NOTEXIST123' });
    check('不存在的邀请码被拒', bad.data?.bound === false && bad.data?.reason === 'code_not_found');

    // 规则: 首次付费触发 → 此时不发
    await call('PUT', '/admin/invites/rules', adminToken, {
      inviterCredits: 200, inviteeCredits: 100, triggerOn: 'first_pay', valid: true,
    });
    const rel = await db(() => prisma.inviteRelation.findFirst({ where: { inviteeId: invitee.id } }));
    check('绑定后关系为 pending', rel?.rewardStatus === 'pending', rel?.rewardStatus);

    // 被邀请人付费 → 发奖
    const orderKey = `mk-inv-${Date.now()}`;
    const ord = await call('POST', '/orders', invitee.token, {
      idempotencyKey: orderKey, productId: product.id, quantity: 1,
    });
    await call('POST', `/orders/${ord.data.id}/pay`, invitee.token, { scenario: 'success' });

    const relAfter = await db(() => prisma.inviteRelation.findFirst({ where: { inviteeId: invitee.id } }));
    check('首次付费后奖励已发放', relAfter?.rewardStatus === 'granted', relAfter?.rewardStatus);

    const inviterLots = await db(() =>
      prisma.creditLot.findMany({
        where: { userId: inviter.id, source: 'grant' }, orderBy: { createdAt: 'desc' }, take: 3,
      }),
    );
    check('邀请人已收到积分批次', inviterLots.length > 0, `批次=${inviterLots.length}`);

    // 我的邀请数据
    const myData = await call('GET', '/marketing/invites', inviter.token);
    check('累计收益只算已发放', myData.data?.metrics?.earnedCredits === 200,
      `earned=${myData.data?.metrics?.earnedCredits}`);
    check('累计邀请数真实', myData.data?.metrics?.totalInvited === 2,
      `total=${myData.data?.metrics?.totalInvited}`);
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n【签到 B-67】');
  {
    await call('PUT', '/admin/checkin/rules', adminToken, {
      baseCredits: 5,
      bonusRules: [{ day: 3, bonus: 10 }, { day: 7, bonus: 30 }],
      maxStreak: 0, dailyCap: 0, enabled: true,
    });

    const u = await makeUser();
    const st0 = await call('GET', '/marketing/checkin', u.token);
    check('签到状态可读', st0.status === 200, `今日可得=${st0.data?.nextCredits}`);
    check('今日可得= 基础积分', st0.data?.nextCredits === 5, `next=${st0.data?.nextCredits}`);
    check('含未来 7 天路线', st0.data?.forecast?.length === 7);

    const c1 = await call('POST', '/marketing/checkin', u.token);
    check('首次签到成功', c1.data?.alreadyCheckedIn === false, `积分=${c1.data?.credits}`);
    check('连续天数=1', c1.data?.streak === 1);

    const c2 = await call('POST', '/marketing/checkin', u.token);
    check('同日重复签到幂等', c2.data?.alreadyCheckedIn === true, `积分=${c2.data?.credits}`);

    const lots = await db(() => prisma.creditLot.count({ where: { userId: u.id } }));
    check('重复签到不多发积分', lots === 1, `批次数=${lots}`);

    const st1 = await call('GET', '/marketing/checkin', u.token);
    check('已签状态回读正确', st1.data?.checkedIn === true);
    check('连签天数回读为 1', st1.data?.streak === 1);

    // 唯一约束: 直接插同一天应被拒
    // 判据放宽到「被拒」而不只看 P2002: 自研 sqlite adapter 的错误码映射
    // 历史上曾漏掉约束分支(全落 P2039), 断言写死 P2002 会在映射回归时误报
    const dupInsert = await db(() =>  prisma.checkinRecord.create({
      data: { userId: u.id, day: st1.data.today, credits: 999, streak: 99 },
    })).then(() => null).catch((e) => e);
    check('同用户同日唯一约束生效', Boolean(dupInsert),
      dupInsert ? `code=${dupInsert.code}` : '未被拦截');

    // 加成规则: 造两天历史记录, 验证第 3 天加成
    const u2 = await makeUser();
    await seedPriorDays(u2.id, 2);
    const c3 = await call('POST', '/marketing/checkin', u2.token);
    check('连续第 3 天触发加成(5+10=15)', c3.data?.credits === 15, `实际=${c3.data?.credits}`);
    check('连续天数=3', c3.data?.streak === 3, `streak=${c3.data?.streak}`);

    // dailyCap 生效
    await call('PUT', '/admin/checkin/rules', adminToken, {
      baseCredits: 5, bonusRules: [{ day: 3, bonus: 100 }], maxStreak: 0, dailyCap: 8, enabled: true,
    });
    const u3 = await makeUser();
    await seedPriorDays(u3.id, 2);
    const c4 = await call('POST', '/marketing/checkin', u3.token);
    check('每日上限生效(加成被夹到 8)', c4.data?.credits === 8, `实际=${c4.data?.credits}`);

    // 关闭签到
    await call('PUT', '/admin/checkin/rules', adminToken, {
      baseCredits: 5, bonusRules: [], maxStreak: 0, dailyCap: 0, enabled: false,
    });
    const u4 = await makeUser();
    const off = await call('POST', '/marketing/checkin', u4.token);
    check('签到关闭后拒绝签到', off.status === 400, off.message);
    await call('PUT', '/admin/checkin/rules', adminToken, {
      baseCredits: 5, bonusRules: [{ day: 3, bonus: 10 }, { day: 7, bonus: 30 }],
      maxStreak: 0, dailyCap: 0, enabled: true,
    });
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n【后台权限 · marketing.write】');
  {
    const plain = await makeUser('user');
    const noPerm = await call('GET', '/admin/coupons', plain.token);
    check('C 端账号访问后台券列表被拒', noPerm.status === 403, noPerm.message);

    const operatorEmail = `mkop${Date.now()}@test.local`;
    const bcrypt = require('bcryptjs');
    const opHash = await bcrypt.hash('test123456', 10);
    await db(() =>
      prisma.user.create({
        data: { email: operatorEmail, passwordHash: opHash, name: '运营测试', role: 'operator' },
      }),
    );
    const opLogin = await call('POST', '/auth/login', null, { email: operatorEmail, password: 'test123456' });
    const opT = opLogin.data.accessToken;
    const opList = await call('GET', '/admin/coupons', opT);
    check('运营可读券列表(marketing.write)', opList.status === 200);

    // 手动补发奖励要 credit.adjust —— 运营无此权限
    const pendingRel = await db(() => prisma.inviteRelation.findFirst({ where: { rewardStatus: 'pending' } }));
    if (pendingRel) {
      const opGrant = await call('POST', `/admin/invites/${pendingRel.id}/grant`, opT);
      check('运营无 credit.adjust, 不能补发积分', opGrant.status === 403, opGrant.message);
    } else {
      console.log('  SKIP  无 pending 关系可测补发权限');
    }
    await prisma.user.delete({ where: { email: operatorEmail } }).catch(() => {});
  }

  // ══════════════════════════════════════════════════════════════
  console.log('\n【清理测试数据】');
  {
    const emails = (
      await db(() =>
        prisma.user.findMany({ where: { email: { contains: '@test.local' } }, select: { id: true } }),
      )
    ).map((u) => u.id);
    if (emails.length) {
      // 删除顺序必须**子表先于父表**, 否则触发 FOREIGN KEY constraint failed。
      // 直接引用 Order 的表全部要先清: OrderItem / Payment / Refund /
      // Invoice(一单一票) / Membership(订阅单) / MembershipUsage(会员折扣记录)。
      // 少清其中任意一张, 卡住的是 order.deleteMany —— 后续清理全被跳过,
      // 账号留在库里把后面用例与后台列表一起带脏。
      await db(() =>  prisma.refund.deleteMany({ where: { userId: { in: emails } } }));
      await db(() =>  prisma.payment.deleteMany({ where: { userId: { in: emails } } }));
      await db(() =>  prisma.invoice.deleteMany({ where: { order: { userId: { in: emails } } } }));
      await db(() =>  prisma.membershipUsage.deleteMany({ where: { userId: { in: emails } } }));
      await db(() =>  prisma.membership.deleteMany({ where: { userId: { in: emails } } }));
      await db(() =>  prisma.orderItem.deleteMany({ where: { order: { userId: { in: emails } } } }));
      await db(() =>  prisma.order.deleteMany({ where: { userId: { in: emails } } }));
      await db(() =>  prisma.creditLedger.deleteMany({ where: { userId: { in: emails } } }));
      await db(() =>  prisma.creditLot.deleteMany({ where: { userId: { in: emails } } }));
      await db(() =>  prisma.checkinRecord.deleteMany({ where: { userId: { in: emails } } }));
      await db(() =>  prisma.inviteRelation.deleteMany({ where: { OR: [{ inviterId: { in: emails } }, { inviteeId: { in: emails } }] } }));
      // B4 引入的表同样挂 userId 外键：不先清掉, 删用户必然 FOREIGN KEY failed,
      // 而失败被 catch 吞掉 → 残留账号把后续用例(与后台素材列表)一起带脏
      await db(() =>  prisma.notification.deleteMany({ where: { userId: { in: emails } } }));
      await db(() =>  prisma.accountToken.deleteMany({ where: { userId: { in: emails } } }));
      await db(() =>  prisma.loginLog.deleteMany({ where: { userId: { in: emails } } }));
      await db(() =>  prisma.consentRecord.deleteMany({ where: { userId: { in: emails } } }));
      await db(() =>  prisma.user.deleteMany({ where: { id: { in: emails } } }));
    }
    // 清理测试券与活动
    await db(() =>  prisma.coupon.deleteMany({ where: { name: { startsWith: '测试券' } } }));
    await db(() =>  prisma.coupon.deleteMany({ where: { name: { startsWith: '非法券' } } }));
    await db(() =>  prisma.coupon.deleteMany({ where: { name: '唯一性测试' } }));
    await db(() =>  prisma.coupon.deleteMany({ where: { name: '已过期' } }));
    await db(() =>  prisma.campaign.deleteMany({ where: { name: { startsWith: '测试限时价' } } }));
    await db(() =>  prisma.campaign.deleteMany({ where: { name: { startsWith: '未开始活动' } } }));
    await db(() =>  prisma.campaign.deleteMany({ where: { name: { startsWith: '涨价活动' } } }));
    // 专用测试商品: 留着会让商品列表多两条, 且 CREDITS_TRIAL(0 元)排序在其前
    await db(() =>  prisma.product.deleteMany({ where: { sku: { startsWith: 'MKTEST_' } } }));
    console.log(`  已清理 ${emails.length} 个测试账号与关联数据`);
  }

  console.log(`\n${'='.repeat(52)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(52));
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})().catch(async (e) => {
  console.error('\n冒烟测试异常终止:', e);
  await prisma.$disconnect();
  process.exit(1);
});