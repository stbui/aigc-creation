import { chromium } from '@playwright/test';
const EXEC='/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b = await chromium.launch({ executablePath: EXEC });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, storageState: 'playwright/.auth/admin.json' });
const p = await ctx.newPage();
await p.goto('http://localhost:5100/admin/payments?tab=reconciliation', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.getByLabel('账单日期').click();
await p.waitForTimeout(800);
const res = await p.evaluate(() => {
  const btn = document.querySelector('[role="gridcell"] button');
  const pop = document.querySelector('[data-slot="popover-content"]');
  const out = { before: getComputedStyle(btn).backgroundColor, appearance: getComputedStyle(btn).appearance };
  // 1) add admin-portal
  pop.classList.add('admin-portal');
  out.afterAdminPortal = getComputedStyle(btn).backgroundColor;
  // 2) also set appearance none
  const s = document.createElement('style');
  s.textContent = '.admin-portal button { appearance: none; -webkit-appearance: none; }';
  document.head.appendChild(s);
  out.afterAppearance = getComputedStyle(btn).backgroundColor;
  return out;
});
console.log(JSON.stringify(res, null, 1));
await b.close();
