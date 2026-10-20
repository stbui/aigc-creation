import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';

/** 截图取证: 登录后台后逐页截图, 作为交付证据 */
const UI = process.env.ADMIN_UI ?? 'http://localhost:5173';
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@huojue.local';
const PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const OUT = '../docs/screenshots/admin';

test('后台五页截图', async ({ page }) => {
  test.skip(!PASSWORD, '未提供 ADMIN_PASSWORD');
  mkdirSync(OUT, { recursive: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${UI}/login`);
  await page.locator('input[type="email"], input#email').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.locator('input[type="password"]').first().press('Enter');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });

  const pages: Array<[string, string]> = [
    ['/admin', '01-dashboard'],
    ['/admin/users', '02-users'],
    ['/admin/roles', '03-roles'],
    ['/admin/settings', '04-settings'],
    ['/admin/audit-logs', '05-audit'],
  ];

  for (const [path, name] of pages) {
    await page.goto(`${UI}${path}`);
    await page.waitForTimeout(2200); // 等数据与图表渲染
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
    expect(await page.locator('.adm-layout').count()).toBeGreaterThan(0);
  }
});