/**
 * 非破坏性迁移：补齐项目软删除与任务重试幂等所需字段和索引。
 *
 * 存量库由 `prisma db push` 建表，没有 Prisma Migrate 历史；直接补一条
 * migration 只能升级部分库，空库或未 baseline 的库反而会失败。因此沿用
 * 仓库已有的“一次性数据迁移”方式，使用 IF NOT EXISTS / 列检查保证脚本
 * 可重复执行，且不重建表、不触碰已有业务数据。
 *
 * 目标库与其它脚本一致，由 NODE_ENV + scripts/db-url.js 决定。
 */
const { DatabaseSync } = require('node:sqlite');
const { resolveDbPath } = require('./db-url');

const dbPath = resolveDbPath();
const db = new DatabaseSync(dbPath);
let inTransaction = false;

function tableExists(name) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name),
  );
}

function columnsOf(table) {
  return new Set(db.prepare(`PRAGMA table_info("${table}")`).all().map((row) => row.name));
}

function addColumnIfMissing(table, column, definition) {
  const columns = columnsOf(table);
  if (columns.has(column)) {
    console.log(`跳过 ${table}.${column}（已存在）`);
    return false;
  }
  db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
  console.log(`已新增 ${table}.${column}`);
  return true;
}

try {
  console.log(`目标库: ${dbPath}`);
  db.exec('PRAGMA busy_timeout = 5000');

  if (!tableExists('Project') || !tableExists('GenerationTask')) {
    throw new Error('目标库缺少 Project/GenerationTask，请先运行 npm run prisma:push');
  }

  db.exec('BEGIN IMMEDIATE');
  inTransaction = true;

  // 两个字段都允许 NULL：存量项目默认未删除，存量任务没有重试幂等键。
  addColumnIfMissing('Project', 'deletedAt', 'DATETIME');
  addColumnIfMissing('GenerationTask', 'retryKey', 'TEXT');

  db.exec(
    'CREATE INDEX IF NOT EXISTS "Project_ownerId_deletedAt_idx" ' +
      'ON "Project" ("ownerId", "deletedAt")',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS "Project_deletedAt_idx" ON "Project" ("deletedAt")',
  );
  // 唯一索引是并发重试的最终裁决。SQLite 允许多个 NULL，因此存量任务
  // 不需要回填 retryKey；服务层同时兼容旧 retriedFromId 记录。
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS "GenerationTask_retryKey_key" ' +
      'ON "GenerationTask" ("retryKey")',
  );

  db.exec('COMMIT');
  inTransaction = false;
  console.log('迁移完成');
} catch (error) {
  if (inTransaction) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 保留原始错误；回滚失败通常意味着连接已经不可用
    }
  }
  console.error('迁移失败:', error?.message ?? error);
  process.exitCode = 1;
} finally {
  db.close();
}
