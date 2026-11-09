/**
 * 本站 AI 带货图文页对拍探针（验收用）。
 *
 * 用法: node probe-local-shoppable.mjs [1440|1920]
 * 输出: /tmp/designkit-shoppable-carousel/local-<vp>.json + local-<vp>.png
 *
 * 采集口径与参考站探针一致: DOM 骨架 + computed styles 实测值, 不做像素比对。
 */
import { launchChromium } from './browser.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const LOCAL = 'http://localhost:5100/shoppable-carousel';
const OUT_DIR = '/tmp/designkit-shoppable-carousel';
const width = Number(process.argv[2] || 1440);
const height = width === 1440 ? 900 : 1080;

await mkdir(OUT_DIR, { recursive: true });
const browser = await launchChromium({ args: ['--no-proxy-server'] });
const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', deviceScaleFactor: 1 });
const page = await context.newPage();

const dump = await (async () => {
  await page.goto(LOCAL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 用 attached 而非 visible: 卡片在滚动区内, Playwright 的 visible 判定
  // 会因祖先的 mask 渐隐而误判不可见。
  await page.waitForSelector('.sc-template-card', { state: 'attached', timeout: 60000 });
  await page.waitForTimeout(2500);

  return page.evaluate(() => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const cs = (el) => getComputedStyle(el);
    const visible = (el) => { const b = el.getBoundingClientRect(); const s = cs(el); return b.width > 1 && b.height > 1 && s.display !== 'none' && s.visibility !== 'hidden'; };

    const scrollables = Array.from(document.querySelectorAll('*')).filter((el) => {
      const s = cs(el);
      return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 4;
    }).map((el) => ({ cls: String(el.className).slice(0, 60), clientH: el.clientHeight, scrollH: el.scrollHeight }));

    const pane = document.querySelector('.sc-input-pane');
    const showcase = document.querySelector('.sc-showcase');
    const grid = document.querySelector('.sc-template-grid');
    const card = document.querySelector('.sc-template-card');
    const gallery = document.querySelector('.sc-template-gallery');
    const slot = document.querySelector('.sc-template-slot img');

    const catButtons = Array.from(document.querySelectorAll('.sc-category')).filter(visible);
    const tabs = Array.from(document.querySelectorAll('.sc-showcase-tabs button')).filter(visible);

    const submitBtn = Array.from(document.querySelectorAll('button')).find((b) => /生成带货图文|登录后生成/.test(b.textContent || ''));

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrolling: { docScrollH: document.documentElement.scrollHeight, winH: window.innerHeight, scrollables },
      leftPane: pane && { rect: r(pane), bg: cs(pane).backgroundColor },
      rightPane: showcase && { rect: r(showcase), bg: cs(showcase).backgroundColor },
      grid: grid && { rect: r(grid), cols: cs(grid).gridTemplateColumns, gap: cs(grid).gap },
      card: card && { rect: r(card), radius: cs(card).borderRadius, padding: cs(card).padding, border: cs(card).border },
      gallery: gallery && { rect: r(gallery), gap: cs(gallery).gap, bg: cs(gallery).backgroundColor },
      slot: slot && { rect: r(slot), objectFit: cs(slot).objectFit },
      categories: catButtons.map((b) => ({ t: (b.textContent || '').trim(), pressed: b.getAttribute('aria-pressed'), rect: r(b), color: cs(b).color })),
      tabs: tabs.map((b) => ({ t: (b.textContent || '').trim(), cls: b.className, rect: r(b) })),
      cardCount: document.querySelectorAll('.sc-template-card').length,
      submit: submitBtn && { text: (submitBtn.textContent || '').trim().replace(/\n/g, '|'), disabled: submitBtn.disabled },
      hint: document.querySelector('.tool-submit-hint')?.textContent?.trim() || null,
    };
  });
})();

await page.screenshot({ path: `${OUT_DIR}/local-${width}.png`, fullPage: false });
await writeFile(`${OUT_DIR}/local-${width}.json`, JSON.stringify(dump, null, 2));
console.log(JSON.stringify(dump, null, 1));
await browser.close();
