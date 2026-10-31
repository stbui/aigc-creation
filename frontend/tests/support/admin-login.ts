import type { Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './admin-credentials';

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

/**
 * 确保当前页面具备后台登录态。
 *
 * 整套 E2E 由 admin-auth.setup.ts 预置 storageState；此时直接打开 /login 会
 * 被前端重定向到工作台，页面上没有邮箱框。先访问后台：已登录就直接返回，
 * 只有真的落在登录页时才补一次表单登录。
 */
export async function ensureAdminLogin(page: Page): Promise<void> {
  await page.goto(`${UI}/admin`);
  await page.waitForSelector(
    '[data-testid="admin-sider"], input[type="email"], input#email',
    { timeout: 15000 },
  );

  const email = page.locator('input[type="email"], input#email').first();
  if (!(await email.isVisible().catch(() => false))) return;

  await email.fill(ADMIN_EMAIL);
  const password = page.locator('input[type="password"]').first();
  await password.fill(ADMIN_PASSWORD);
  await password.press('Enter');
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });
}
