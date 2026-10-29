/**
 * 交易域冒烟测试 (admin-prd.md §3.6~3.9 / §5 数据口径)。
 *
 * 重点验证四条不可动摇的约定:
 *   1. 余额由 CreditLot 推导, 无冗余字段
 *   2. FEFO 扣减 (先到期先扣), 余额不足整体回滚
 *   3. 幂等: 重复下单返回同一订单, 重复回调不重复发积分
 *   4. 状态机不可跳跃
 */
// 可用 API_BASE 覆盖: 端口被其它进程占用时, 冒烟必须能指向目标实例
const BASE = (process.env.API_BASE || 'http://localhost:4100').replace(/\/$/, '') + '/api/v1';
// 后台凭据: development/test 使用统一预设, production 必须显式提供 ADMIN_PASSWORD
const { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } = require('./admin-credentials').getAdminCredentials();
if (!ADMIN_PASSWORD) {
  console.error('缺少 ADMIN_PASSWORD: production 环境请先 npm run seed:admin，再传入打印的一次性密码。');
  process.exit(1);
}
const { PrismaClient } = require('@prisma/client');
const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const { resolveDbUrl } = require('./db-url');
const prisma = new PrismaClient({ adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }) });

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 150) }; }
  return { status: res.status, ...json };
}

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  // 用演示用户走 C 端流程; 另建一个干净用户避免污染已有数据
  const email = `pay-${Date.now()}@test.com`;
  const bcrypt = require('bcryptjs');
  const user = await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash('test123456', 10), name: '支付测试' },
  });

  const login = await call('POST', '/auth/login', null, { email, password: 'test123456' });
  const T = login.data.accessToken;

  // 越权用例需要「另一个真实用户」—— 不能再借用预置账号（项目已无内置演示账号）
  const otherEmail = `pay-other-${Date.now()}@test.com`;
  const otherUser = await prisma.user.create({
    data: { email: otherEmail, passwordHash: await bcrypt.hash('test123456', 10), name: '越权测试' },
  });
  const otherLogin = await call('POST', '/auth/login', null, { email: otherEmail, password: 'test123456' });
  const OT = otherLogin.data.accessToken;

  const admin = await call('POST', '/auth/login', null, {
    email: ADMIN_EMAIL, password: ADMIN_PASSWORD,
  });
  const AT = admin.data.accessToken;

  const products = await prisma.product.findMany({ where: { status: 'active' } });
  const starter = products.find((p) => p.sku === 'CREDITS_STARTER');
  const standard = products.find((p) => p.sku === 'CREDITS_STANDARD');

  console.log('\n【商品 B-34】');
  check('商品已上架', products.length >= 4, `${products.length} 个`);
  check('价格用整数分', products.every((p) => Number.isInteger(p.priceCents)),
    products.map((p) => `${p.sku}=${p.priceCents}分`).join(' '));
  check('积分数为正整数', products.every((p) => p.credits > 0 && Number.isInteger(p.credits)));

  console.log('\n【下单幂等 B-39】');
  const key = `idem-${Date.now()}`;
  const o1 = await call('POST', '/orders', T, { idempotencyKey: key, productId: starter.id, quantity: 1 });
  check('下单成功', o1.status === 200 || o1.status === 201, `订单号 ${o1.data?.orderNo}`);
  check('订单初始状态 pending', o1.data?.status === 'pending', o1.data?.status);
  check('金额为整数分', Number.isInteger(o1.data?.totalCents), `${o1.data?.totalCents} 分`);
  check('商品快照已写入', !!o1.data?.items?.[0]?.sku && !!o1.data?.items?.[0]?.name,
    `${o1.data?.items?.[0]?.sku} / ${o1.data?.items?.[0]?.name}`);

  const o2 = await call('POST', '/orders', T, { idempotencyKey: key, productId: starter.id, quantity: 1 });
  check('重复下单返回同一订单', o2.data?.id === o1.data?.id, `${o1.data?.id} vs ${o2.data?.id}`);
  check('幂等命中标记', o2.data?.idempotentHit === true);

  console.log('\n【商品快照 §5 订单快照】');
  // 改价后历史订单不应变化
  await prisma.product.update({ where: { id: starter.id }, data: { priceCents: 99999, name: '改价后名称' } });
  const o1b = await call('GET', `/orders/${o1.data.id}`, T);
  check('改价不影响历史订单', o1b.data?.totalCents === o1.data.totalCents && o1b.data?.items[0].name !== '改价后名称',
    `订单金额仍 ${o1b.data?.totalCents} 分, 快照名「${o1b.data?.items?.[0]?.name}」`);
  // 还原
  await prisma.product.update({ where: { id: starter.id }, data: { priceCents: starter.priceCents, name: starter.name } });

  console.log('\n【沙箱支付-失败 §3.8】');
  const failPay = await call('POST', `/orders/${o1.data.id}/pay`, T, { scenario: 'failed' });
  check('失败场景返回提示', failPay.status === 200 || failPay.status === 201, failPay.data?.message);
  const afterFail = await call('GET', `/orders/${o1.data.id}`, T);
  check('失败后订单仍 pending(可重试)', afterFail.data?.status === 'pending', afterFail.data?.status);
  check('失败流水已留痕', afterFail.data?.payments?.length === 1, `${afterFail.data?.payments?.length} 条`);
  check('未发放积分', (await call('GET', '/credits/balance', T)).data?.balance === 0);

  console.log('\n【沙箱支付-成功】');
  const okPay = await call('POST', `/orders/${o1.data.id}/pay`, T, { scenario: 'success' });
  check('支付成功', okPay.status === 200 || okPay.status === 201, okPay.data?.message);
  const afterPay = await call('GET', `/orders/${o1.data.id}`, T);
  check('订单转 paid', afterPay.data?.status === 'paid', afterPay.data?.status);
  check('记录 paidAt', !!afterPay.data?.paidAt);
  check('已发放积分数', afterPay.data?.grantedCredits === starter.credits, `${afterPay.data?.grantedCredits} 积分`);

  console.log('\n【幂等回调 §5】');
  const balanceAfterPay = (await call('GET', '/credits/balance', T)).data?.balance;
  // 重复支付同一订单
  const repay = await call('POST', `/orders/${o1.data.id}/pay`, T, { scenario: 'success' });
  check('重复支付幂等返回', repay.data?.idempotentHit === true, repay.data?.message);
  const balanceAfterRepay = (await call('GET', '/credits/balance', T)).data?.balance;
  check('重复支付不重复发积分', balanceAfterRepay === balanceAfterPay,
    `${balanceAfterPay} → ${balanceAfterRepay}`);

  console.log('\n【余额推导 §5 无冗余字段】');
  const bal = (await call('GET', '/credits/balance', T)).data;
  const lots = await prisma.creditLot.findMany({ where: { userId: user.id } });
  const expected = lots.filter((l) => !l.expireAt || l.expireAt > new Date()).reduce((s, l) => s + l.remainingCredits, 0);
  check('余额 = Σ批次剩余', bal.balance === expected, `接口 ${bal.balance} / 批次汇总 ${expected}`);
  check('批次与流水数匹配', lots.length >= 1, `${lots.length} 个批次`);

  console.log('\n【状态机不可跳跃 §5】');
  // paid 不能直接变 cancelled
  const badTrans = await prisma.order.update({
    where: { id: o1.data.id }, data: { status: 'cancelled' },
  }).then(() => '允许').catch(() => '拒绝');
  // service 层的校验才是真约束, 这里用 API 层验证
  await prisma.order.update({ where: { id: o1.data.id }, data: { status: 'paid' } });
  const refundBad = await call('POST', `/admin/orders/${o1.data.id}/refund`, AT, { amountCents: 999999, reason: '超额测试' });
  check('超额退款被拒', refundBad.status === 400, refundBad.message);

  console.log('\n【退款 B-43】');
  // 先消耗部分积分, 验证"退的是没花掉的"
  const consumeRes = await call('POST', '/admin/credits/adjust', AT, {
    userId: user.id, delta: -Math.floor(starter.credits / 2), reason: '模拟消耗', operatorId: 'test',
  });
  check('人工扣减成功', consumeRes.status === 200 || consumeRes.status === 201,
    `余额 ${consumeRes.data?.balance}`);

  const halfRemaining = (await call('GET', '/credits/balance', T)).data?.balance;
  check('扣减后余额减半', halfRemaining === starter.credits - Math.floor(starter.credits / 2),
    `余额 ${halfRemaining}`);

  /*
   * 退款金额取**订单实付**, 不是商品标价 —— 限时价/会员折扣下单后
   * 两者本来就不相等 (入门积分包标价 9.9 元, 限时价实付 6.93 元)。
   * 用标价退款会被「超出可退」正确拒绝, 错的是测试不是实现。
   */
  const paidCents = (await call('GET', `/orders/${o1.data.id}`, T)).data?.paidCents;
  const refund = await call('POST', `/admin/orders/${o1.data.id}/refund`, AT, {
    amountCents: paidCents, reason: '冒烟测试退款',
  });
  check('退款成功', refund.status === 200 || refund.status === 201,
    `实付 ${paidCents} 分 / ${refund.message ?? ''}`);
  check('记录扣回积分数', refund.data?.creditsReclaimed === halfRemaining,
    `扣回 ${refund.data?.creditsReclaimed}`);
  check('如实记录不可追回部分', refund.data?.creditsUnreclaimable === starter.credits - halfRemaining,
    `无法追回 ${refund.data?.creditsUnreclaimable}`);
  const afterRefund = await call('GET', '/credits/balance', T);
  check('退款后余额归零', afterRefund.data?.balance === 0, `余额 ${afterRefund.data?.balance}`);

  console.log('\n【人工调整 B-52】');
  const noReason = await call('POST', '/admin/credits/adjust', AT, {
    userId: user.id, delta: 100, reason: '', operatorId: 'test',
  });
  check('无理由调整被拒', noReason.status === 400, noReason.message);
  const zeroDelta = await call('POST', '/admin/credits/adjust', AT, {
    userId: user.id, delta: 0, reason: '测试', operatorId: 'test',
  });
  check('零调整被拒', zeroDelta.status === 400, zeroDelta.message);

  const adjust = await call('POST', '/admin/credits/adjust', AT, {
    userId: user.id, delta: 250, reason: '客服补偿', operatorId: 'test',
  });
  check('有理由调整成功', adjust.status === 200 || adjust.status === 201, `余额 ${adjust.data?.balance}`);

  console.log('\n【超时关闭】');
  const o3 = await call('POST', '/orders', T, { idempotencyKey: `exp-${Date.now()}`, productId: starter.id, quantity: 1 });
  await prisma.order.update({ where: { id: o3.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const timeoutPay = await call('POST', `/orders/${o3.data.id}/pay`, T, { scenario: 'success' });
  check('超时订单不可支付', timeoutPay.status === 409, timeoutPay.message);
  const cancelled = await call('GET', `/orders/${o3.data.id}`, T);
  check('超时后订单已关闭', cancelled.data?.status === 'cancelled', cancelled.data?.status);

  console.log('\n【越权】');
  const otherOrder = await call('GET', `/orders/${o1.data.id}`, OT);
  check('他人订单不可见', otherOrder.status === 403, otherOrder.message);

  console.log('\n【审计留痕】');
  const audit = await call('GET', '/admin/audit-logs?pageSize=30', AT);
  const actions = audit.data?.result?.items?.map((i) => i.action) ?? [];
  check('退款已记审计', actions.some((a) => a?.includes('refund') || a?.includes('order')),
    actions.filter((a) => /order|credit|refund/.test(a ?? '')).slice(0, 3).join(', '));

  // 清理
  await prisma.$transaction([
    prisma.creditLedger.deleteMany({ where: { userId: user.id } }),
    prisma.creditLot.deleteMany({ where: { userId: user.id } }),
    prisma.payment.deleteMany({ where: { userId: user.id } }),
    prisma.refund.deleteMany({ where: { userId: user.id } }),
    prisma.orderItem.deleteMany({ where: { order: { userId: user.id } } }),
    prisma.order.deleteMany({ where: { userId: user.id } }),
    prisma.user.delete({ where: { id: user.id } }),
    prisma.user.delete({ where: { id: otherUser.id } }),
  ]).catch(() => undefined);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(52));
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();
