import { chromium } from '@playwright/test';
const EXEC='/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b = await chromium.launch({ executablePath: EXEC });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, storageState: 'playwright/.auth/admin.json' });
const p = await ctx.newPage();
await p.goto('http://localhost:5100/admin/payments?tab=reconciliation', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
// open a select dropdown
await p.getByLabel('筛选渠道').click();
await p.waitForTimeout(600);
const info = await p.evaluate(() => {
  const content = document.querySelector('[data-slot="select-content"]');
  const item = document.querySelector('[data-slot="select-item"]');
  const cs = item ? getComputedStyle(item) : null;
  return {
    selectExists: !!content,
    itemFont: cs?.fontFamily, itemSize: cs?.fontSize, itemColor: cs?.color, itemBg: cs?.backgroundColor,
    contentHasAdminPortal: content?.className.includes('admin-portal'),
    parentChain: (()=>{let e=content,out=[];while(e){out.push(e.tagName+'.'+String(e.className||'').split(' ').slice(0,3).join('.'));e=e.parentElement;}return out;})(),
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
