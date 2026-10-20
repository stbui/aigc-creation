/**
 * 脚本侧的数据库 URL 解析（CommonJS，零依赖）。
 *
 * 为什么需要它
 * ------------
 * seed-* / smoke-* / migrate-storage 这二十来个脚本**不经过 Nest**，
 * 但它们要连的库必须和后端服务连的**同一个库** —— 否则会出现
 * 「后端连 test.db、seed 往 dev.db 里塞数据」这种错位，
 * 而且从表象（服务里查不到刚seed 的账号）完全看不出根因。
 *
 * 所以这里复用与 Nest 侧同一份档位逻辑（src/config/env-files 的编译产物
 * 或 src/config/env-files.ts，取决于调用方是 .js 还是 .ts）：
 *   1. 按 NODE_ENV 选 .env.{env} 系列文件并补进 process.env
 *   2. 取 DATABASE_URL，兜底 'file:./dev.db'（与迁移前逐字一致）
 *
 * 调用方写法：
 *   const { resolveDbUrl } = require('./db-url');
 *   new PrismaClient({ adapter: new F({ url: resolveDbUrl() }) });
 */
const path = require('path');
const fs = require('fs');

const BACKEND_ROOT = path.resolve(__dirname, '..');

/** 与 src/config/env-files.ts 的 resolveEnvFiles 保持逐字一致 */
function resolveEnvFiles(env) {
  const raw = (env || '').trim().toLowerCase();
  let e = raw;
  if (e === 'prod') e = 'production';
  if (e === 'staging' || e === 'stage' || e === 'uat' || e === 'qa') e = 'test';
  if (e === 'dev') e = 'development';
  if (e !== 'production' && e !== 'test' && e !== 'development') e = 'development';

  const local = `.env.${e}.local`;
  const shared = `.env.${e}`;
  if (e === 'development') return [local, shared, '.env.local', '.env'];
  return [local, shared];
}

/** 极简 dotenv 解析：不覆盖已存在的键（同 env-files.ts） */
function parseEnvText(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

let loaded = false;

/** 按 NODE_ENV 载入 env 文件到 process.env（幂等，可重复调用） */
function loadEnvOnce() {
  if (loaded) return;
  loaded = true;
  for (const file of resolveEnvFiles(process.env.NODE_ENV).reverse()) {
    const abs = path.resolve(BACKEND_ROOT, file);
    if (!fs.existsSync(abs)) continue;
    let parsed;
    try {
      parsed = parseEnvText(fs.readFileSync(abs, 'utf8'));
    } catch {
      continue;
    }
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
    }
  }
}

/** 本环境生效的数据库 URL。兜底与迁移前硬编码值逐字一致 */
function resolveDbUrl() {
  loadEnvOnce();
  return (process.env.DATABASE_URL || '').trim() || 'file:./dev.db';
}

/** 脚本可直接使用的绝对库路径（日志/错误信息里比相对路径清楚） */
function resolveDbPath() {
  return path.resolve(BACKEND_ROOT, resolveDbUrl().replace(/^file:/, ''));
}

module.exports = { loadEnvOnce, resolveDbUrl, resolveDbPath, resolveEnvFiles, BACKEND_ROOT };