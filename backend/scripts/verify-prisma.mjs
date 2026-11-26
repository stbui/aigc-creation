/**
 * Prisma schema 闸口：双方言（PostgreSQL 主源 + SQLite 派生）一起校验。
 *
 * 五步都不会改仓库里的 schema：
 *   1. `prisma validate` —— 两份 schema 的语法与关系完整性
 *   2. `prisma format` 在临时副本上执行，再与仓库文件逐字比较 ——
 *      直接对仓库文件跑 format 会改工作区，无法作为只读检查
 *   3. `prisma migrate diff --from-migrations … --exit-code` —— PG 迁移目录与
 *      schema.prisma 不一致时退出码为 2
 *   4. 同样的 diff 校验 SQLite 迁移目录与 schema.sqlite.prisma
 *   5. 由 schema.prisma 重新派生 SQLite schema，与仓库文件逐字比对 ——
 *      防止有人绕过 sync 手改派生文件
 *
 * 用法: npm run verify:prisma（根目录 `npm run check` 已包含）
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deriveSqliteSchema } from './lib/sqlite-schema.mjs';

const BACKEND_ROOT = resolve(import.meta.dirname, '..');
const PRISMA_BIN = join(BACKEND_ROOT, 'node_modules', '.bin', 'prisma');
const PG_SCHEMA = join(BACKEND_ROOT, 'prisma', 'schema.prisma');
const SQLITE_SCHEMA = join(BACKEND_ROOT, 'prisma', 'schema.sqlite.prisma');
const PG_MIGRATIONS = join(BACKEND_ROOT, 'prisma', 'migrations');
const SQLITE_MIGRATIONS = join(BACKEND_ROOT, 'prisma', 'migrations-sqlite');

function run(args, label, env = process.env) {
  try {
    return execFileSync(PRISMA_BIN, args, {
      cwd: BACKEND_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
    console.error(`[fail] ${label}`);
    if (detail) console.error(detail);
    process.exit(error.status ?? 1);
  }
}

function formatCheck(schemaPath) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'huojue-prisma-format-'));
  try {
    const copy = join(tmpDir, 'schema.prisma');
    copyFileSync(schemaPath, copy);
    run(['format', '--schema', copy], `prisma format (${schemaPath})`);
    if (readFileSync(schemaPath, 'utf8') !== readFileSync(copy, 'utf8')) {
      console.error(
        `[fail] ${schemaPath} 未按 \`prisma format\` 格式化，请执行 npx prisma format 后提交`,
      );
      process.exit(1);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (!existsSync(PRISMA_BIN)) {
  console.error(`[fail] 找不到 Prisma CLI: ${PRISMA_BIN}（先执行 npm ci）`);
  process.exit(1);
}
for (const [label, path] of [
  ['PostgreSQL schema', PG_SCHEMA],
  ['SQLite schema', SQLITE_SCHEMA],
  ['PostgreSQL 迁移目录', PG_MIGRATIONS],
  ['SQLite 迁移目录', SQLITE_MIGRATIONS],
]) {
  if (!existsSync(path)) {
    console.error(`[fail] ${label}不存在: ${path}（执行 npm run prisma:sync-sqlite）`);
    process.exit(1);
  }
}

// 1. 语法
run(['validate', '--schema', PG_SCHEMA], 'prisma validate (PostgreSQL)');
run(['validate', '--schema', SQLITE_SCHEMA], 'prisma validate (SQLite)');

// 2. 格式
formatCheck(PG_SCHEMA);
formatCheck(SQLITE_SCHEMA);

// 3-4. 迁移与 schema 一致
//
// Prisma 7 的 migrate diff 对比迁移目录时必须从 prisma.config.ts 取影子库：
//   · SQLite —— config 自动给一个本地临时文件, 这里强制 DATABASE_URL 为 file:
//     协议, 避免当前 shell 恰好是 PG 时选错方言;
//   · PostgreSQL —— 需要显式 SHADOW_DATABASE_URL（独立空库）。没有就跳过并
//     明确提示: 拿生产/开发库当影子库是不可接受的。
const SQLITE_VERIFY_URL = 'file:./dev.db';
const pgShadow = (process.env.SHADOW_DATABASE_URL || '').trim();

run(
  [
    'migrate',
    'diff',
    '--from-migrations',
    SQLITE_MIGRATIONS,
    '--to-schema',
    SQLITE_SCHEMA,
    '--exit-code',
  ],
  'prisma migrate diff（SQLite schema 与迁移不一致）',
  { ...process.env, DATABASE_URL: SQLITE_VERIFY_URL },
);
rmSync(join(BACKEND_ROOT, 'prisma', '.shadow-verify.db'), { force: true });

if (pgShadow) {
  run(
    [
      'migrate',
      'diff',
      '--from-migrations',
      PG_MIGRATIONS,
      '--to-schema',
      PG_SCHEMA,
      '--exit-code',
    ],
    'prisma migrate diff（PostgreSQL schema 与迁移不一致）',
    { ...process.env, DATABASE_URL: pgShadow, SHADOW_DATABASE_URL: pgShadow },
  );
} else {
  console.warn(
    '[skip] 未设置 SHADOW_DATABASE_URL，跳过 PostgreSQL 迁移对比（SQLite 侧已校验；' +
      'CI / 发布前请提供独立空库作为影子库）',
  );
}

// 5. 派生文件未漂移
const expected = deriveSqliteSchema(readFileSync(PG_SCHEMA, 'utf8'));
if (readFileSync(SQLITE_SCHEMA, 'utf8') !== expected) {
  console.error(
    '[fail] prisma/schema.sqlite.prisma 与 schema.prisma 派生结果不一致：不要手改派生文件，执行 npm run prisma:sync-sqlite',
  );
  process.exit(1);
}

console.log('Prisma 校验通过：双方言 schema 合法、格式一致、迁移同步、派生未漂移。');
