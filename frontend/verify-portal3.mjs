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
  const hits = [];
  const walk = (rules, layer) => {
    for (const r of rules) {
      if (r.cssRules) { walk(r.cssRules, r.conditionText || r.name || layer); continue; }
      if (!r.selectorText) continue;
      let m = false; try { m = btn.matches(r.selectorText); } catch {}
      if (m && /background/.test(r.style.cssText)) hits.push({ layer, sel: r.selectorText, css: r.style.cssText.slice(0,220) });
    }
  };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules, 'root'); } catch {} }
  return { hits, bg: getComputedStyle(btn).backgroundColor };
});
console.log(JSON.stringify(res, null, 1));
await b.close();
