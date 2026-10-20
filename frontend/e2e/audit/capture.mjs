/**
 * 参考站 vs 本地 /free-creation 实拍对拍探针。
 *
 * 用法: node capture.mjs [ref|local|diff]
 *   - ref:   抓 https://ijihua.cn/free-creation → out/ref.json + out/ref.png
 *   - local: 抓 http://localhost:5173/free-creation → out/local.json + out/local.png
 *   - diff:  读两份 json 输出结构/文案/尺寸差异
 *
 * 采集口径: 只取"树形骨架 + 关键节点 computed style", 不做像素比对。
 * 像素比对会被字体渲染/图片资源抖动弄红, 骨架+数值才是可复现事实。
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });

const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';

const TARGETS = {
  ref: 'https://ijihua.cn/free-creation',
  local: 'http://localhost:5173/free-creation',
};

const PROPS = [
  'display', 'position', 'width', 'height', 'minHeight', 'maxWidth',
  'padding', 'margin', 'gap', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems',
  'backgroundColor', 'backgroundImage', 'color', 'fontSize', 'fontWeight', 'lineHeight',
  'fontFamily', 'letterSpacing', 'textAlign', 'borderRadius', 'border', 'borderColor', 'borderWidth',
  'boxShadow', 'opacity', 'overflow', 'overflowY', 'objectFit', 'zIndex', 'transform',
];

/** 页内执行: 抽取可见 DOM 骨架 + computed styles */
const EXTRACT = (props) => {
  const round = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v);
  const styleOf = (el) => {
    const cs = getComputedStyle(el);
    const out = {};
    for (const p of props) {
      const val = cs[p];
      if (val === undefined || val === '' || val === 'none' || val === 'normal' || val === 'auto') continue;
      out[p] = round(val);
    }
    return out;
  };
  const walk = (el, depth) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0 || r.height === 0) return null;
    const node = {
      tag: el.tagName.toLowerCase(),
      cls: (el.getAttribute('class') || '').trim(),
      text: el.children.length === 0 ? round(el.textContent || '').slice(0, 120) : undefined,
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      style: styleOf(el),
      kids: [],
    };
    for (const child of el.children) {
      const k = walk(child, depth + 1);
      if (k) node.kids.push(k);
    }
    return node;
  };
  const root = document.querySelector('#root') || document.body;
  return walk(root, 0);
};

/** 页内执行: 抓所有可见文案 + 图片 src + 交互元素签名 */
const INVENTORY = () => {
  const round = (v) => (v || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  const texts = [...document.querySelectorAll('body *')]
    .filter((el) => el.children.length === 0 && visible(el))
    .map((el) => round(el.textContent))
    .filter((t) => t.length > 0);

  const buttons = [...document.querySelectorAll('button,[role=button],a')]
    .filter(visible)
    .map((el) => ({
      text: round(el.textContent).slice(0, 40),
      tag: el.tagName.toLowerCase(),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      box: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
      bg: getComputedStyle(el).backgroundColor,
      color: getComputedStyle(el).color,
      radius: getComputedStyle(el).borderRadius,
    }));

  const inputs = [...document.querySelectorAll('input,textarea,[contenteditable=true]')]
    .filter(visible)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      placeholder: el.getAttribute('placeholder') || '',
      maxlength: el.getAttribute('maxlength') || '',
      rows: el.getAttribute('rows') || '',
      box: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
    }));

  const imgs = [...document.querySelectorAll('img')]
    .filter(visible)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { src: (el.getAttribute('src') || '').slice(0, 140), alt: el.getAttribute('alt') || '', box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
    });

  const svgCount = document.querySelectorAll('svg').length;

  return { texts: [...new Set(texts)], buttons, inputs, imgs, svgCount, title: document.title, url: location.href };
};

async function capture(kind) {
  const b = await chromium.launch({ executablePath: EXEC });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'zh-CN' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 160)); });

  await page.goto(TARGETS[kind], { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: join(OUT, `${kind}.png`), fullPage: false });

  const inventory = await page.evaluate(INVENTORY);
  const tree = await page.evaluate(EXTRACT, PROPS);

  writeFileSync(join(OUT, `${kind}-inventory.json`), JSON.stringify(inventory, null, 2));
  writeFileSync(join(OUT, `${kind}-tree.json`), JSON.stringify(tree, null, 2));
  console.log(`[${kind}] ${TARGETS[kind]} → out/${kind}.png  buttons=${inventory.buttons.length} inputs=${inventory.inputs.length} texts=${inventory.texts.length} errors=${errors.length}`);
  if (errors.length) console.log('  errors:', errors.slice(0, 5).join(' | '));
  await b.close();
}

const mode = process.argv[2] || 'ref';
if (mode === 'ref' || mode === 'local') await capture(mode);
else console.log('usage: node capture.mjs ref|local');