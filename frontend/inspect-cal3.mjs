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
  const btn = document.querySelector('[role="gridcell"] button');
  return {
    popParentChain: (() => { let n = pop, out=[]; while(n && n!==document.body){ out.push(n.tagName+'.'+(n.className||'').toString().split(' ').slice(0,2).join('.')); n = n.parentElement; } return out; })(),
    inAdminRoot: !!pop.closest('.admin-root'),
    bodyChildren: [...document.body.children].map(c=>c.tagName+'.'+(typeof c.className==='string'?c.className:'')),
    btnBg: getComputedStyle(btn).backgroundColor,
    btnBorder: getComputedStyle(btn).border,
    // same check for select dropdown (radix portal)
  };
});
console.log(JSON.stringify(res, null, 1));
await b.close();
