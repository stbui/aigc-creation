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
  const out = {};
  // inline background transparent
  btn.style.background = 'transparent';
  out.inlineTransparent = getComputedStyle(btn).backgroundColor;
  btn.style.background = '';
  // find style tags containing the reset selector
  const found = [];
  for (const sheet of document.styleSheets) {
    const txt = sheet.ownerNode?.textContent || '';
    if (txt.includes('admin-portal') && txt.includes('button')) {
      const idx = txt.indexOf('admin-portal');
      found.push({ len: txt.length, snippet: txt.slice(Math.max(0,idx-200), idx+400) });
    }
  }
  out.found = found;
  return out;
});
console.log(JSON.stringify(res, null, 1).slice(0,4000));
await b.close();
