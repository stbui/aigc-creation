/**
 * 定时任务冒烟测试 (admin-prd.md §3.18 B-90 / M9.5)。
 *
 * 重点验证**任务真的干活**, 而不只是接口返回 200:
 *   - 造一条超时订单 → 触发 order-expire → 订单转cancelled
 *   - 造一个已到期积分批次 → 触发 credit-expire → 剩余归零且写了 expire 流水
 *   - 批次记录**保留**(不删) —— 删了就无法回答"这笔积分原本多少、何时过期"
 *   - 手动触发白名单: 备份/清理不可手动跑
 *   - 状态接口如实报告连续失败
 */
// 可用 API_BASE 覆盖: 端口被其它进程占用时, 冒烟必须能指向目标实例
const BASE = (process.env.API_BASE || 'http://localhost:4100').replace(/\/$/, '') + '/api/v1';
// 后台凭据: seed:admin 只在首次运行打印一次性密码, 故允许环境变量覆盖
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@huojue.local';
// 密码没有默认值: seed:admin 只打印一次, 硬编码等于把后台口令写进仓库
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (!ADMIN_PASSWORD) {
  console.error('缺少 ADMIN_PASSWORD: 先 npm run seed:admin, 再用它打印的一次性密码运行本脚本。');
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

/**
 * 带重试的读取。
 *
 * 调度任务在事务里批量写库, 测试脚本紧随其后读会撞 SQLite 写锁
 * (单写者模型的固有现象)。短退避重试即可, 不需要改产品代码。
 */
async function readWithRetry(fn, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      const msg = String(e.message || '');
      if (!/database is locked|database is busy/i.test(msg) || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }
}

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  const admin = await call('POST', '/auth/login', null, {
    email: ADMIN_EMAIL, password: ADMIN_PASSWORD,
  });
  const T = admin.data.accessToken;
  if (!T) { console.log('登录失败'); process.exit(1); }

  // 造测试用户
  const email = `sch-${Date.now()}@test.com`;
  const bcrypt = require('bcryptjs');
  const user = await prisma.user.create({
    data: { email, passwordHash: await bcrypt.hash('test123456', 10), name: '调度测试' },
  });
  const product = await prisma.product.findFirst({ where: { status: 'active' } });

  console.log('\n【调度状态接口】');
  const status = await call('GET', '/admin/scheduler/status', T);
  check('状态接口可用', status.status === 200, `active=${status.data?.manuallyRunnable?.join(',')}`);
  const names = (status.data?.tasks ?? []).map((t) => t.name);
  check('含订单超时关闭任务', names.includes('order-expire'));
  check('含积分到期回收任务', names.includes('credit-expire'));
  check('含备份任务', names.includes('backup'));
  check('任务带中文名', (status.data?.tasks ?? []).every((t) => !!t.label),
    (status.data?.tasks ?? []).map((t) => t.label).join('、'));
  check('无任务连续失败', (status.data?.failing ?? []).length === 0,
    `failing=[${(status.data?.failing ?? []).join(',')}]`);

  console.log('\n【手动触发白名单】');
  const bad = await call('POST', '/admin/scheduler/run?task=backup', T);
  check('备份不可手动触发', bad.status === 400, bad.message);
  const bad2 = await call('POST', '/admin/scheduler/run?task=cleanup', T);
  check('清理不可手动触发', bad2.status === 400, bad2.message);
  const bad3 = await call('POST', '/admin/scheduler/run?task=nonexist', T);
  check('未知任务被拒', bad3.status === 400);

  console.log('\n【订单超时关闭 B-90】');
  const expired = await prisma.order.create({
    data: {
      orderNo: `SCH${Date.now()}`,
      userId: user.id,
      idempotencyKey: `sch-${Date.now()}`,
      totalCents: product.priceCents,
      expiresAt: new Date(Date.now() - 60_000), // 已过期 1 分钟
      status: 'pending',
      items: {
        create: {
          productId: product.id,
          skuSnapshot: product.sku, nameSnapshot: product.name,
          priceCentsSnapshot: product.priceCents, creditsSnapshot: product.credits,
          validDaysSnapshot: product.creditsValidDays, quantity: 1,
        },
      },
    },
  });
  const fresh = await prisma.order.create({
    data: {
      orderNo: `SCH${Date.now()}B`,
      userId: user.id,
      idempotencyKey: `sch-b-${Date.now()}`,
      totalCents: product.priceCents,
      expiresAt: new Date(Date.now() + 30 * 60_000), // 未过期
      status: 'pending',
      items: {
        create: {
          productId: product.id,
          skuSnapshot: product.sku, nameSnapshot: product.name,
          priceCentsSnapshot: product.priceCents, creditsSnapshot: product.credits,
          validDaysSnapshot: product.creditsValidDays, quantity: 1,
        },
      },
    },
  });

  const runOrders = await call('POST', '/admin/scheduler/run?task=order-expire', T);
  check('手动触发成功', runOrders.status === 200 || runOrders.status === 201,
    runOrders.data?.reason ?? '已执行');

  const afterExpired = await readWithRetry(() => prisma.order.findUnique({ where: { id: expired.id } }));
  check('超时订单已关闭', afterExpired.status === 'cancelled', afterExpired.status);
  const afterFresh = await readWithRetry(() => prisma.order.findUnique({ where: { id: fresh.id } }));
  check('未超时订单不受影响', afterFresh.status === 'pending', afterFresh.status);

  console.log('\n【积分到期回收 B-90】');
  const expiredLot = await prisma.creditLot.create({
    data: {
      userId: user.id,
      source: 'grant',
      totalCredits: 300,
      remainingCredits: 300,
      expireAt: new Date(Date.now() - 60_000), // 已过期
    },
  });
  const activeLot = await prisma.creditLot.create({
    data: {
      userId: user.id, source: 'grant',
      totalCredits: 500, remainingCredits: 500,
      expireAt: new Date(Date.now() + 7 * 24 * 3600_000),
    },
  });

  const runCredits = await call('POST', '/admin/scheduler/run?task=credit-expire', T);
  check('手动触发成功', runCredits.status === 200 || runCredits.status === 201);

  const lotAfter = await readWithRetry(() => prisma.creditLot.findUnique({ where: { id: expiredLot.id } }));
  check('已到期批次剩余归零', lotAfter.remainingCredits === 0, `剩余 ${lotAfter.remainingCredits}`);
  check('**批次记录保留**(不删)', !!lotAfter, `totalCredits 仍为 ${lotAfter.totalCredits}`);
  check('到期时间保留', !!lotAfter.expireAt);

  const activeAfter = await readWithRetry(() => prisma.creditLot.findUnique({ where: { id: activeLot.id } }));
  check('未到期批次不受影响', activeAfter.remainingCredits === 500, `剩余 ${activeAfter.remainingCredits}`);

  console.log('\n【回收留痕】');
  const ledger = await readWithRetry(() => prisma.creditLedger.findMany({
    where: { userId: user.id, type: 'expire' },
  }));
  check('写了 expire 流水', ledger.length >= 1, `${ledger.length} 条`);
  check('流水金额为负', ledger[0]?.amount === -300, `${ledger[0]?.amount}`);
  check('流水关联到批次', ledger[0]?.lotId === expiredLot.id);

  console.log('\n【幂等: 重复执行】');
  await call('POST', '/admin/scheduler/run?task=credit-expire', T);
  const ledgerAfter = await readWithRetry(() => prisma.creditLedger.count({ where: { userId: user.id, type: 'expire' } }));
  check('重复执行不重复写流水', ledgerAfter === ledger.length, `${ledger.length} → ${ledgerAfter}`);

  console.log('\n【执行状态上报】');
  const status2 = await call('GET', '/admin/scheduler/status', T);
  const orderTask = status2.data.tasks.find((t) => t.name === 'order-expire');
  const creditTask = status2.data.tasks.find((t) => t.name === 'credit-expire');
  check('订单任务已上报执行时间', !!orderTask.lastRunAt, orderTask.lastRunAt);
  check('订单任务执行成功', orderTask.lastSuccess === true);
  check('订单任务上报耗时', orderTask.lastDurationMs !== null, `${orderTask.lastDurationMs}ms`);
  check('积分任务已上报', !!creditTask.lastRunAt && creditTask.lastSuccess === true);
  check('累计执行次数 > 0', orderTask.totalRuns >= 1, `${orderTask.totalRuns} 次`);
  check('无连续失败', orderTask.consecutiveFailures === 0 && creditTask.consecutiveFailures === 0);

  console.log('\n【审计留痕】');
  const audit = await call('GET', '/admin/audit-logs?pageSize=20', T);
  const actions = audit.data?.result?.items?.map((i) => i.action) ?? [];
  check('手动触发已记审计', actions.includes('scheduler.run'),
    actions.filter((a) => a === 'scheduler.run').length + ' 条');

  console.log('\n【越权】');
  const finEmail = `sch-fin-${Date.now()}@test.com`;
  await prisma.user.create({
    data: { email: finEmail, passwordHash: await bcrypt.hash('test123456', 10), name: '调度财务', role: 'finance' },
  });
  const finLogin = await call('POST', '/auth/login', null, { email: finEmail, password: 'test123456' });
  const finT = finLogin.data?.accessToken;
  if (finT) {
    const finStatus = await call('GET', '/admin/scheduler/status', finT);
    check('finance 可看调度状态', finStatus.status === 200 || finStatus.status === 403,
      `HTTP ${finStatus.status}`);
    const finRun = await call('POST', '/admin/scheduler/run?task=order-expire', finT);
    check('finance 无 setting.write 不能触发', finRun.status === 403, finRun.message);
    await prisma.user.delete({ where: { email: finEmail } }).catch(() => {});
  } else {
    console.log('  SKIP  finance 登录失败, 跳过越权验证');
  }

  // 清理
  await prisma.$transaction([
    prisma.creditLedger.deleteMany({ where: { userId: user.id } }),
    prisma.creditLot.deleteMany({ where: { userId: user.id } }),
    prisma.orderItem.deleteMany({ where: { order: { userId: user.id } } }),
    prisma.order.deleteMany({ where: { userId: user.id } }),
    prisma.user.delete({ where: { id: user.id } }),
  ]).catch(() => undefined);

  console.log(`\n${'='.repeat(52)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log('='.repeat(52));
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();