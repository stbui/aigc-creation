import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const CHROME =
  process.env.CHROMIUM_PATH ??
  '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const OUT = '/tmp/aigc-local-redraw-compare';
const REFERENCE = 'https://ijihua.cn/local-redraw';
const LOCAL = process.env.LOCAL_UI ?? 'http://127.0.0.1:5100/local-redraw';
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '390x844', width: 390, height: 844 },
];

const SELECTORS = [
  '.local-redraw-page',
  '.pk-workspace.local-redraw-page',
  '.local-redraw-settings',
  '.pk-input-pane',
  '.upload-card',
  '.pk-config-card',
  '.local-redraw-source-upload',
  '.pk-upload-prompt',
  '.image-tool-submit-area',
  '.pk-submit-actions',
  '.redraw-submit',
  '.pk-primary-btn',
  '.local-redraw-stage',
  '.pk-source-pane.redraw-stage',
  '.redraw-intro',
  '.redraw-intro-video',
  '.redraw-intro-art',
  '.redraw-intro-copy',
  '.redraw-canvas-wrap',
  '.redraw-toolbar',
  '.redraw-stage-topbar',
  '.canvas-footer-toolbar',
  '.redraw-canvas-footer',
  '.shortcut-hint',
  '.redraw-shortcut-hint',
  '.redraw-history',
  '.redraw-history-pane',
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-proxy-server'] });

async function snapshot(page, label, viewport) {
  await page.goto(label.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(label.url === REFERENCE ? 5000 : 2500);
  await page.screenshot({ path: `${OUT}/${label.name}-${viewport.name}.png` });
  return page.evaluate(({ selectors, labelName, viewport }) => {
    const measure = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        x: +r.x.toFixed(1),
        y: +r.y.toFixed(1),
        width: +r.width.toFixed(1),
        height: +r.height.toFixed(1),
        padding: s.padding,
        margin: s.margin,
        gap: s.gap,
        borderRadius: s.borderRadius,
        background: s.backgroundColor,
        color: s.color,
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        display: s.display,
        position: s.position,
        overflow: `${s.overflowX}/${s.overflowY}`,
        gridTemplateColumns: s.gridTemplateColumns,
      };
    };
    return {
      label: labelName,
      viewport,
      url: location.href,
      scroll: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
      },
      boxes: Object.fromEntries(selectors.map((selector) => [selector, measure(selector)])),
      text: (document.querySelector('main')?.innerText ?? document.body.innerText).replace(/\s+/g, ' ').trim().slice(-3000),
    };
  }, { selectors: SELECTORS, labelName: label.name, viewport });
}

const results = [];
try {
  for (const viewport of VIEWPORTS) {
    for (const label of [
      { name: 'reference', url: REFERENCE },
      { name: 'local', url: LOCAL },
    ]) {
      const context = await browser.newContext({ viewport, locale: 'zh-CN', deviceScaleFactor: 1 });
      const page = await context.newPage();
      results.push(await snapshot(page, label, viewport));
      await context.close();
    }
  }
  await writeFile(`${OUT}/metrics.json`, JSON.stringify(results, null, 2));
  console.log(`saved ${results.length} snapshots -> ${OUT}`);
} finally {
  await browser.close();
}
