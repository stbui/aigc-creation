/**
 * 补充 probe:
 *   ① ref/local 主按钮 disabled 属性 + disabled 时 computed (对照"禁用是否淡出")
 *   ② 高级设置 popover 展开态对拍
 *   ③ 顶部 promo 条 / 侧边栏 hover guide 差异
 * 用法: node probe-extra.mjs
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

  // ① 主按钮 disabled 精确态
  const btn = await page.evaluate(() => {
    const el = document.querySelector('.free-submit-area .primary-btn, .pk-submit-actions .pk-primary-btn');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      cls: el.className,
      disabled: el.disabled,
      ariaDisabled: el.getAttribute('aria-disabled'),
      text: el.innerText.replace(/\s+/g, ' ').trim(),
      opacity: cs.opacity,
      bg: cs.backgroundColor,
      bgi: cs.backgroundImage,
      color: cs.color,
      cursor: cs.cursor,
      fs: cs.fontSize, fw: cs.fontWeight, lh: cs.lineHeight, gap: cs.gap, p: cs.padding, r: cs.borderRadius,
      strongFs: (() => { const s = el.querySelector('strong'); return s ? getComputedStyle(s).fontSize : ''; })(),
      strongFw: (() => { const s = el.querySelector('strong'); return s ? getComputedStyle(s).fontWeight : ''; })(),
      strongLh: (() => { const s = el.querySelector('strong'); return s ? getComputedStyle(s).lineHeight : ''; })(),
    };
  });
  console.log(`\n════ ${kind} 主按钮 disabled 态 ════`);
  console.log(JSON.stringify(btn, null, 2));

  // ② 高级设置 popover 展开
  const sum = page.locator('.image-output-settings-summary, .pk-settings-summary').first();
  await sum.click();
  await page.waitForTimeout(800);
  const pop = await page.evaluate(() => {
    const sels = ['.image-output-settings-popover', '.pk-settings-popover', '.fc-settings-popover'];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const groups = [...el.children].map((c) => {
        const g = getComputedStyle(c);
        const gr = c.getBoundingClientRect();
        return { cls: c.className, text: c.innerText.replace(/\s+/g, ' ').trim().slice(0, 40), box: [Math.round(gr.x), Math.round(gr.y), Math.round(gr.width), Math.round(gr.height)], gap: g.gap, pad: g.padding };
      });
      return { sel: s, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], r: cs.borderRadius, p: cs.padding, sh: cs.boxShadow, z: cs.zIndex, pos: cs.position, bottom: cs.bottom, groups };
    }
    return null;
  });
  console.log(`\n════ ${kind} 高级设置 popover ════`);
  console.log(JSON.stringify(pop, null, 2).slice(0, 2400));
  await page.screenshot({ path: join(OUT, `${kind}-popover.png`) });

  await ctx.close();
}
await b.close();