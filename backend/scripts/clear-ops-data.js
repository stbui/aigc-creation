/**
 * 运营数据清除工具（开发/测试环境）。
 *
 *   node scripts/clear-ops-data.js --dry-run                # 只看影响面，不删
 *   node scripts/clear-ops-data.js --yes                    # 全清（任务+素材+审计+uploads）
 *   node scripts/clear-ops-data.js --yes --only audit      # 只清操作审计
 *   node scripts/clear-ops-data.js --yes --only tasks      # 只清任务监控
 *   node scripts/clear-ops-data.js --yes --only assets     # 只清素材管理
 *   node scripts/clear-ops-data.js --yes --keep-files      # 删库记录但保留磁盘图片
 *   node scripts/clear-ops-data.js --yes --backup          # 删除前先复制一份 .db
 *   node scripts/clear-ops-data.js --yes --audit-log        # 往 CleanupLog 写留痕
 *
 * ── 为什么默认 dry-run ─────────────────────────────────────────────
 * 删除不可逆。首版脚本硬编码执行、范围写死，跑第二次才发现数据早被
 * 别的进程清空 —— 那次的"已删除 0 行"完全掩盖了真实执行者。
 * 故：**不带 --yes 一律只报告不动手**，且报告里必须打印将要删的
 * 具体条数与库路径，让人有机会发现"库里其实不是这些数据"。
 *
 * ── 为什么库路径要走 db-url.js ─────────────────────────────────────
 * 本仓三环境各有一份库：development=dev.db / test=test.db /
 * production=prod.db。硬编码 'dev.db' 会在 NODE_ENV=test 时
 * **误删开发库** —— 而 test 档恰恰是最常被拿来做破坏性验证的。
 * 统一用 resolveDbPath()，与后端服务和其余二十来个脚本同源。
 */
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const { resolveDbPath, loadEnvOnce } = require('./db-url');

loadEnvOnce();

// ── 参数解析 ──────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
/**
 * 同时支持 `--only=audit` 与 `--only audit` 两种写法。
 *
 * ⚠️ 首版只认 `=` 形式，而帮助文本里两种写法混用 → 传 `--only bogus`
 * 时值被静默回落成 'all'，**非法参数按"全清"执行**。
 * 这类"校验失败却走默认危险分支"必须硬失败，故下面显式取两种形态。
 */
const val = (f, dflt) => {
  const eq = argv.find((a) => a.startsWith(`--${f}=`));
  if (eq) return eq.slice(f.length + 3);
  const i = argv.indexOf(`--${f}`);
  if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1];
  return dflt;
};

const DRY_RUN = !has('--yes');
const KEEP_FILES = has('--keep-files');
const DO_BACKUP = has('--backup');
const WRITE_AUDIT = has('--audit-log');
const ONLY = val('only', 'all').toLowerCase();

/** 清空顺序即依赖顺序：GenerationTask.outputAssetId → Asset 是 FK，必须先删任务 */
const GROUPS = {
  tasks: ['GenerationTask'],
  assets: ['Asset'],
  audit: ['AdminAuditLog'],
};
// 用 hasOwnProperty 而非 GROUPS[ONLY] 判存在：否则 --only constructor
// 会命中 Object 原型上的属性，拿到非数组值并绕过校验。
const TARGET_TABLES =
  ONLY === 'all'
    ? ['GenerationTask', 'Asset', 'AdminAuditLog']
    : Object.prototype.hasOwnProperty.call(GROUPS, ONLY)
      ? GROUPS[ONLY]
      : null;

if (!TARGET_TABLES || !Array.isArray(TARGET_TABLES)) {
  console.error(`✗ --only 取值非法: ${ONLY}（可选 all | tasks | assets | audit）`);
  process.exit(1);
}

// 防御整串形态（如 zsh 下未加引号的 $c 会被当作单个 argv 传入
// "--only audit"）：它既不是合法值也不是 all，静默回落成"全清"最危险。
if (argv.some((a) => /^--[a-z-]+[ =].+$/.test(a))) {
  console.error(
    `✗ 检测到整串参数形态: ${JSON.stringify(argv.filter((a) => /^--[a-z-]+[ =].+$/.test(a)))}\n` +
      '  本脚本的带值参数必须写成 `--only audit`（两个独立参数）或 `--only=audit`。\n' +
      '  已中止，未做任何删除。',
  );
  process.exit(1);
}

// ── 解析库与上传目录（与环境档位一致，不硬编码） ──────────────────
const DB_PATH = resolveDbPath();
const UPLOADS = path.resolve(
  __dirname,
  '..',
  process.env.UPLOAD_DIR && process.env.UPLOAD_DIR.trim()
    ? process.env.UPLOAD_DIR.trim()
    : 'uploads',
);
const ENV = process.env.NODE_ENV || 'development';

if (!fs.existsSync(DB_PATH)) {
  console.error(`✗ 库文件不存在: ${DB_PATH}`);
  process.exit(1);
}

console.log('═'.repeat(64));
console.log(`环境 NODE_ENV=${ENV}`);
console.log(`库         ${DB_PATH}`);
console.log(`上传目录   ${UPLOADS}`);
console.log(`清理范围   ${ONLY} → ${TARGET_TABLES.join(', ')}`);
console.log(`磁盘文件   ${KEEP_FILES ? '保留' : '一并清空'}`);
console.log(`留痕CleanupLog ${WRITE_AUDIT ? '写入' : '不写'}`);
console.log('═'.repeat(64));

if (ENV === 'production') {
  console.error('\n✗ 拒绝在 production 执行。请改用 NODE_ENV=development/test。');
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON');
const q = (sql) => db.prepare(sql).all();
const count = (t) => db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n;

/** node:sqlite 的 Statement 不能直接喂 console.table，且空结果集会打印一列空Values */
function table(title, rows) {
  console.log(`\n【${title}】`);
  if (!rows.length) console.log('  (无数据)');
  else console.table(rows);
}

// ── 影响面报告 ────────────────────────────────────────────────────
const BEFORE = {};
for (const t of TARGET_TABLES) BEFORE[t] = count(t);
console.log('\n【当前条数】');
console.table(BEFORE);

if (TARGET_TABLES.includes('Asset')) {
  table(
    '素材构成',
    q(`SELECT kind, status, storageBackend, COUNT(*) AS n,
              ROUND(SUM(sizeBytes)/1048576.0, 2) AS mb
         FROM Asset GROUP BY kind, status, storageBackend`),
  );
}
if (TARGET_TABLES.includes('AdminAuditLog')) {
  table(
    '审计动作 top10',
    q(`SELECT action, COUNT(*) AS n FROM AdminAuditLog
       GROUP BY action ORDER BY n DESC LIMIT 10`),
  );
}
if (TARGET_TABLES.includes('GenerationTask')) {
  table(
    '任务状态',
    q(`SELECT status, COUNT(*) AS n FROM GenerationTask GROUP BY status`),
  );
}

// 外键清单：确认没有别的表会被牵连
table(
  '外键清单（parent ← child，on_delete）',
  db
    .prepare(
      `SELECT "table" AS parent, "from" AS child, on_delete
         FROM pragma_foreign_key_list('GenerationTask')
        UNION ALL
       SELECT "table", "from", on_delete
         FROM pragma_foreign_key_list('Asset')
        UNION ALL
       SELECT "table", "from", on_delete
         FROM pragma_foreign_key_list('AdminAuditLog')`,
    )
    .all(),
);

// uploads 磁盘占用
let disk = { files: 0, bytes: 0 };
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else {
      disk.files += 1;
      disk.bytes += fs.statSync(full).size;
    }
  }
})(UPLOADS);
console.log(
  `\n【磁盘】${disk.files} 个文件 / ${(disk.bytes / 1048576).toFixed(2)} MB${KEEP_FILES ? '（将保留）' : '（将被删除）'}`,
);

if (DRY_RUN) {
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log('这是 DRY-RUN，未做任何删除。确认无误后加 --yes 执行。');
  console.log('────────────────────────────────────────────────────────────────');
  db.close();
  process.exit(0);
}

// ── 备份（可选） ──────────────────────────────────────────────────
if (DO_BACKUP) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const bak = `${DB_PATH}.bak-${stamp}`;
  fs.copyFileSync(DB_PATH, bak);
  console.log(`\n已备份: ${bak}`);
}

// ── 执行 ──────────────────────────────────────────────────────────
db.exec('BEGIN');
const deleted = {};
try {
  for (const t of TARGET_TABLES) {
    deleted[t] = db.prepare(`DELETE FROM "${t}"`).run().changes;
  }
  if (WRITE_AUDIT) {
    db
      .prepare(
        `INSERT INTO CleanupLog (id, target, deletedCount, retentionDays, trigger, skippedCount, detail, success, createdAt)
         VALUES (?, ?, ?, ?, 'manual', 0, ?, 1, ?)`,
      )
      .run(
        `manual_${Date.now()}`,
        TARGET_TABLES.join('+'),
        TARGET_TABLES.reduce((s, t) => s + deleted[t], 0),
        0,
        JSON.stringify({ env: ENV, perTable: deleted }),
        new Date().toISOString(),
      );
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('\n✗ 事务失败已整体回滚:', e.message);
  db.close();
  process.exit(1);
}

console.log('\n【已删除】', deleted);

// ── 结果核验：目标表必须为 0，且不留悬空引用 ───────────────────────
const AFTER = {};
for (const t of TARGET_TABLES) AFTER[t] = count(t);
console.log('【删除后】', AFTER);

const bad = Object.entries(AFTER).filter(([, n]) => n !== 0);
if (bad.length) {
  console.error('✗ 仍有残留:', bad);
  db.close();
  process.exit(1);
}

const dangling = db
  .prepare(
    `SELECT COUNT(*) AS n FROM GenerationTask t
       LEFT JOIN Asset a ON a.id = t.outputAssetId
      WHERE t.outputAssetId IS NOT NULL AND a.id IS NULL`,
  )
  .get().n;
console.log(`\n【悬空 outputAssetId】${dangling}`);

// ── 物理文件 ──────────────────────────────────────────────────────
if (!KEEP_FILES) {
  let files = 0;
  let bytes = 0;
  (function rm(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        rm(full);
        fs.rmdirSync(full);
      } else {
        bytes += fs.statSync(full).size;
        fs.unlinkSync(full);
        files += 1;
      }
    }
  })(UPLOADS);
  console.log(`【磁盘】已删除 ${files} 个文件 / ${(bytes / 1048576).toFixed(2)} MB`);
} else {
  console.log('【磁盘】按 --keep-files 保留');
}

db.close();
console.log('\n✓ 完成');