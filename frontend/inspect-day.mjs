import { chromium } from '@playwright/test';
const EXEC='/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b = await chromium.launch({ executablePath: EXEC });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 }, storageState: 'playwright/.auth/admin.json' });
const p = await ctx.newPage();
await p.goto('http://localhost:5100/admin/payments?tab=reconciliation', { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.getByLabel('账单日期').click();
await p.waitForTimeout(800);
const info = await p.evaluate(() => {
  const content = document.querySelector('[data-slot="popover-content"]');
  const btn = document.querySelector('button[data-day]');
  const cs = btn ? getComputedStyle(btn) : null;
  const all = [...document.querySelectorAll('button[data-day]')].slice(0,3).map(x=>{
    const s=getComputedStyle(x); return {d:x.getAttribute('data-day'), bg:s.backgroundColor, font:s.fontFamily, sz:s.fontSize};
  });
  return {
    contentParentChain: (()=>{let e=content,out=[];while(e){out.push(e.tagName+'.'+(e.className||'').split(' ').slice(0,2).join('.'));e=e.parentElement;}return out;})(),
    btnBg: cs?.backgroundColor, btnFont: cs?.fontFamily, btnSize: cs?.fontSize, btnColor: cs?.color,
    all,
    bodyFont: getComputedStyle(document.body).fontFamily,
  };
});
console.log(JSON.stringify(info, null, 2));
await b.close();
