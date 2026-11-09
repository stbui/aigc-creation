/**
 * 参考站 shoppable-carousel 布局/交互取证探针（阶段 0）。
 *
 * 用法: node probe-shoppable-layout.mjs [1440|1920]
 * 输出: /tmp/designkit-shoppable-carousel/layout-<vp>.json + shot-<vp>.png
 *
 * 口径: DOM 骨架 + computed styles 实测, 不做像素比对（字体/图片抖动会弄红）。
 */
import { launchChromium } from './browser.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const URL = 'https://www.designkit.cn/shoppable-carousel?from=product_kit_web';
const OUT_DIR = '/tmp/designkit-shoppable-carousel';

const width = Number(process.argv[2] || 1440);
const height = width === 1440 ? 900 : 1080;

const PROPS = [
  'display', 'position', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'gap', 'rowGap', 'columnGap',
  'width', 'height', 'minHeight', 'maxWidth', 'padding', 'margin', 'boxSizing',
  'backgroundColor', 'backgroundImage', 'color', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
  'textAlign', 'borderRadius', 'border', 'borderWidth', 'borderColor', 'borderStyle',
  'boxShadow', 'opacity', 'overflow', 'overflowY', 'objectFit', 'cursor', 'zIndex', 'gridTemplateColumns',
];

await mkdir(OUT_DIR, { recursive: true });
const browser = await launchChromium({ args: ['--no-proxy-server'] });
const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', deviceScaleFactor: 1 });
const page = await context.newPage();

const dump = await (async () => {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[class^="social-media-card-"]', { timeout: 60000 });
  await page.waitForTimeout(5000);

  const result = await page.evaluate((props) => {
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    const styles = (el) => { const cs = getComputedStyle(el); const o = {}; for (const p of props) { const v = cs[p]; if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== 'rgba(0, 0, 0, 0)' && v !== '0px' && v !== 'visible') o[p] = String(v).slice(0, 90); } return o; };
    const visible = (el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 1 && b.height > 1 && cs.display !== 'none' && cs.visibility !== 'hidden'; };

    // 左栏容器: 上传按钮最近的、宽度 < 50% 视口的祖先里最外层那个
    const uploadBtn = document.querySelector('[class^="social-media-uploadButton-"]');
    let leftPane = uploadBtn;
    while (leftPane && leftPane.parentElement && leftPane.parentElement.getBoundingClientRect().width < window.innerWidth * 0.5) {
      if (leftPane.parentElement.getBoundingClientRect().width < 60) break;
      leftPane = leftPane.parentElement;
    }
    // 右栏容器: 分类 tab 条上一级
    const allTplTab = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === '全部模板');
    let rightPane = allTplTab;
    while (rightPane && rightPane.parentElement && rightPane.parentElement.getBoundingClientRect().width < window.innerWidth * 0.75) {
      if (rightPane.parentElement === document.body || rightPane.parentElement.getBoundingClientRect().width < 100) break;
      rightPane = rightPane.parentElement;
    }

    const describe = (el, depth, max) => {
      if (!el || depth > max) return null;
      const kids = Array.from(el.children).filter(visible).map((k) => describe(k, depth + 1, max)).filter(Boolean);
      const leaf = el.children.length === 0;
      return {
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === 'string' ? el.className.slice(0, 90) : '',
        rect: r(el),
        text: leaf ? (el.textContent || '').trim().slice(0, 70) : (el.children.length <= 1 ? '' : ''),
        style: styles(el),
        kids,
      };
    };

    const cards = Array.from(document.querySelectorAll('[class^="social-media-card-"]')).filter(visible);
    const firstCard = cards[0];
    const cardInfo = firstCard ? {
      rect: r(firstCard),
      html: firstCard.outerHTML.slice(0, 2500),
      parts: Array.from(firstCard.querySelectorAll('*')).slice(0, 30).map((el) => ({
        tag: el.tagName.toLowerCase(), cls: typeof el.className === 'string' ? el.className.slice(0, 80) : '',
        rect: r(el), text: (el.children.length === 0 ? (el.textContent || '').trim().slice(0, 60) : ''), style: styles(el),
      })),
    } : null;

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scrolling: { docScrollH: document.documentElement.scrollHeight, winH: window.innerHeight, htmlOverflow: getComputedStyle(document.documentElement).overflow, bodyOverflow: getComputedStyle(document.body).overflow },
      leftPane: leftPane ? { cls: String(leftPane.className).slice(0, 90), rect: r(leftPane), style: styles(leftPane), tree: describe(leftPane, 0, 6) } : null,
      rightPane: rightPane ? { cls: String(rightPane.className).slice(0, 90), rect: r(rightPane), style: styles(rightPane), tree: describe(rightPane, 0, 5) } : null,
      cardCount: cards.length,
      firstCard: cardInfo,
      allButtons: Array.from(document.querySelectorAll('button')).filter(visible).map((b) => ({ t: (b.textContent || '').trim().slice(0, 40), cls: String(b.className).slice(0, 80), rect: r(b), disabled: b.disabled, pressed: b.getAttribute('aria-pressed') })).slice(0, 70),
      inputs: Array.from(document.querySelectorAll('input,textarea,select')).filter(visible).map((el) => ({ tag: el.tagName.toLowerCase(), type: el.type, ph: el.placeholder || '', maxLength: el.maxLength, cls: String(el.className).slice(0, 70), rect: r(el), style: styles(el) })),
    };
  }, PROPS);
  return result;
})();

await page.screenshot({ path: `${OUT_DIR}/shot-${width}.png`, fullPage: false });
await writeFile(`${OUT_DIR}/layout-${width}.json`, JSON.stringify(dump, null, 2));
console.log(`viewport ${width}x${height}: leftPane=${dump.leftPane?.rect.w} rightPane=${dump.rightPane?.rect.w} cards=${dump.cardCount} docScrollH=${dump.scrolling.docScrollH}`);
console.log(`${OUT_DIR}/layout-${width}.json`);

await browser.close();
