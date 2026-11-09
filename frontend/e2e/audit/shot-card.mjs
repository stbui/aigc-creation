import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

const LOCAL_CHROMIUM_PATH =
  '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';

const browser = await chromium.launch({
  executablePath: existsSync(LOCAL_CHROMIUM_PATH) ? LOCAL_CHROMIUM_PATH : undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await page.goto('http://localhost:5100/login', { waitUntil: 'networkidle' });
await page.fill('input[type="email"], input[placeholder*="邮箱"], input[name="email"]', 'admin@admin.com');
await page.fill('input[type="password"]', '123456789');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

await page.goto('http://localhost:5100/admin', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

const cards = page.locator('[data-slot="card"]');
const count = await cards.count();
console.log('卡片数:', count);
for (let i = 0; i < count; i += 1) {
  const card = cards.nth(i);
  const title = (await card.locator('h2').first().textContent().catch(() => ''))?.trim() ?? '';
  if (!title.includes('任务趋势') && !title.includes('收入')) continue;
  const name = title.replace(/\s+/g, '-');
  await card.screenshot({ path: `/tmp/shot-card-${name}.png` });
  console.log('已截图:', name);
}

await browser.close();
