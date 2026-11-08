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
  const before = {};
  const cells = [...document.querySelectorAll('[role="gridcell"]')];
  const outsideCell = cells.find(c => c.getAttribute('data-outside') === 'true');
  const normalCell = cells.find(c => c.getAttribute('data-outside') !== 'true');
  const desc = (c) => { const b=c.querySelector('button'); const cs=getComputedStyle(b); const td=getComputedStyle(c);
    return { day:c.getAttribute('data-day'), tdColor: td.color, btnColor: cs.color, btnBg: cs.backgroundColor, btnFont: cs.fontFamily.slice(0,20) }; };
  before.outside = desc(outsideCell);
  before.normal = desc(normalCell);
  // apply fix: add admin-portal to the popover content
  const pop = document.querySelector('[data-slot="popover-content"]');
  pop.classList.add('admin-portal');
  const after = {};
  after.outside = desc(outsideCell);
  after.normal = desc(normalCell);
  return { before, after };
});
console.log(JSON.stringify(res, null, 1));
await p.screenshot({ path: '/tmp/c-fix.png' });
await b.close();
