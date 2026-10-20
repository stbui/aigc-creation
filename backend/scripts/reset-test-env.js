/**
 * 重置测试环境：删库 + 删上传目录 + 删备份目录，然后重建表与种子。
 *
 * ⚠ 安全门禁：只允许删**测试环境**的产物。
 *   脚本读 .env.test 解析出UPLOAD_DIR / BACKUP_DIR / DATABASE_URL，
 *   逐一校验「路径里必须同时含 test 字样」，否则拒绝执行。
 *   没有这道门禁时，一个手滑的 NODE_ENV=production 就会把生产库连同
 *   全部上传图删掉 —— 而 rm 是不可逆的。
 *
 * 用法: npm run db:reset:test
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveDbUrl, BACKEND_ROOT } = require('./db-url');

const TARGET_ENV = 'test';

/** 路径必须含test 才认为是测试环境产物 */
function assertTestTarget(label, p) {
  const abs = path.resolve(p);
  const rel = path.relative(BACKEND_ROOT, abs);
  // 越出 backend/ 一律拒绝：backend 之外的东西不该被这个脚本碰
  if (rel.startsWith('..')) {
    throw new Error(`拒绝操作 ${label}: ${abs} 在 backend/ 之外`);
  }
  if (!/(^|[/._-])test([/._-]|$)/i.test(path.basename(abs)) && !/test/i.test(rel)) {
    throw new Error(
      `拒绝操作 ${label}: ${rel} 不含 "test" 字样，无法确认是测试环境产物。\n` +
        `本脚本只删测试环境的库与目录；生产/开发数据不在射程内。`,
    );
  }
  return abs;
}

/** 读 .env.test 里的目录变量（不经 process.env，避免被外部注入误导） */
function readTestEnvVars() {
  const file = path.resolve(BACKEND_ROOT, '.env.test');
  if (!fs.existsSync(file)) {
    throw new Error(`缺少 ${file}：测试环境配置不存在，无法确认删除目标`);
  }
  const vars = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let v = line.slice(eq + 1).trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.length >= 2 && v.endsWith(q)) v = v.slice(1, -1);
    vars[line.slice(0, eq).trim()] = v;
  }
  return vars;
}

function rmIfExists(target, label) {
  const abs = assertTestTarget(label, target);
  if (!fs.existsSync(abs)) {
    console.log(`[skip] ${label} 不存在: ${abs}`);
    return;
  }
  fs.rmSync(abs, { recursive: true, force: true });
  console.log(`[rm]   ${label}: ${abs}`);
}

function main() {
  if ((process.env.NODE_ENV || '').trim() && process.env.NODE_ENV.trim() !== TARGET_ENV) {
    console.warn(
      `[warn] 当前 NODE_ENV=${process.env.NODE_ENV}，但本脚本只操作测试环境产物。\n` +
        `       继续执行会忽略 NODE_ENV，固定按 .env.test 解析目标。`,
    );
  }

  const vars = readTestEnvVars();
  const dbFile = path.resolve(BACKEND_ROOT, (vars.DATABASE_URL || 'file:./test.db').replace(/^file:/, ''));
  const uploadsDir = path.resolve(BACKEND_ROOT, vars.UPLOAD_DIR || 'uploads-test');
  const backupsDir = path.resolve(BACKEND_ROOT, vars.BACKUP_DIR || 'backups-test');
  const logDir = path.resolve(BACKEND_ROOT, vars.LOG_DIR || 'logs/test');

  console.log(`[env]  目标环境: ${TARGET_ENV}`);
  console.log(`[env]  库文件   : ${dbFile}`);
  console.log(`[env]  上传目录 : ${uploadsDir}`);
  console.log(`[env]  备份目录 : ${backupsDir}`);
  console.log(`[env]  日志目录 : ${logDir}`);
  console.log('');

  rmIfExists(dbFile, '数据库');
  rmIfExists(`${dbFile}-journal`, '数据库 journal');
  rmIfExists(`${dbFile}-wal`, '数据库 WAL');
  rmIfExists(`${dbFile}-shm`, '数据库 SHM');
  rmIfExists(uploadsDir, '上传目录');
  rmIfExists(backupsDir, '备份目录');
  rmIfExists(logDir, '日志目录');

  console.log('\n[rebuild] 重建表结构…');
  execFileSync('npm', ['run', '--silent', 'prisma:push'], {
    cwd: BACKEND_ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: TARGET_ENV },
  });

  console.log('\n[rebuild] 灌入种子数据…');
  execFileSync('npm', ['run', '--silent', 'seed:all'], {
    cwd: BACKEND_ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: TARGET_ENV },
  });

  console.log(`\n[done] 测试环境已重置。启动: npm run start:test  （库=${resolveDbUrl()}）`);
}

try {
  main();
} catch (e) {
  console.error(`\n[abort] ${e.message}`);
  process.exit(1);
}