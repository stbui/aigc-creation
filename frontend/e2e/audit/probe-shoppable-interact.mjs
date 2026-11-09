/**
 * 参考站 shoppable-carousel 交互/状态取证探针（阶段 0 第二轮）。
 *
 * 覆盖: 卡片文案结构 / 模式切换 / 选中态 / 数量步进范围 / 滚动归属 / 顶栏与历史。
 * 输出: /tmp/designkit-shoppable-carousel/interact.json
 */
import { launchChromium } from './browser.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const URL = 'https://www.designkit.cn/shoppable-carousel?from=product_kit_web';
const OUT_DIR = '/tmp/designkit-shoppable-carousel';
await mkdir(OUT_DIR, { recursive: true });

const browser = await launchChromium({ args: ['--no-proxy-server'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await context.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('[class^="social-media-card-"]', { timeout: 60000 });
await page.waitForTimeout(5000);

const out = {};

// ── 1. 卡片文案结构 ──
out.cardText = await page.evaluate(() => {
  const card = document.querySelector('[class^="social-media-card-"]');
  const details = card?.querySelector('[class^="social-media-details-"]');
  return {
    cardInnerText: (card?.innerText || '').slice(0, 200),
    detailsHTML: details?.innerHTML.slice(0, 600),
    detailsText: (details?.innerText || '').slice(0, 200),
  };
});

// ── 2. 顶栏 (新建任务) 与页面外层结构 ──
out.topbar = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === '新建任务');
  const bar = btn?.closest('header,div,nav');
  const outer = document.querySelector('[class^="social-media-page"],[class^="social-media-app"],[class^="social-media-root"]');
  const chain = [];
  let el = btn;
  while (el && el !== document.body) { chain.push({ tag: el.tagName, cls: String(el.className).slice(0, 80), rect: (() => { const b = el.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}@${Math.round(b.x)},${Math.round(b.y)}`; })() }); el = el.parentElement; }
  return { chain, outerCls: outer ? String(outer.className) : null, bodyChildren: Array.from(document.body.children).map((c) => ({ tag: c.tagName, cls: String(c.className).slice(0, 80), rect: (() => { const b = c.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}@${Math.round(b.y)}`; })() })) };
});

// ── 3. 滚动归属 ──
out.scroll = await page.evaluate(() => {
  const findScrollable = () => Array.from(document.querySelectorAll('*')).filter((el) => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4;
  }).map((el) => ({ cls: String(el.className).slice(0, 70), clientH: el.clientHeight, scrollH: el.scrollHeight }));
  return { scrollable: findScrollable(), winScrollH: document.documentElement.scrollHeight, winH: window.innerHeight };
});

// ── 4. 数量步进器取值 ──
out.stepper = await page.evaluate(() => {
  const minus = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === '−' || b.textContent?.trim() === '-');
  const plus = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === '+');
  const wrap = minus?.parentElement;
  return { wrapText: (wrap?.innerText || '').replace(/\n/g, ' | '), minusDisabled: minus?.disabled, plusDisabled: plus?.disabled, wrapHTML: (wrap?.innerHTML || '').slice(0, 500) };
});

// 点 + 直到禁用, 记录上界
out.stepperRange = await (async () => {
  const plus = await page.$('button:has-text("+")');
  const minus = await page.$('button:has-text("−")');
  const read = () => page.evaluate(() => {
    const m = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === '−' || b.textContent?.trim() === '-');
    return (m?.parentElement?.innerText || '').replace(/\n/g, '|');
  });
  const seen = [await read()];
  for (let i = 0; i < 25; i += 1) {
    if (!plus || await plus.isDisabled()) break;
    await plus.click({ timeout: 2000 }).catch(() => {});
    seen.push(await read());
  }
  const maxText = seen[seen.length - 1];
  // 归零
  for (let i = 0; i < 40; i += 1) {
    if (!minus || await minus.isDisabled()) break;
    await minus.click({ timeout: 2000 }).catch(() => {});
  }
  return { sequence: Array.from(new Set(seen)), maxText, afterReset: await read() };
})();

// ── 5. 卡片选中态 (hover + click) ──
out.cardStates = await (async () => {
  const card = await page.$('[class^="social-media-card-"]');
  const box = await card.boundingBox();
  const before = await card.evaluate((el) => ({ cls: el.className, border: getComputedStyle(el).border, shadow: getComputedStyle(el).boxShadow, bg: getComputedStyle(el).backgroundColor }));
  await page.mouse.move(box.x + box.width / 2, box.y + 10);
  await page.waitForTimeout(400);
  const hover = await card.evaluate((el) => ({ cls: el.className, border: getComputedStyle(el).border, shadow: getComputedStyle(el).boxShadow }));
  const selectBtn = await card.$('[class^="social-media-selectButton-"]');
  await selectBtn.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(600);
  const selected = await card.evaluate((el) => ({ cls: el.className, border: getComputedStyle(el).border, shadow: getComputedStyle(el).boxShadow, bg: getComputedStyle(el).backgroundColor, useBtnText: el.querySelector('[class^="social-media-useButton-"]')?.textContent }));
  return { before, hover, selected };
})();

// ── 6. 模式切换: 点「模板生成」 ──
out.modeSwitch = await (async () => {
  const tpl = await page.$('button:has-text("模板生成")');
  await tpl?.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800);
  return page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('[class^="social-media-option-"]')).map((el) => ({ t: el.innerText.replace(/\n/g, ' | ').slice(0, 60), pressed: el.getAttribute('aria-pressed'), cls: el.className, border: getComputedStyle(el).border, bg: getComputedStyle(el).backgroundColor }));
    const gen = Array.from(document.querySelectorAll('button')).find((b) => /生成带货图文|立即|生成/.test(b.textContent || '') && b.className.includes('generate'));
    return { options: opts, generateText: gen?.innerText.replace(/\n/g, ' | '), generateDisabled: gen?.disabled };
  });
})();

// ── 7. 生成模式切回 AI, 观察右栏是否变化 ──
out.afterModeSwitch = await page.evaluate(() => ({
  cardCount: document.querySelectorAll('[class^="social-media-card-"]').length,
  rightHeaderText: document.querySelector('[class^="social-media-recipeHeader-"]')?.innerText.replace(/\n/g, ' | ').slice(0, 120),
}));

await writeFile(`${OUT_DIR}/interact.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1).slice(0, 6000));
await browser.close();
