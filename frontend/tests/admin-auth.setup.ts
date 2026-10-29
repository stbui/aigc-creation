import { test as setup, expect } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';

/**
 * 后台 E2E 共享登录态。
 *
 * 后台整套用例有 20+ 条。若每条都走一次登录页，会撞上开发环境默认的
 * 认证限流 (10 次/分钟)，表现为排在后面的用例在登录页超时。这里只在
 * 套件开始时登录一次并落盘 localStorage，各用例通过 storageState 复用。
 *
 * 需要验证「未登录」「普通用户越权」的用例会主动清空这份状态。
 */
const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';
const AUTH_FILE = 'playwright/.auth/admin.json';

setup('登录后台并保存会话', async ({ page }) => {
  setup.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  await page.goto(`${UI}/login`);
  await page.locator('input[type="email"], input#email, input[name="email"]').first().fill(ADMIN_EMAIL);
  const password = page.locator('input[type="password"]').first();
  await password.fill(ADMIN_PASSWORD);
  await password.press('Enter');
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15000 });

  const token = await page.evaluate(() => localStorage.getItem('ecom_vision_token'));
  expect(token, '登录成功后未写入本地会话').toBeTruthy();
  await page.context().storageState({ path: AUTH_FILE });
});
