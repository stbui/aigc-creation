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
  pop.classList.add('admin-portal');
  const btn = document.querySelector('[role="gridcell"] button');
  const sheets = [];
  for (const sheet of document.styleSheets) {
    let n = 0, err = null;
    try { n = sheet.cssRules.length; } catch(e) { err = String(e); }
    sheets.push({ href: sheet.href, ownerNode: sheet.ownerNode?.tagName, n, err });
  }
  // find all rules mentioning 'button' anywhere
  const buttonRules = [];
  const walk = (rules, path) => {
    for (const r of rules) {
      if (r.cssRules) { walk(r.cssRules, path + '>' + (r.constructor.name)); continue; }
      if (!r.selectorText) continue;
      if (/button/.test(r.selectorText) && /background/.test(r.style.cssText)) {
        buttonRules.push({ path, sel: r.selectorText, css: r.style.cssText.slice(0,150) });
      }
    }
  };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules, 'root'); } catch(e) { buttonRules.push({path:'ERR '+e}); } }
  return { sheets, buttonRules, bg: getComputedStyle(btn).backgroundColor };
});
console.log(JSON.stringify(res, null, 1).slice(0, 5000));
await b.close();
