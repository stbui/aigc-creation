import { chromium } from '@playwright/test';
const EXEC='/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b = await chromium.launch({ executablePath: EXEC });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, storageState: 'playwright/.auth/admin.json' });
const p = await ctx.newPage();
await p.goto('http://localhost:5100/admin/payments?tab=reconciliation', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.getByLabel('筛选渠道').click();
await p.waitForTimeout(800);
await p.screenshot({ path: '/tmp/c-select.png' });
const res = await p.evaluate(() => {
  const c = document.querySelector('[data-slot="select-content"]');
  const items = [...c.querySelectorAll('[data-slot="select-item"]')].slice(0,3).map(i=>({
    bg: getComputedStyle(i).backgroundColor, font: getComputedStyle(i).fontSize, slot: i.getAttribute('data-slot')
  }));
  return { inAdminRoot: !!c.closest('.admin-root'), items };
});
console.log(JSON.stringify(res,null,1));
await b.close();
