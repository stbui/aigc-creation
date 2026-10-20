/**
 * 高级设置补充对拍: popover 内部间距链/ 比例卡与分辨率卡完整盒模型。
 * 用法: node probe-settings2.mjs
 */
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const TARGETS = { ref: 'https://ijihua.cn/free-creation', local: 'http://localhost:5173/free-creation' };

const b = await chromium.launch({ executablePath: EXEC });

for (const kind of ['ref', 'local']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto(TARGETS[kind], { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.locator('.image-output-settings-summary, .pk-settings-summary').first().click();
  await page.waitForTimeout(800);

  const r = await page.evaluate(() => {
    let pop = null;
    for (const s of ['.image-output-settings-popover', '.pk-settings-popover']) { const e = document.querySelector(s); if (e) { pop = e; break; } }
    if (!pop) return null;
    const box = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    const st = (e) => { const c = getComputedStyle(e); return { display: c.display, gap: c.gap, p: c.padding, m: c.margin, bd: c.border, r: c.borderRadius, bg: c.backgroundColor }; };

    // 间距链: popover >各层> 各section > grid > 各button
    const chain = [];
    const walk = (e, depth, label) => {
      const c = getComputedStyle(e);
      chain.push({ depth, label, cls: (e.className.baseVal ?? e.className ?? '').toString().slice(0, 40), box: box(e), ...st(e) });
      [...e.children].forEach((k, i) => walk(k, depth + 1, `${label}>${k.tagName.toLowerCase()}${i}`));
    };
    [...pop.children].forEach((c, i) => walk(c, 0, `pop${i}`));

    // 完整比例卡 / 分辨率卡
    const cards = (sel) => [...pop.querySelectorAll(sel)].map((e) => {
      const c = getComputedStyle(e); const b = e.getBoundingClientRect();
      return { t: (e.innerText || '').replace(/\s+/g, '|').trim().slice(0, 30), box: box(e), bg: c.backgroundColor, bd: c.border, r: c.borderRadius, p: c.padding, display: c.display, gap: c.gap, justify: c.justifyContent, align: c.alignItems, dis: e.disabled === true, cursor: c.cursor, opacity: c.opacity };
    });

    return {
      chain,
      ratioCard: cards('.image-output-ratio-option, .pk-ratio-option'),
      resCard: cards('.image-output-resolution-option, .pk-resolution-option'),
      grids: [...pop.querySelectorAll('[class*="ratio-grid"],[class*="resolution-grid"]')].map((e) => ({ cls: e.className.slice(0, 40), ...st(e), box: box(e) })),
      sections: [...pop.querySelectorAll('[class*="image-output-settings"] section, .pk-settings-group')].map((e) => ({ cls: e.className.slice(0, 40), ...st(e), box: box(e) })),
    };
  });

  console.log(`\n${'═'.repeat(90)}\n${kind.toUpperCase()}\n${'═'.repeat(90)}`);
  console.log('\n── 间距链 ──');
  r.chain.forEach((n) => console.log(`${'  '.repeat(n.depth)}${n.label.padEnd(34 - n.depth * 2)} ${String(n.box).padEnd(20)} ${n.display.padEnd(6)} gap=${String(n.gap).padEnd(8)} p=${n.p.padEnd(14)} m=${n.m}`));
  console.log('\n── grids ──');
  r.grids.forEach((g) => console.log(`  ${g.cls.padEnd(34)} ${String(g.box).padEnd(20)} ${g.display} gap=${g.gap}`));
  console.log('\n── sections ──');
  r.sections.forEach((g) => console.log(`  ${g.cls.padEnd(34)} ${String(g.box).padEnd(20)} ${g.display} gap=${g.gap}`));
  console.log('\n── 比例卡 ──');
  r.ratioCard.forEach((c) => console.log(`  ${c.t.padEnd(6)} ${String(c.box).padEnd(20)} bg=${c.bg.padEnd(21)} bd=${c.bd.padEnd(30)} r=${c.r} p=${c.p}`));
  console.log('\n── 分辨率卡 ──');
  r.resCard.forEach((c) => console.log(`  ${c.t.padEnd(20)} ${String(c.box).padEnd(20)} bg=${c.bg.padEnd(21)} bd=${c.bd.padEnd(30)} r=${c.r} p=${c.p} dis=${c.dis} op=${c.opacity} cur=${c.cursor}`));

  await ctx.close();
}
await b.close();