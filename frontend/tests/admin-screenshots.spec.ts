import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';
import { ensureAdminLogin } from './support/admin-login';

/** 截图取证: 登录后台后逐页截图, 作为交付证据 */
const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';
const OUT = '../docs/screenshots/admin';

test('后台五页截图', async ({ page }) => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');
  mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await ensureAdminLogin(page);

  const pages: Array<[string, string]> = [
    ['/admin', '01-dashboard'],
    ['/admin/users', '02-users'],
    ['/admin/roles', '03-roles'],
    ['/admin/settings', '04-settings'],
  ];

  for (const [path, name] of pages) {
    await page.goto(`${UI}${path}`);
    await page.waitForTimeout(2200); // 等数据与图表渲染
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    expect(await page.locator('.adm-layout').count()).toBeGreaterThan(0);
  }
});
