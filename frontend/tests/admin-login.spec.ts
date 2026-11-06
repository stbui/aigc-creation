import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  HAS_ADMIN_CREDENTIALS,
} from './support/admin-credentials';

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

// 后台入口必须覆盖真实无登录态；其余后台用例共用 setup 生成的 storageState。
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('后台登录入口', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  test('从 /admin 登录后回到后台概览', async ({ page }) => {
    await page.goto(`${UI}/admin`);

    await expect(page).toHaveURL(/\/login\?redirect=%2Fadmin$/);
    await page.locator('input[placeholder="账号（邮箱）"]').fill(ADMIN_EMAIL);
    await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
    await page.locator('input[type="password"]').press('Enter');

    await page.waitForURL(`${UI}/admin`, { timeout: 15000 });
    await expect(page.getByRole('heading', { name: '平台概览' })).toBeVisible({
      timeout: 15000,
    });
  });
});
