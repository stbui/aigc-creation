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
  const pop = document.querySelector('[data-slot="popover-content"]');
  const wrap = pop.parentElement;
  const attrs = {};
  for (const a of wrap.attributes) attrs[a.name] = a.value;
  // which buttons inside portal lack explicit bg
  const btns = [...pop.querySelectorAll('button')].slice(0,3).map(b=>({
    slot: b.getAttribute('data-slot'), variant: b.getAttribute('data-variant'),
    bg: getComputedStyle(b).backgroundColor,
  }));
  return { wrapTag: wrap.tagName, wrapAttrs: attrs, wrapParent: wrap.parentElement?.tagName, wrapParentAttrs: Object.fromEntries([...(wrap.parentElement?.attributes??[])].map(a=>[a.name,a.value])), btns };
});
console.log(JSON.stringify(res, null, 1));
await b.close();
