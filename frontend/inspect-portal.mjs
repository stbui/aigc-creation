import { chromium } from '@playwright/test';
const EXEC='/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b = await chromium.launch({ executablePath: EXEC });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, storageState: 'playwright/.auth/admin.json' });
const p = await ctx.newPage();
await p.goto('http://localhost:5100/admin/payments?tab=reconciliation', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);

// open a select dropdown
await p.getByLabel('筛选渠道').click();
await p.waitForTimeout(700);
const sel = await p.evaluate(() => {
  const c = document.querySelector('[data-slot="select-content"]');
  if (!c) return null;
  return { inAdminRoot: !!c.closest('.admin-root'), parentSlot: c.parentElement?.getAttribute('data-slot'), html: c.innerHTML.slice(0,300) };
});
console.log('select:', JSON.stringify(sel, null, 1));
await p.keyboard.press('Escape');
await p.waitForTimeout(400);
await b.close();
