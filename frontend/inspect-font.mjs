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
  const cs = getComputedStyle(btn);
  const inAdmin = !!btn.closest('.admin-root');
  // check if text-sm utility exists in any stylesheet
  let hasTextSm = false, hasTextXs = false;
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) {
      const sel = r.selectorText || '';
      if (/\.text-sm\b/.test(sel)) hasTextSm = true;
      if (/\.text-xs\b/.test(sel)) hasTextXs = true;
    }
  }
  return {
    inAdminRoot: inAdmin,
    fontSize: cs.fontSize, lineHeight: cs.lineHeight, fontFamily: cs.fontFamily, fontWeight: cs.fontWeight,
    bg: cs.backgroundColor, color: cs.color,
    hasTextSm, hasTextXs,
    cls: btn.className,
  };
});
console.log(JSON.stringify(res, null, 1));
await b.close();
