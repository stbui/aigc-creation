/**
 * 后台管理员预设凭据的脚本侧统一入口。
 *
 * development / test 使用固定账号，便于本地与自动化测试直接登录；
 * production 不提供默认密码，必须显式设置 ADMIN_PASSWORD 或使用 seed 随机生成的密码。
 *
 * 环境变量优先级高于 .env.{env}：
 *   ADMIN_EMAIL=ops@example.com ADMIN_PASSWORD=... npm run seed:admin
 */
const { loadEnvOnce } = require('./db-url');

/** 与 db-url.js / env-files.ts 保持同一套环境别名 */
function normalizeAdminEnv(raw) {
  const value = (raw || '').trim().toLowerCase();
  let env = value;
  if (env === 'prod') env = 'production';
  if (env === 'staging' || env === 'stage' || env === 'uat' || env === 'qa') env = 'test';
  if (env === 'dev') env = 'development';
  if (env !== 'production' && env !== 'test' && env !== 'development') env = 'development';
  return env;
}

function getAdminCredentials() {
  loadEnvOnce();
  const env = normalizeAdminEnv(process.env.NODE_ENV);
  const isPresetEnv = env === 'development' || env === 'test';

  return {
    env,
    isPresetEnv,
    email: (process.env.ADMIN_EMAIL || (isPresetEnv ? 'admin@admin.com' : 'admin@huojue.local'))
      .trim()
      .toLowerCase(),
    password: process.env.ADMIN_PASSWORD || (isPresetEnv ? '123456789' : ''),
  };
}

module.exports = { getAdminCredentials, normalizeAdminEnv };
