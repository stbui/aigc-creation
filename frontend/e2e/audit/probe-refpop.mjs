/**
 * 参考站「高级设置」弹层全量取证: 完整 HTML + 全部后代盒模型。
 * 用法: node probe-refpop.mjs
 */
import { chromium } from 'playwright';

const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b = await chromium.launch({ executablePath: EXEC });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
await page.goto('https://ijihua.cn/free-creation', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);
await page.locator('.image-output-settings-summary').first().click();
await page.waitForTimeout(800);

const out = await page.evaluate(() => {
  const pop = document.querySelector('.image-output-settings-popover');
  if (!pop) return { err: 'no popover' };
  const box = (e) => {
    const r = e.getBoundingClientRect();
    return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
  };
  const nodes = [];
  const walk = (e, d) => {
    const c = getComputedStyle(e);
    nodes.push({
      d,
      tag: e.tagName.toLowerCase(),
      cls: (e.className.baseVal ?? e.className ?? '').toString(),
      box: box(e),
      txt: (e.childElementCount === 0 ? e.textContent || '' : '').replace(/\s+/g, ' ').trim().slice(0, 40),
      dsp: c.display,
      p: c.padding,
      m: c.margin,
      gap: c.gap,
      bd: c.borderWidth + ' ' + c.borderColor,
      r: c.borderRadius,
      bg: c.backgroundColor,
      fs: c.fontSize,
      fw: c.fontWeight,
      lh: c.lineHeight,
      col: c.color,
      cur: c.cursor,
      dis: e.disabled === true,
    });
    [...e.children].forEach((k) => walk(k, d + 1));
  };
  walk(pop, 0);
  // 该弹层之外, 页面上所有带 resolution 字样的元素
  const others = [...document.querySelectorAll('[class*="resolution"]')]
    .filter((e) => !pop.contains(e))
    .map((e) => ({ cls: (e.className.baseVal ?? e.className ?? '').toString(), box: box(e), txt: (e.innerText || '').replace(/\s+/g, '|').slice(0, 60) }));
  return { html: pop.outerHTML.slice(0, 6000), nodes, others };
});

console.log('── OTHER resolution nodes on page ──');
out.others?.forEach((o) => console.log(`${o.cls.padEnd(50)} ${o.box.padEnd(22)} ${o.txt}`));
console.log('\n── NODES ──');
out.nodes?.forEach((n) => {
  const ind = '  '.repeat(n.d);
  console.log(`${ind}${n.tag}.${n.cls.slice(0, 46)} ${n.box} | d=${n.dsp} p=${n.p} m=${n.m} gap=${n.gap} bd=${n.bd} r=${n.r} bg=${n.bg} f=${n.fs}/${n.fw}/${n.lh} c=${n.col}${n.dis ? ' DISABLED' : ''}${n.txt ? ' 「' + n.txt + '」' : ''}`);
});
console.log('\n── HTML ──\n', out.html);

await b.close();
