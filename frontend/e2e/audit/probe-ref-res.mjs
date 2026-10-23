/** 参考站: 各工具页高级设置弹层里到底渲染了什么 (含分辨率组文案) */
import { chromium } from 'playwright';
const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b = await chromium.launch({ executablePath: EXEC });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
page.on('response', async (r) => {
  const u = r.url();
  if (/\/api\//.test(u) && /resolve|option|config|capab|credit|price/i.test(u)) {
    console.log('[net]', r.status(), u);
  }
});
for (const route of process.argv.slice(2).length ? process.argv.slice(2) : ['/free-creation', '/product-kit', '/product-detail', '/viral-clone']) {
  await page.goto('https://ijihua.cn' + route, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(3500);
  const sums = page.locator('.image-output-settings-summary, .pk-settings-summary');
  const n = await sums.count();
  console.log(`\n=== ${route} summaries=${n}`);
  if (!n) { continue; }
  await sums.first().click();
  await page.waitForTimeout(700);
  const info = await page.evaluate(() => {
    const pop = document.querySelector('.image-output-settings-popover, .pk-settings-popover');
    if (!pop) return null;
    const r = pop.getBoundingClientRect();
    const groups = [...pop.querySelectorAll('.image-output-settings-group, .pk-settings-group')].map((g) => {
      const lab = g.querySelector('.image-output-settings-label, .pk-settings-group-label');
      const opts = [...g.querySelectorAll('button')].map((btn) => {
        const s = btn.querySelector('strong'); const sp = btn.querySelector('span');
        return `${s?.textContent ?? ''}/${sp?.textContent ?? ''}${btn.disabled ? '(disabled)' : ''}`;
      });
      return `${lab?.textContent} [${opts.join(' | ')}]`;
    });
    const head = pop.querySelector('.image-output-settings-popover-head');
    return { box: `${Math.round(r.width)}x${Math.round(r.height)}`, head: head?.textContent, groups, html: pop.innerHTML.length };
  });
  console.log(JSON.stringify(info, null, 1));
  await page.keyboard.press('Escape').catch(() => {});
}
await b.close();
