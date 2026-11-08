import { chromium } from '@playwright/test';
const EXEC='/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b = await chromium.launch({ executablePath: EXEC });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, storageState: 'playwright/.auth/admin.json' });
const p = await ctx.newPage();
await p.goto('http://localhost:5100/admin/payments?tab=reconciliation', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.getByLabel('账单日期').click();
await p.waitForTimeout(800);
const info = await p.evaluate(() => {
  const cells = [...document.querySelectorAll('[role="gridcell"]')].slice(0, 20);
  return cells.map(c => {
    const btn = c.querySelector('button');
    const cs = getComputedStyle(c);
    const bs = btn ? getComputedStyle(btn) : null;
    return {
      day: c.getAttribute('data-day'),
      outside: c.getAttribute('data-outside'),
      tdBg: cs.backgroundColor,
      btnBg: bs?.backgroundColor,
      btnDisabled: btn?.disabled,
      btnClass: btn?.className.slice(0,80),
    };
  });
});
console.log(JSON.stringify(info, null, 1));
await b.close();
