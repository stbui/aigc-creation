/**
 * Capture public reference UI for local visual comparison.
 * Usage: node reference/ijihua/capture-ui.mjs
 * This file never runs in the product build.
 */
import { chromium } from '../../frontend/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EXEC = process.env.CHROMIUM_PATH || '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const ROOT = new URL('.', import.meta.url).pathname;
const OUT = join(ROOT, 'shots');
const routes = ['/local-redraw','/background-remove','/watermark-remove','/product-retouch','/image-translate','/image-expand','/product-recolor','/rotate-angle'];
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const metrics = [];
for (const viewport of viewports) {
  const ctx = await browser.newContext({ viewport, locale: 'zh-CN', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const route of routes) {
    await page.goto(`https://ijihua.cn${route}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1800);
    const slug = route.slice(1);
    await page.screenshot({ path: join(OUT, `${slug}-${viewport.name}.png`), fullPage: true });
    metrics.push(await page.evaluate(({ route, viewport }) => {
      const q = (sel) => document.querySelector(sel);
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
        return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
          padding: s.padding, margin: s.margin, gap: s.gap, radius: s.borderRadius, border: s.border,
          bg: s.backgroundColor, color: s.color, fontSize: s.fontSize, lineHeight: s.lineHeight,
          display: s.display, gridTemplateColumns: s.gridTemplateColumns, flexDirection: s.flexDirection };
      };
      const pick = (sels) => Object.fromEntries(sels.map((s) => [s, box(q(s))]));
      return {
        route, viewport,
        scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, clientWidth: document.documentElement.clientWidth },
        boxes: pick([
          '.workspace-image-tool-route',
          '.local-redraw-page','.background-remove-page','.watermark-removal-page','.product-retouch-page',
          '.image-translate-page','.smart-expand-page','.product-recolor-page','.rotate-angle-page',
          '.product-retouch-grid','.rotate-angle-grid',
          '.upload-card','.local-redraw-source-upload','.background-upload-card',
          '.image-tool-submit-area','.product-retouch-submit-wrap',
          '.redraw-stage','.background-remove-stage','.image-translate-settings',
          '.smart-expand-page .image-output-ratio-grid','.rotate-angle-controls',
          '.redraw-history','.product-retouch-result','.rotate-angle-result',
        ]),
        text: (document.querySelector('main')?.innerText || document.body.innerText).replace(/\s+/g,' ').trim().slice(-3000),
      };
    }, { route, viewport }));
  }
  await ctx.close();
}
writeFileSync(join(ROOT, 'ui-metrics.json'), JSON.stringify(metrics, null, 2));
await browser.close();
console.log(`captured ${metrics.length} route/viewport pairs -> ${OUT}`);
