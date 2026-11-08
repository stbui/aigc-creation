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
  const matches = btn.matches(':is(.admin-root, .admin-portal) :where(button, input, select, textarea)');
  // find which rules set background on this button
  const hits = [];
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      if (!r.selectorText) continue;
      try { if (btn.matches(r.selectorText) && /background/.test(r.style.cssText)) hits.push({sel:r.selectorText, css:r.style.cssText.slice(0,200)}); } catch {}
    }
  }
  return { matches, hits, bg: getComputedStyle(btn).backgroundColor };
});
console.log(JSON.stringify(res, null, 1));
await b.close();
