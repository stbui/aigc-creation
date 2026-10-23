/**
 * 一次性迁移: 把 `GenerationTask.provider` 的历史初值 `mock` 改写成 `pending`。
 *
 * 背景
 * ----
 * `provider` 的初始值长期叫 `mock`（建任务时写入，跑完由 processTask 改写成
 * `gateway` / `local`）。本地占位实现删除后，这个名字只剩误导：它表示的其实是
 * 「还没执行」，不是「产出了假图」。2026-10-22 起写入侧改为 `pending`。
 *
 * 读取侧（tasks-admin.service 的 normalizeProvider）已做兼容，所以**不跑这条
 * 脚本也不会出错**；跑它是为了把库里的存量数据也统一，免得后台分组里出现
 * 两个「待执行」。
 *
 * 幂等: 只改 provider='mock' 的行, 重复运行第二次影响 0 行。
 * 库的选择与其它脚本一致 —— 走 scripts/db-url.js, 受 NODE_ENV 控制。
 */
const { PrismaClient } = require('@prisma/client');
const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const { resolveDbUrl, resolveDbPath } = require('./db-url');
const prisma = new PrismaClient({ adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }) });

(async () => {
  console.log(`目标库: ${resolveDbPath()}`);

  const before = await prisma.generationTask.groupBy({
    by: ['provider'],
    _count: { _all: true },
  });
  console.log('迁移前:', JSON.stringify(
    Object.fromEntries(before.map((g) => [g.provider ?? '(null)', g._count._all])),
  ));

  // 先数再改: 打印影响行数, 让人在执行前就知道这次要动多少条
  const affected = await prisma.generationTask.count({ where: { provider: 'mock' } });
  if (affected === 0) {
    console.log('没有 provider=mock 的任务, 无需迁移。');
    await prisma.$disconnect();
    return;
  }
  console.log(`将改写 ${affected} 条 provider 由 mock → pending`);

  const result = await prisma.generationTask.updateMany({
    where: { provider: 'mock' },
    data: { provider: 'pending' },
  });
  console.log(`已改写 ${result.count} 条`);

  const after = await prisma.generationTask.groupBy({
    by: ['provider'],
    _count: { _all: true },
  });
  console.log('迁移后:', JSON.stringify(
    Object.fromEntries(after.map((g) => [g.provider ?? '(null)', g._count._all])),
  ));

  await prisma.$disconnect();
})().catch(async (e) => {
  console.error('迁移失败:', e?.message ?? e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
