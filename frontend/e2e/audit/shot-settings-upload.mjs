import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * 设置页「上传」分组截图（2026-11-01）。
 *
 * 该分组有 3 个可编辑项（文本 / 数字 / 枚举），能一次看清文本框、数字框、
 * 下拉、开关四种控件在新骨架下的样子。默认落在「站点」分组（全是只读项），
 * 看不到控件。
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
await page.fill(
  'input[type="email"], input[placeholder*="邮箱"], input[name="email"]',
  'admin@admin.com',
);
await page.fill('input[type="password"]', '123456789');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

await page.goto('http://localhost:5100/admin/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

// 切到「上传」分组（有可编辑项）
await page.getByRole('tab', { name: /上传/ }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/shot-admin-settings-upload.png', fullPage: true });
console.log('已截图 → /tmp/shot-admin-settings-upload.png');

// 打开下拉看浮层
const trigger = page.locator('[data-slot="select-trigger"]').first();
if (await trigger.count()) {
  await trigger.click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/tmp/shot-admin-settings-select.png' });
  console.log('已截图 → /tmp/shot-admin-settings-select.png');
  await page.keyboard.press('Escape');
}

console.log('=== console errors ===');
console.log(errors.length ? errors.join('\n') : '(无)');

await browser.close();
