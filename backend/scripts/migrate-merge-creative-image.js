/**
 * 一次性数据迁移：把已合并的「创意生图」(creative_image) 归并到「自由创作」(free_create)。
 *
 * 2026-11-14 起前端只保留 /free-creation 一个路由、后端只注册 free_create 一个能力。
 * 存量库由 `prisma db push` 建表，没有 Prisma Migrate 历史，故沿用仓库既有的
 * 一次性数据迁移方式：node:sqlite + NODE_ENV/scripts/db-url.js，事务内执行，
 * 可重复运行（第二次跑不到待归并行，各自报 0）。
 *
 * 覆盖 schema.prisma 中所有存 C 端能力 id 的列：
 *   GenerationTask.capability / Asset.capability / RouteAttempt.capabilityId /
 *   BillingOrder.capability / ApiCallLog.capability / CapabilityControl.capabilityId /
 *   CapabilityPricing.capabilityId / CapabilityModelBinding.capabilityId /
 *   Campaign.payload（limited_free 的 capabilityIds JSON）
 *
 * 有唯一约束的表先探测目标行是否已存在：已存在则删掉源行（保留目标行既有的
 * 运营配置 / 定价 / 绑定），否则原地改 id —— 避免 UPDATE 撞主键或唯一索引
 * 导致整笔事务回滚。
 *
 * ChannelModel.capability 是供应侧模态（image/text/video/audio），不在本次范围内。
 */
const { DatabaseSync } = require('node:sqlite');
const { resolveDbPath } = require('./db-url');

const FROM = 'creative_image';
const TO = 'free_create';
const dbPath = resolveDbPath();
const db = new DatabaseSync(dbPath);
let inTransaction = false;

function tableExists(name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function columnExists(table, column) {
  return db
    .prepare(`PRAGMA table_info("${table}")`)
    .all()
    .some((row) => row.name === column);
}

function skipIfMissing(table, column) {
  if (tableExists(table) && columnExists(table, column)) return false;
  console.log(`跳过 ${table}.${column}（表或列不存在）`);
  return true;
}

/** 纯值列：直接改写 */
function rewrite(table, column) {
  if (skipIfMissing(table, column)) return;
  const result = db
    .prepare(`UPDATE "${table}" SET "${column}" = ? WHERE "${column}" = ?`)
    .run(TO, FROM);
  console.log(`${table}.${column}: 改写 ${Number(result.changes)} 行`);
}

/** capabilityId 为主键的能力配置表 */
function mergeById(table) {
  if (skipIfMissing(table, 'capabilityId')) return;
  const source = db
    .prepare(`SELECT "capabilityId" FROM "${table}" WHERE "capabilityId" = ?`)
    .all(FROM);
  if (source.length === 0) {
    console.log(`${table}: 无待归并行`);
    return;
  }
  const target = db
    .prepare(`SELECT "capabilityId" FROM "${table}" WHERE "capabilityId" = ?`)
    .get(TO);
  if (target) {
    const result = db.prepare(`DELETE FROM "${table}" WHERE "capabilityId" = ?`).run(FROM);
    console.log(`${table}: 目标已存在，删除源行 ${Number(result.changes)} 行`);
  } else {
    const result = db
      .prepare(`UPDATE "${table}" SET "capabilityId" = ? WHERE "capabilityId" = ?`)
      .run(TO, FROM);
    console.log(`${table}: 改写 id ${Number(result.changes)} 行`);
  }
}

/** 唯一键 [capabilityId, channelModelId]：逐行去重后归并 */
function mergeBindings() {
  const table = 'CapabilityModelBinding';
  if (skipIfMissing(table, 'capabilityId')) return;
  const rows = db
    .prepare(`SELECT "id", "channelModelId" FROM "${table}" WHERE "capabilityId" = ?`)
    .all(FROM);
  const findTarget = db.prepare(
    `SELECT "id" FROM "${table}" WHERE "capabilityId" = ? AND "channelModelId" = ?`,
  );
  const rename = db.prepare(`UPDATE "${table}" SET "capabilityId" = ? WHERE "id" = ?`);
  const drop = db.prepare(`DELETE FROM "${table}" WHERE "id" = ?`);
  let renamed = 0;
  let dropped = 0;
  for (const row of rows) {
    if (findTarget.get(TO, row.channelModelId)) {
      drop.run(row.id);
      dropped += 1;
    } else {
      rename.run(TO, row.id);
      renamed += 1;
    }
  }
  console.log(`${table}: 改写 ${renamed} 行，去重删除 ${dropped} 行`);
}

/** 限时免费活动的 capabilityIds 存在 payload JSON 里，按值精确替换 */
function rewriteCampaignPayload() {
  if (skipIfMissing('Campaign', 'payload')) return;
  const rows = db
    .prepare('SELECT "id", "payload" FROM "Campaign" WHERE "payload" LIKE ?')
    .all(`%${FROM}%`);
  const update = db.prepare('UPDATE "Campaign" SET "payload" = ? WHERE "id" = ?');
  let changed = 0;
  for (const row of rows) {
    const next = row.payload.replaceAll(`"${FROM}"`, `"${TO}"`);
    if (next !== row.payload) {
      update.run(next, row.id);
      changed += 1;
    }
  }
  console.log(`Campaign.payload: 改写 ${changed} 行`);
}

try {
  console.log(`目标库: ${dbPath}`);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('BEGIN IMMEDIATE');
  inTransaction = true;

  rewrite('GenerationTask', 'capability');
  rewrite('Asset', 'capability');
  rewrite('RouteAttempt', 'capabilityId');
  rewrite('BillingOrder', 'capability');
  rewrite('ApiCallLog', 'capability');
  mergeById('CapabilityControl');
  mergeById('CapabilityPricing');
  mergeBindings();
  rewriteCampaignPayload();

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
