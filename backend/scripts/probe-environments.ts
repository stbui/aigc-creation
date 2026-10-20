/**
 * 三环境解析逻辑的运行时验证（不依赖 Nest，不连数据库）。
 *
 * 覆盖：
 *   1. resolveEnvFiles 的档位顺序 —— 特别是 test/production 不回落 .env
 *   2. parseEnvText 的引号/注释/export 处理
 *   3. loadEnvFiles「不覆盖已有键」语义（容器注入优先于文件）
 *   4. 三档 DATABASE_URL / UPLOAD_DIR 各自独立
 *   5. production 的两道启动门禁真的拒绝
 *   6. scripts/db-url.js 与 src/config/env-files.ts 给出**同一套**档位
 *
 * 运行: npx ts-node -T scripts/probe-environments.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveEnvFiles,
  parseEnvText,
  loadEnvFiles,
  normalizeEnv,
  sqliteUrlToPath,
  resolveUploadsDir,
} from '../src/config/env-files';
import { validateEnv, startupWarnings, ENV_SPECS } from '../src/config/env.validation';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n【${title}】`);
}

// ── 1. 档位顺序 ────────────────────────────────────────────────────────────
section('env 文件档位顺序');
check(
  'development: .local > 共享 > .env.local > .env',
  JSON.stringify(resolveEnvFiles('development')) ===
    JSON.stringify(['.env.development.local', '.env.development', '.env.local', '.env']),
  JSON.stringify(resolveEnvFiles('development')),
);
check(
  'test: 只两级，且不回落 .env',
  JSON.stringify(resolveEnvFiles('test')) ===
    JSON.stringify(['.env.test.local', '.env.test']),
  JSON.stringify(resolveEnvFiles('test')),
);
check(
  'production: 只两级，且不回落 .env',
  JSON.stringify(resolveEnvFiles('production')) ===
    JSON.stringify(['.env.production.local', '.env.production']),
  JSON.stringify(resolveEnvFiles('production')),
);
check(
  'test档位不含裸 .env（否则会继承开发库的 DATABASE_URL）',
  !resolveEnvFiles('test').includes('.env'),
  JSON.stringify(resolveEnvFiles('test')),
);
check('未传 NODE_ENV → development', normalizeEnv(undefined) === 'development');
check('prod 别名 → production', normalizeEnv('prod') === 'production');
check('staging 别名 → test', normalizeEnv('staging') === 'test');
check('非法值 → development', normalizeEnv('nonsense') === 'development');

// ── 2. 文本解析 ────────────────────────────────────────────────────────────
section('dotenv 文本解析');
{
  const parsed = parseEnvText(
    [
      '# 注释行',
      '',
      'PORT=3001',
      'export HOST=0.0.0.0',
      'QUOTED="带 空格的值"',
      "SINGLE='单引号'",
      'EMPTY=',
      'PWD_WITH_HASH=a#b#c',
      'BAD_LINE_NO_EQ',
      '  SPACED  =  x  ',
    ].join('\n'),
  );
  check('PORT', parsed.PORT === '3001');
  check('export 前缀被去掉', parsed.HOST === '0.0.0.0');
  check('双引号去除', parsed.QUOTED === '带 空格的值');
  check('单引号去除', parsed.SINGLE === '单引号');
  check('空值保留为空串', parsed.EMPTY === '');
  check('行内 # 不当注释（值含 # 时按字面量）', parsed.PWD_WITH_HASH === 'a#b#c');
  check('无 = 的行被忽略', !('BAD_LINE_NO_EQ' in parsed));
  check('键与值两侧空白被裁掉', parsed.SPACED === 'x');
}

// ── 3. 优先级：外部环境变量 > 文件 ──────────────────────────────────────────
section('loadEnvFiles 优先级');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envprobe-'));
  fs.writeFileSync(path.join(tmp, '.env'), 'FROM_SHARED=shared\nSHARED_ONLY=1\n');
  fs.writeFileSync(path.join(tmp, '.env.local'), 'FROM_LOCAL=local\n');
  fs.writeFileSync(path.join(tmp, '.env.test'), 'FROM_SHARED=test-shared\nTEST_ONLY=1\n');
  fs.writeFileSync(path.join(tmp, '.env.test.local'), 'FROM_TEST_LOCAL=tlocal\n');
  fs.writeFileSync(path.join(tmp, '.env.development'), 'FROM_SHARED=dev-shared\nDEV_ONLY=1\n');
  fs.writeFileSync(path.join(tmp, '.env.development.local'), 'FROM_DEV_LOCAL=dlocal\n');

  // 外部注入应当压过文件
  const t1: NodeJS.ProcessEnv = { FROM_SHARED: 'from-process-env' };
  loadEnvFiles('test', tmp, t1);
  check('外部环境变量不被文件覆盖', t1.FROM_SHARED === 'from-process-env', t1.FROM_SHARED);
  check('档位专属文件被加载', t1.TEST_ONLY === '1');
  check('.env.test.local 生效', t1.FROM_TEST_LOCAL === 'tlocal');

  // test 档位不得看到 .env / .env.local 的键
  const t2: NodeJS.ProcessEnv = {};
  loadEnvFiles('test', tmp, t2);
  check('test 档位不加载裸 .env', t2.SHARED_ONLY === undefined, JSON.stringify(t2));
  check('test 档位不加载 .env.local', t2.FROM_LOCAL === undefined, JSON.stringify(t2));

  // development 会回落
  const t3: NodeJS.ProcessEnv = {};
  loadEnvFiles('development', tmp, t3);
  check('development 档位回落 .env', t3.SHARED_ONLY === '1');
  check('development 档位回落 .env.local', t3.FROM_LOCAL === 'local');
  check('development 档位加载 .env.development', t3.DEV_ONLY === '1');
  check('development 档位加载 .env.development.local', t3.FROM_DEV_LOCAL === 'dlocal');
  check(
    'development: .env.development 的同名键压过 .env（档位优先于共享文件）',
    t3.FROM_SHARED === 'dev-shared',
    t3.FROM_SHARED,
  );

  // 同理验证 test 档位的同名键压过……test 不读 .env，故只验证它取 .env.test 的值
  const t3b: NodeJS.ProcessEnv = {};
  loadEnvFiles('test', tmp, t3b);
  check('test 档位取 .env.test 的同名键', t3b.FROM_SHARED === 'test-shared', t3b.FROM_SHARED);

  // 坏文件不应阻断启动
  fs.writeFileSync(path.join(tmp, '.env.production'), 'X=1\n');
  const t4: NodeJS.ProcessEnv = {};
  loadEnvFiles('production', tmp, t4);
  check('production 加载自身档位', t4.X === '1');

  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── 4. 三档实际配置各自独立 ────────────────────────────────────────────────
section('三档 env 文件实际内容（读取仓库真实文件）');
{
  const backendRoot = path.resolve(__dirname, '..');
  const read = (file: string): Record<string, string> => {
    const p = path.join(backendRoot, file);
    if (!fs.existsSync(p)) return {};
    return parseEnvText(fs.readFileSync(p, 'utf8'));
  };

  const dev = read('.env.development');
  const test = read('.env.test');
  const prodSample = read('.env.production.example');

  check('.env.development 存在且NODE_ENV=development', dev.NODE_ENV === 'development');
  check('.env.test 存在且 NODE_ENV=test', test.NODE_ENV === 'test');
  check('.env.production.example 存在且 NODE_ENV=production', prodSample.NODE_ENV === 'production');
  check('真实 .env.production 不入库（应不存在）', !fs.existsSync(path.join(backendRoot, '.env.production')));

  check('开发库= dev.db', dev.DATABASE_URL === 'file:./dev.db', dev.DATABASE_URL);
  check('测试库 = test.db', test.DATABASE_URL === 'file:./test.db', test.DATABASE_URL);
  check('生产库≠ dev.db', prodSample.DATABASE_URL !== 'file:./dev.db', prodSample.DATABASE_URL);

  check('开发上传目录 uploads', dev.UPLOAD_DIR === 'uploads');
  check('测试上传目录 uploads-test', test.UPLOAD_DIR === 'uploads-test');
  check('三环境上传目录互不相同', new Set([dev.UPLOAD_DIR, test.UPLOAD_DIR, prodSample.UPLOAD_DIR]).size === 3);

  check('测试 JWT 密钥 ≠ 开发', (test.JWT_SECRET || '') !== (dev.JWT_SECRET || ''));
  check('测试端口 3101≠ 开发 3001', test.PORT !== dev.PORT);
  check('生产 HOST=0.0.0.0（容器必须对外监听）', prodSample.HOST === '0.0.0.0', prodSample.HOST);
  check('开发 HOST=127.0.0.1（不暴露局域网）', dev.HOST === '127.0.0.1');
  check('生产 CORS_ORIGINS 非空（留空会只放行本机端口）', (prodSample.CORS_ORIGINS || '').trim() !== '');
  check('生产 JWT_SECRET 留空待填（样例不含真凭据）', (prodSample.JWT_SECRET || '').trim() === '');

  // 路径解析
  check('sqliteUrlToPath 解析 file:./test.db', sqliteUrlToPath('file:./test.db', '/base') === '/base/test.db');
  check('resolveUploadsDir 回落 uploads', resolveUploadsDir({}, '/base') === '/base/uploads');
  check('resolveUploadsDir 尊重 UPLOAD_DIR', resolveUploadsDir({ UPLOAD_DIR: 'uploads-test' }, '/base') === '/base/uploads-test');
}

// ── 5. 生产门禁 ────────────────────────────────────────────────────────────
section('production 启动门禁');
{
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'file:./data/prod.db',
    JWT_SECRET: 'a-strong-random-value-for-production',
  };

  let threw: any = null;
  try {
    validateEnv({ ...base });
  } catch (e) {
    threw = e;
  }
  check('合规的生产配置能通过校验', threw === null, threw?.message);

  // 缺 JWT_SECRET
  threw = null;
  try {
    validateEnv({ ...base, JWT_SECRET: '' });
  } catch (e) {
    threw = e;
  }
  check('缺 JWT_SECRET → 启动失败', threw !== null && threw.problems?.some((p: string) => /JWT_SECRET/.test(p)));
  check('失败原因为 EnvValidationError', threw?.name === 'EnvValidationError');

  // 数据库仍是开发默认值
  threw = null;
  try {
    validateEnv({ ...base, DATABASE_URL: 'file:./dev.db' });
  } catch (e) {
    threw = e;
  }
  check(
    '生产库= dev.db → 启动失败',
    threw !== null && threw.problems?.some((p: string) => /DATABASE_URL/.test(p)),
    threw?.message,
  );

  // 开发环境不因此失败
  threw = null;
  try {
    validateEnv({ NODE_ENV: 'development' });
  } catch (e) {
    threw = e;
  }
  check('开发环境零配置能启动', threw === null, threw?.message);

  threw = null;
  try {
    validateEnv({ NODE_ENV: 'test' });
  } catch (e) {
    threw = e;
  }
  check('测试环境零配置能启动', threw === null, threw?.message);

  // 非法 NODE_ENV
  threw = null;
  try {
    validateEnv({ NODE_ENV: 'staging' });
  } catch (e) {
    threw = e;
  }
  check('非法 NODE_ENV 被拒', threw !== null);
}

// ── 6. 副作用纪律：校验失败不得往告警队列留残留 ────────────────────────────
section('告警队列无副作用');
{
  const before = startupWarnings.length;
  try {
    validateEnv({ NODE_ENV: 'production', JWT_SECRET: '' });
  } catch {
    /*预期抛错 */
  }
  check('校验失败不追加 startupWarnings', startupWarnings.length === before, `${before} → ${startupWarnings.length}`);
}

// ── 7. scripts/db-url.js 与 src/config/env-files.ts 档位一致 ───────────────
section('脚本侧与 Nest 侧档位一致');
{
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const scriptSide = require('./db-url');
  for (const env of ['development', 'test', 'production']) {
    const a = JSON.stringify(resolveEnvFiles(env));
    const b = JSON.stringify(scriptSide.resolveEnvFiles(env));
    check(`${env}:两侧档位顺序一致`, a === b, `Nest=${a} script=${b}`);
  }
  check(
    '未注入 DATABASE_URL 时脚回落 dev.db（与迁移前逐字一致）',
    scriptSide.resolveDbUrl() === 'file:./dev.db',
    scriptSide.resolveDbUrl(),
  );
}

// ── 8. 配置事实源覆盖度 ────────────────────────────────────────────────────
section('ENV_SPECS 覆盖度');
{
  const names = new Set(ENV_SPECS.map((s) => s.env));
  for (const required of [
    'NODE_ENV', 'PORT', 'HOST', 'DATABASE_URL', 'UPLOAD_DIR', 'BACKUP_DIR',
    'CORS_ORIGINS', 'JWT_SECRET', 'JWT_TTL', 'LOG_LEVEL', 'LOG_DIR',
    'STORAGE_BACKEND', 'GATEWAY_BASE_URL',
  ]) {
    check(`${required} 在 ENV_SPECS 中`, names.has(required));
  }
  check('KEY 唯一', new Set(ENV_SPECS.map((s) => s.key)).size === ENV_SPECS.length);
  check('ENV 唯一', names.size === ENV_SPECS.length);
}

// ── 汇总 ────────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(56)}`);
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
console.log('='.repeat(56));
process.exit(fail > 0 ? 1 : 0);