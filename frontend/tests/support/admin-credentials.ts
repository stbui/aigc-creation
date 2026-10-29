/**
 * 后台 E2E 的统一预设账号。
 *
 * development / test 使用与 backend/scripts/seed-admin.ts 相同的固定凭据；
 * production 不提供默认口令，必须通过 ADMIN_EMAIL / ADMIN_PASSWORD 显式传入。
 */
const IS_PRODUCTION = (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

export const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL || (IS_PRODUCTION ? '' : 'admin@admin.com');
export const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? '' : '123456789');
export const HAS_ADMIN_CREDENTIALS = Boolean(ADMIN_EMAIL && ADMIN_PASSWORD);
