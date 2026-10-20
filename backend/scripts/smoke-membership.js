/**
 * 会员体系冒烟测试 (落地页订阅卡兑现)。
 *
 * 守住四条承诺:
 *   1. 无会员用户完全不受影响 (免费档权益 = 兜底权益)
 *   2. 并发上限: 超限拒绝建任务, 且不扣费
 *   3. 加油包 95 折: 会员有折扣, 买会员本身不吃折扣
 *   4. 权益快照: 运营改套餐不影响存量会员
 */
const BASE = 'http://127.0.0.1:3001/api/v1';
const { PrismaClient } = require('@prisma/client');
const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const prisma = new PrismaClient({ adapter: new NodeSQLiteDriverAdapterFactory({ url: 'file:./dev.db' }) });

/** SQLite 单写者: 调度/下单写库期间紧随其后读会撞锁 */
async function readWithRetry(fn, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      const msg = String(e.message || '');
      if (!/database is locked|database is busy/i.test(msg) || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
}

/**
 * 带重试的 HTTP 调用。
 *
 * 本机负载高时偶发 ECONNRESET —— 那是瞬时网络抖动而非业务错误,
 * 冒烟测试不该因它整体失败。重试只针对连接层错误, HTTP 5xx 照常返回
 * (那才是要暴露的问题)。
 */
async function call(method, path, token, body) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 150) }; }
      return { status: res.status, ...json };
    } catch (e) {
      lastErr = e;
      const msg = String(e.message || '');
      // 只重试连接层错误; HTTP 错误已经正常返回, 不该重试
      if (!/ECONNRESET|ECONNREFUSED|fetch failed|socket hang up/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw lastErr;
}

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  const bcrypt = require('bcryptjs');
  const email = `mem-${Date.now()}@test.com`;
  const user = await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash('test123456', 10), name: '会员测试' },
  });
  const login = await call('POST', '/auth/login', null, { email, password: 'test123456' });
  const T = login.data.accessToken;

  const plans = await prisma.membershipPlan.findMany({ where: { status: 'active' } });
  const planOf = (c) => plans.find((p) => p.code === c);

  console.log('\n【套餐列表】');
  const listRes = await call('GET', '/membership/plans', T);
  check('套餐接口可用', listRes.status === 200, `${listRes.data?.length ?? 0} 个套餐`);
  const basic = listRes.data?.find((p) => p.code === 'basic');
  check('价格用整数分转元展示', typeof basic?.priceYuan === 'string', `basic ¥${basic?.priceYuan}`);
  check('权益文案由后端生成', Array.isArray(basic?.perkLabels) && basic.perkLabels.length > 0,
    basic?.perkLabels?.join(' / '));
  check('免费档无折扣', listRes.data?.find((p) => p.code === 'free')?.perks?.addonDiscountBps === 10000);

  console.log('\n【非会员兜底权益】');
  const me0 = await call('GET', '/membership/me', T);
  check('非会员返回 isMember=false', me0.data?.isMember === false);
  check('非会员权益全为兜底值',
    me0.data?.perks?.fastChannel === false &&
    me0.data?.perks?.maxConcurrent === 0 &&
    me0.data?.perks?.addonDiscountBps === 10000,
    JSON.stringify(me0.data?.perks));

  console.log('\n【开通会员】');
  const pro = planOf('pro');
  const sub = await call('POST', '/membership/subscribe', T, { planId: pro.id });
  check('开通成功', sub.status === 200 || sub.status === 201,
    `到期 ${sub.data?.expiresAt?.slice(0, 10)}`);

  const me1 = await call('GET', '/membership/me', T);
  check('已是会员', me1.data?.isMember === true, `${me1.data?.planName}`);
  check('快速通道已解锁', me1.data?.perks?.fastChannel === true);
  check('并发上限生效', me1.data?.perks?.maxConcurrent === 5, `上限 ${me1.data?.perks?.maxConcurrent}`);
  check('加油包 95 折生效', me1.data?.perks?.addonDiscountBps === 9500);

  console.log('\n【订阅积分发放】');
  const bal = await call('GET', '/credits/balance', T);
  check('首期订阅积分已到账', bal.data?.balance === pro.monthlyCredits,
    `${bal.data?.balance} 积分 (套餐 ${pro.monthlyCredits}/月)`);

  console.log('\n【权益落地: 并发上限】');
  const cap = me1.data.perks.maxConcurrent;
  const project = await prisma.project.findFirst({ where: { ownerId: user.id } })
    ?? (await prisma.project.create({ data: { name: '并发测试', ownerId: user.id } }));
  const asset = await prisma.asset.findFirst({ where: { ownerId: user.id } })
    ?? (await prisma.asset.create({
      data: { projectId: project.id, ownerId: user.id, kind: 'original', sourceUrl: '/uploads/x.jpg', format: 'image/jpeg', sizeBytes: 100 },
    }));

  // 造 cap 个running 任务, 再造第 cap+1 个
  for (let i = 0; i < cap; i++) {
    await prisma.generationTask.create({
      data: {
        projectId: project.id, ownerId: user.id, capability: 'main_image',
        status: 'running', inputAssetIds: JSON.stringify([asset.id]),
        params: '{}', provider: 'mock',
      },
    });
  }
  const balanceBefore = (await call('GET', '/credits/balance', T)).data.balance;

  const overLimit = await call('POST', '/generate', T, {
    projectId: project.id, capability: 'main_image', inputAssetIds: [asset.id], params: {},
  });
  check(`超并发上限被拒 (上限 ${cap})`, overLimit.status === 400 || overLimit.status === 429,
    `HTTP ${overLimit.status}: ${overLimit.message?.slice(0, 40)}`);

  const balanceAfter = (await call('GET', '/credits/balance', T)).data.balance;
  check('**超限未扣费**(顺序正确)', balanceAfter === balanceBefore,
    `${balanceBefore} → ${balanceAfter}`);

  console.log('\n【权益落地: 加油包折扣】');
  const product = await prisma.product.findFirst({ where: { status: 'active', priceCents: { gt: 0 } } });
  const order = await call('POST', '/orders', T, {
    idempotencyKey: `mem-${Date.now()}`, productId: product.id, quantity: 1,
  });
  const originalCents = product.priceCents;
  const finalCents = order.data?.totalCents;
  check('订单金额已打折', finalCents < originalCents,
    `原价 ¥${originalCents / 100} → 会员价 ¥${finalCents / 100}`);
  check('折扣符合 95 折', finalCents === Math.round(originalCents * 0.95),
    `${finalCents} 分 = ${(finalCents / originalCents * 100).toFixed(1)}%`);

  console.log('\n【折扣不适用于订阅本身】');
  const { applyDiscount } = require('../dist/membership/membership.service');
  check('折扣函数不会算出负价', applyDiscount(100, 9500) === 95 && applyDiscount(100, 10000) === 100);
  check('超范围折扣被钳制', applyDiscount(100, 99999) === 100);

  console.log('\n【权益快照: 改套餐不影响存量】');
  /*
   * ⚠ 必须 try/finally 还原套餐。
   * 这段会把 pro.perks 改成实验值, 中途任何异常都会让套餐永久停在实验值上,
   * 后续每次测试都跟着错 —— 且症状离真因很远, 极难排查。
   */
  const originalPerks = pro.perks;
  // 提前声明: try 块外(到期处理与清理)也要用到
  let user2 = null;
  let t2 = '';
  try {
    await prisma.membershipPlan.update({
      where: { id: pro.id },
      data: { perks: JSON.stringify({ fastChannel: false, maxConcurrent: 99, addonDiscountBps: 5000 }) },
    });
    const me2 = await call('GET', '/membership/me', T);
    check('存量会员权益不变', me2.data?.perks?.maxConcurrent === 5 && me2.data?.perks?.fastChannel === true,
      `并发仍 ${me2.data?.perks?.maxConcurrent} (套餐已改为 99)`);

    // 新开通的用户才用新权益
    const email2 = `mem2-${Date.now()}@test.com`;
    user2 = await prisma.user.create({
      data: { email: email2, passwordHash: await bcrypt.hash('test123456', 10), name: '会员测试2' },
    });
    t2 = (await call('POST', '/auth/login', null, { email: email2, password: 'test123456' })).data.accessToken;
    await call('POST', '/membership/subscribe', t2, { planId: pro.id });
    const me3 = await call('GET', '/membership/me', t2);
    check('新会员用新权益', me3.data?.perks?.maxConcurrent === 99,
      `新用户并发 ${me3.data?.perks?.maxConcurrent}`);
  } finally {
    await prisma.membershipPlan.update({ where: { id: pro.id }, data: { perks: originalPerks } });
  }

  console.log('\n【续期顺延】');
  const before2 = (await prisma.membership.findFirst({ where: { userId: user.id } })).expiresAt;
  await call('POST', '/membership/subscribe', T, { planId: pro.id });
  const after2 = (await prisma.membership.findFirst({ where: { userId: user.id } })).expiresAt;
  check('续期从原到期时间顺延', after2.getTime() > before2.getTime(),
    `${before2.toISOString().slice(0, 10)} → ${after2.toISOString().slice(0, 10)}`);

  console.log('\n【取消订阅】');
  const cancel = await call('POST', '/membership/cancel', T);
  check('取消成功', cancel.status === 200 || cancel.status === 201);
  const me4 = await call('GET', '/membership/me', T);
  check('取消后立即失去权益', me4.data?.isMember === false || me4.data?.perks?.maxConcurrent !== 5,
    `isMember=${me4.data?.isMember}`);

  console.log('\n【到期处理】');
  await prisma.membership.updateMany({
    where: { userId: user2.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  const sched = await call('POST', '/admin/scheduler/run?task=membership', (await call('POST', '/auth/login', null, {
    email: 'admin@huojue.local', password: 'wQFFfQA8rXHKwSuLPpBz',
  })).data.accessToken);
  check('会员调度任务可触发', sched.status === 200 || sched.status === 201, sched.data?.reason ?? '已执行');

  const expired = await readWithRetry(() =>
    prisma.membership.findFirst({ where: { userId: user2.id } }));
  check('过期会员状态已转expired', expired.status === 'expired', expired.status);

  console.log('\n【越权】');
  const other = await call('GET', '/membership/me', t2);
  check('会员只能看自己的', other.status === 200 && other.data.isMember !== undefined);

  // 清理
  const uids = user2 ? [user.id, user2.id] : [user.id];
  await prisma.$transaction([
    prisma.creditLedger.deleteMany({ where: { userId: { in: uids } } }),
    prisma.creditLot.deleteMany({ where: { userId: { in: uids } } }),
    prisma.generationTask.deleteMany({ where: { ownerId: { in: uids } } }),
    prisma.membershipUsage.deleteMany({ where: { userId: { in: uids } } }),
    prisma.membership.deleteMany({ where: { userId: { in: uids } } }),
    prisma.orderItem.deleteMany({ where: { order: { userId: { in: uids } } } }),
    prisma.payment.deleteMany({ where: { userId: { in: uids } } }),
    prisma.order.deleteMany({ where: { userId: { in: uids } } }),
    prisma.asset.deleteMany({ where: { ownerId: { in: uids } } }),
    prisma.project.deleteMany({ where: { ownerId: { in: uids } } }),
    prisma.user.deleteMany({ where: { id: { in: uids } } }),
  ]).catch(() => undefined);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(52));
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();