import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * 后台浮层与交互态截图（2026-11-01，shadcn 迁移期）。
 *
 * 截图覆盖：告警铃弹层、侧栏用户菜单、渠道删除确认条、新建渠道抽屉。
 * 这些态在静态截图里看不到，而它们正是「换皮只换了一半」最容易露馅的地方
 * —— 弹层仍带 `.bui-scope` 就会是旧圆角配新描边。
 */

const LOCAL_CHROMIUM_PATH =
  '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';

const browser = await chromium.launch({
  executablePath: existsSync(LOCAL_CHROMIUM_PATH) ? LOCAL_CHROMIUM_PATH : undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:5100/login', { waitUntil: 'networkidle' });
await page.fill('input[type="email"], input[placeholder*="邮箱"], input[name="email"]', 'admin@admin.com');
await page.fill('input[type="password"]', '123456789');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

await page.goto('http://localhost:5100/admin', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.click('[aria-label*="告警中心"]');
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/shot-admin-alert-popover.png' });

await page.click('[aria-label="告警中心，暂无待处理"]').catch(() => {});
await page.keyboard.press('Escape');
await page.click('[aria-label="打开用户菜单"]');
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/shot-admin-user-menu.png' });
await page.keyboard.press('Escape');

await page.goto('http://localhost:5100/admin/channels', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.getByRole('button', { name: '新建渠道' }).first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/shot-admin-drawer.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

await page.getByText('a6api').first().click();
await page.waitForTimeout(800);
const del = page.getByRole('button', { name: /删除渠道/ }).first();
if (await del.count()) {
  await del.click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: '/tmp/shot-admin-confirm.png' });
}

console.log('=== console errors ===');
console.log(errors.length ? errors.join('\n') : '(无)');
await browser.close();
