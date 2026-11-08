import { chromium } from '@playwright/test';
const EXEC='/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b = await chromium.launch({ executablePath: EXEC });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, storageState: 'playwright/.auth/admin.json' });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
// order detail drawer
await p.goto('http://localhost:5100/admin/payments?tab=orders', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.getByRole('button', { name: /查看订单/ }).first().click();
await p.waitForTimeout(1500);
await p.screenshot({ path: '/tmp/d-order.png', fullPage: true });
await p.keyboard.press('Escape');
await p.waitForTimeout(500);
// product drawer
await p.goto('http://localhost:5100/admin/payments?tab=products', { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await p.getByRole('button', { name: /编辑/ }).first().click();
await p.waitForTimeout(1200);
await p.screenshot({ path: '/tmp/d-product.png', fullPage: true });
console.log('errors:', errs);
await b.close();
