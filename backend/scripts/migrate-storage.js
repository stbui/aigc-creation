/**
 * 一次性迁移: 为存量 Asset 补齐 storageBackend / storageKey。
 *
 * 存量数据的 sourceUrl 形如 /uploads/original/xxx.jpg 或 /uploads/generated/xxx.jpg,
 * 剥掉 /uploads/ 前缀即storageKey。迁移后老素材才能被新抽象层正确读取/删除。
 *
 * 幂等: 已填好 storageKey 的记录会跳过, 可重复运行。
 */
const { PrismaClient } = require('@prisma/client');
const { NodeSQLiteDriverAdapterFactory } = require('../dist/prisma/node-sqlite-adapter');
const { resolveDbUrl } = require('./db-url');
const prisma = new PrismaClient({ adapter: new NodeSQLiteDriverAdapterFactory({ url: resolveDbUrl() }) });

(async () => {
  const all = await prisma.asset.findMany({
    select: { id: true, sourceUrl: true, storageKey: true, storageBackend: true },
  });

  let migrated = 0;
  let skipped = 0;
  const unmatched = [];

  for (const a of all) {
    if (a.storageKey) { skipped += 1; continue; }

    const m = a.sourceUrl.match(/^\/uploads\/(.+)$/);
    if (!m) {
      // 非 uploads 来源(如生成产出图的相对路径), 无法推断 key
      unmatched.push(a.sourceUrl);
      continue;
    }
    await prisma.asset.update({
      where: { id: a.id },
      data: { storageKey: m[1], storageBackend: 'local' },
    });
    migrated += 1;
  }

  console.log(`总素材 ${all.length}: 迁移 ${migrated}, 已跳过 ${skipped}`);
  if (unmatched.length) {
    console.log(`⚠ ${unmatched.length} 条 sourceUrl 不符合 /uploads/* 格式, 需人工处理:`);
    unmatched.slice(0, 5).forEach((u) => console.log('   ', u));
  }
  await prisma.$disconnect();
})();
