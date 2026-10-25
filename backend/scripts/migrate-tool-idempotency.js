/**
 * 非破坏性迁移: 为修图工具的幂等提交补齐字段与索引。
 *
 * 新增字段均为 nullable，已有行不需要回填；索引使用 IF NOT EXISTS，
 * 脚本可重复执行。刻意不使用 `prisma db push --accept-data-loss` ——
 * 生产库的已有任务、积分流水和额度批次不能被重建表顺带清掉。
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

  if (!tableExists('GenerationTask') || !tableExists('CreditLedger')) {
    throw new Error('目标库缺少 GenerationTask/CreditLedger，请先运行 npm run prisma:push');
  }

  db.exec('BEGIN IMMEDIATE');
  inTransaction = true;
  addColumnIfMissing('GenerationTask', 'idempotencyKey', 'TEXT');
  addColumnIfMissing('CreditLedger', 'idempotencyKey', 'TEXT');

  // 唯一索引是并发幂等的最终裁决：服务层的先查后建只能减少冲突，
  // 不能替代数据库约束。SQLite 允许任意多个 NULL，存量任务不受影响。
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS "GenerationTask_ownerId_idempotencyKey_key" ' +
      'ON "GenerationTask" ("ownerId", "idempotencyKey")',
  );
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS "CreditLedger_idempotencyKey_key" ' +
      'ON "CreditLedger" ("idempotencyKey")',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS "CreditLedger_taskId_idx" ON "CreditLedger" ("taskId")',
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
