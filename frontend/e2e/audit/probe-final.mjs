/**
 * 末轮 probe: 主按钮 enabled 态 / 分辨率卡片细节 / hover 态 / 空态插画 —— 补齐清单证据。
 * 用法: node probe-final.mjs
 */
import { chromium } from 'playwright';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const TARGETS = { ref: 'https://ijihua.cn/free-creation', local: 'http://localhost:5100/free-creation' };

const b = await chromium.launch({ executablePath: EXEC });

for (const kind of ['ref', 'local']) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto(TARGETS[kind], { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // ① 输入提示词 → 主按钮 enabled 态
  const ta = page.locator('textarea').first();
  await ta.fill('测试提示词');
  await page.waitForTimeout(600);
  const enabled = await page.evaluate(() => {
    const el = document.querySelector('.free-submit-area .primary-btn, .pk-submit-actions .pk-primary-btn');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { disabled: el.disabled, text: el.innerText.replace(/\s+/g, ' ').trim(), opacity: cs.opacity, bg: cs.backgroundColor, bgi: cs.backgroundImage, color: cs.color, html: el.outerHTML.slice(0, 300) };
  });
  console.log(`\n════ ${kind} 主按钮 enabled 态 ════`);
  console.log(JSON.stringify(enabled, null, 2));

  // ② 高级设置 popover 内 分辨率/比例 卡片
  await page.locator('.image-output-settings-summary, .pk-settings-summary').first().click();
  await page.waitForTimeout(700);
  const cards = await page.evaluate(() => {
    const pop = document.querySelector('.image-output-settings-popover, .pk-settings-popover');
    if (!pop) return null;
    const labels = [...pop.querySelectorAll('*')].filter((e) => e.children.length === 0 && (e.innerText || '').trim()).map((e) => ({ t: e.innerText.trim().slice(0, 24), fs: getComputedStyle(e).fontSize, fw: getComputedStyle(e).fontWeight, c: getComputedStyle(e).color }));
    const opts = [...pop.querySelectorAll('button,[role=button],label')].map((e) => {
      const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
      return { text: e.innerText.replace(/\s+/g, ' ').trim().slice(0, 30), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], fs: cs.fontSize, c: cs.color, bg: cs.backgroundColor, bd: cs.border, dis: e.disabled === true || e.getAttribute('aria-disabled') === 'true', r: cs.borderRadius };
    });
    const groups = [...pop.children].map((c) => ({ cls: c.className, box: (() => { const r = c.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() }));
    return { labels, opts, groups, groupGap: getComputedStyle(pop).gap };
  });
  console.log(`\n════ ${kind} popover 卡片 ════`);
  console.log(JSON.stringify(cards, null, 2).slice(0, 3200));

  // ③ 空态插画
  const empty = await page.evaluate(() => {
    const img = document.querySelector('.workspace-empty-state-image, .pk-empty-illustration, .pk-empty-illustration svg, .pk-preview-inner svg');
    if (!img) return null;
    const cs = getComputedStyle(img); const r = img.getBoundingClientRect();
    return { tag: img.tagName, cls: img.className?.baseVal ?? img.className, src: img.getAttribute('src')?.slice(0, 80) || '(inline svg)', box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
  });
  console.log(`\n════ ${kind} 空态插画 ════`, JSON.stringify(empty, null, 2));

  await page.screenshot({ path: join(OUT, `${kind}-enabled.png`) });
  await ctx.close();
}
await b.close();