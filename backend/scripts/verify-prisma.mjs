/**
 * Prisma schema 闸口：校验语法、格式与迁移一致性。
 *
 * 三步都不会改仓库里的 schema：
 *   1. `prisma validate` —— schema 语法与关系完整性
 *   2. `prisma format` 在临时副本上执行，再与仓库文件逐字比较 ——
 *      直接对仓库文件跑 format 会改工作区，无法作为只读检查
 *   3. `prisma migrate diff --from-migrations --to-schema --exit-code` ——
 *      迁移目录与 schema 不一致时退出码为 2
 *
 * 用法: npm run verify:prisma（根目录 `npm run check` 已包含）
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BACKEND_ROOT = resolve(import.meta.dirname, '..');
const PRISMA_BIN = join(BACKEND_ROOT, 'node_modules', '.bin', 'prisma');
const SCHEMA = join(BACKEND_ROOT, 'prisma', 'schema.prisma');
const MIGRATIONS = join(BACKEND_ROOT, 'prisma', 'migrations');

function run(args, label) {
  try {
    const out = execFileSync(PRISMA_BIN, args, {
      cwd: BACKEND_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out;
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
    console.error(`[fail] ${label}`);
    if (detail) console.error(detail);
    process.exit(error.status ?? 1);
  }
}

if (!existsSync(PRISMA_BIN)) {
  console.error(`[fail] 找不到 Prisma CLI: ${PRISMA_BIN}（先执行 npm ci）`);
  process.exit(1);
}
if (!existsSync(MIGRATIONS)) {
  console.error(`[fail] 迁移目录不存在: ${MIGRATIONS}`);
  process.exit(1);
}

run(['validate'], 'prisma validate');

const tmpDir = mkdtempSync(join(tmpdir(), 'huojue-prisma-format-'));
try {
  const copy = join(tmpDir, 'schema.prisma');
  copyFileSync(SCHEMA, copy);
  run(['format', '--schema', copy], 'prisma format');

  const actual = readFileSync(SCHEMA, 'utf8');
  const formatted = readFileSync(copy, 'utf8');
  if (actual !== formatted) {
    console.error('[fail] prisma/schema.prisma 未按 `prisma format` 格式化，请执行 npx prisma format 后提交');
    process.exit(1);
  }
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}

run(
  [
    'migrate',
    'diff',
    '--from-migrations',
    MIGRATIONS,
    '--to-schema',
    SCHEMA,
    '--exit-code',
  ],
  'prisma migrate diff（schema 与迁移不一致）',
);

console.log('Prisma 校验通过：schema 合法、格式一致、迁移与 schema 同步。');