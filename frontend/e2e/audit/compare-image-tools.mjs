/**
 * 参考站 vs 本地：8 个图像工具页（本脚本默认跑 7 个）盒模型对拍。
 *
 * 用法: node e2e/audit/compare-image-tools.mjs [route ...]
 * 产物: /tmp/aigc-image-tools-compare/<route>/<label>-<viewport>.png + metrics.json
 *
 * 采集口径：关键节点 getBoundingClientRect + computed style，不做像素 diff。
 * 参考站 class 与本地 class 不同，因此按「同一语义节点」成对映射。
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const CHROME =
  process.env.CHROMIUM_PATH ??
  '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const OUT = '/tmp/aigc-image-tools-compare';
const REF_BASE = 'https://ijihua.cn';
const LOCAL_BASE = process.env.LOCAL_UI ?? 'http://127.0.0.1:5100';
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
];

const NODES = {
  page: ['.local-redraw-page', '.pk-workspace.local-redraw-page'],
  uploadCard: ['.upload-card', '.pk-config-card'],
  dropzone: ['.local-redraw-source-upload', '.pk-dropzone'],
  submitArea: ['.image-tool-submit-area', '.pk-submit-actions'],
  submitBtn: ['.redraw-submit', '.pk-primary-btn'],
  history: ['.redraw-history', '.redraw-history-pane'],
  result: ['.product-retouch-result', '.pk-result-pane'],
  stage: ['.background-remove-stage', '.pk-result-pane'],
  controls: ['.rotate-angle-controls', '.rotate-angle-controls'],
  translateSettings: ['.image-translate-settings', '.image-translate-settings'],
  intro: ['.redraw-intro', '.redraw-intro'],
  introArt: ['.redraw-intro-video', '.redraw-intro-video'],
  introCopy: ['.redraw-intro-copy', '.redraw-intro-copy'],
  introVideo: ['.redraw-intro-video', '.redraw-intro-video'],
  emptyState: ['.image-tool-empty-state', '.pk-preview-placeholder'],
  emptyMedia: ['.image-tool-empty-state-media', '.pk-empty-illustration'],
  backgroundEmpty: ['.background-remove-empty', '.background-remove-empty'],
  backgroundEmptyMedia: ['.background-remove-empty video', '.background-remove-empty video'],
};

const ROUTES = [
  { path: '/image-expand', page: ['.smart-expand-page', '.pk-workspace.smart-expand-page'] },
  { path: '/background-remove', page: ['.background-remove-page', '.pk-workspace.background-remove-page'] },
  { path: '/watermark-remove', page: ['.watermark-removal-page', '.pk-workspace.watermark-removal-page'] },
  { path: '/image-translate', page: ['.image-translate-page', '.pk-workspace.image-translate-page'] },
  { path: '/product-retouch', page: ['.product-retouch-page', '.pk-workspace.product-retouch-page'] },
  { path: '/product-recolor', page: ['.product-recolor-page', '.pk-workspace.product-recolor-page'] },
  { path: '/rotate-angle', page: ['.rotate-angle-page', '.pk-workspace.rotate-angle-page'] },
];

const only = process.argv.slice(2);
const selected = only.length ? ROUTES.filter((r) => only.some((p) => r.path.includes(p))) : ROUTES;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-proxy-server'] });

async function measure(page, selector) {
  return page.evaluate((selector) => {
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
      fontSize: s.fontSize,
      display: s.display,
      position: s.position,
      overflow: `${s.overflowX}/${s.overflowY}`,
      gridTemplateColumns: s.gridTemplateColumns,
    };
  }, selector);
}

async function snapshot(route, viewport) {
  const out = { route: route.path, viewport, reference: {}, local: {} };
  for (const [label, base] of [
    ['reference', REF_BASE],
    ['local', LOCAL_BASE],
  ]) {
    const context = await browser.newContext({ viewport, locale: 'zh-CN', deviceScaleFactor: 1 });
    const page = await context.newPage();
    const dir = `${OUT}${route.path}`;
    await mkdir(dir, { recursive: true });
    try {
      await page.goto(`${base}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(label === 'reference' ? 4000 : 2200);
      await page.screenshot({ path: `${dir}/${label}-${viewport.name}.png` });
      out[label].scroll = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
      }));
      const pairs = { ...NODES, page: route.page };
      for (const [key, [refSel, localSel]] of Object.entries(pairs)) {
        const selector = label === 'reference' ? refSel : localSel;
        out[label][key] = await measure(page, selector);
      }
    } catch (e) {
      out[label].error = String(e).slice(0, 300);
    } finally {
      await context.close();
    }
  }
  return out;
}

const fmt = (b) => (b ? `${b.width}x${b.height}@${b.x},${b.y}` : 'null');
const results = [];
try {
  for (const route of selected) {
    for (const viewport of VIEWPORTS) {
      const row = await snapshot(route, viewport);
      results.push(row);
      console.log(`\n=== ${route.path} ${viewport.name}`);
      console.log(`scroll ref=${row.reference.scroll?.height} local=${row.local.scroll?.height}`);
      if (row.reference.error) console.log('REF ERROR', row.reference.error);
      if (row.local.error) console.log('LOCAL ERROR', row.local.error);
      for (const key of Object.keys({ ...NODES, page: route.page })) {
        const r = row.reference[key];
        const l = row.local[key];
        if (!r && !l) continue;
        const dx = r && l ? +(l.width - r.width).toFixed(1) : null;
        const dy = r && l ? +(l.height - r.height).toFixed(1) : null;
        const px = r && l ? +(l.x - r.x).toFixed(1) : null;
        const py = r && l ? +(l.y - r.y).toFixed(1) : null;
        const flag = r && l && (dx !== 0 || dy !== 0 || px !== 0 || py !== 0) ? '  <-- DIFF' : '';
        console.log(`  ${key}: ref=${fmt(r)} local=${fmt(l)} d=${dx}x${dy} pos=${px},${py}${flag}`);
      }
    }
  }
  await writeFile(`${OUT}/metrics.json`, JSON.stringify(results, null, 2));
  console.log(`\nsaved -> ${OUT}/metrics.json`);
} finally {
  await browser.close();
}
