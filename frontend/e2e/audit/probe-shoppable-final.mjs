/**
 * 参考站 shoppable-carousel 取证探针（阶段 0 第三轮，收尾）。
 *
 * 覆盖: 比例下拉全量选项 / 空表单提交行为 / 模式切换时右栏可见性 / 顶栏内容 / 截图。
 * 输出: /tmp/designkit-shoppable-carousel/final.json + shot-1440.png + shot-1920.png
 */
import { launchChromium } from './browser.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const URL = 'https://www.designkit.cn/shoppable-carousel?from=product_kit_web';
const OUT_DIR = '/tmp/designkit-shoppable-carousel';
await mkdir(OUT_DIR, { recursive: true });

const browser = await launchChromium({ args: ['--no-proxy-server'] });
const out = {};

/** 打开第 idx 个 posterSelect，读取其可见下拉里的选项 */
async function readSelect(page, idx) {
  const fields = await page.$$('[class^="social-media-posterSelectField-"]');
  const trigger = await fields[idx].$('.ant-select');
  await trigger.click();
  await page.waitForTimeout(500);
  const options = await page.evaluate(() => {
    const dds = Array.from(document.querySelectorAll('.ant-select-dropdown')).filter((d) => !d.className.includes('hidden') && d.getBoundingClientRect().height > 0);
    const dd = dds[dds.length - 1];
    return dd ? Array.from(dd.querySelectorAll('.ant-select-item-option')).map((o) => o.innerText.trim()) : [];
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return options;
}

{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[class^="social-media-card-"]', { timeout: 60000 });
  await page.waitForTimeout(5000);

  // 生成设置四个下拉的完整选项
  out.selects = [];
  for (let i = 0; i < 4; i += 1) out.selects.push(await readSelect(page, i));

  // 顶栏内容
  out.header = await page.evaluate(() => {
    const h = document.querySelector('[class^="social-media-socialMediaHeader-"]');
    return { text: h?.innerText.replace(/\n/g, ' | '), html: (h?.innerHTML || '').slice(0, 1200) };
  });

  // 空表单点生成
  const gen = await page.$('button[class*="generate"]');
  out.generateBefore = { text: (await gen.innerText()).replace(/\n/g, '|'), disabled: await gen.isDisabled() };
  await gen.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1500);
  out.emptySubmit = await page.evaluate(() => {
    const notices = Array.from(document.querySelectorAll('.ant-message-notice, .ant-message span, [class*="message"]')).map((e) => e.innerText.trim()).filter(Boolean);
    // 上传区是否出现错误提示
    const upload = document.querySelector('[class^="social-media-uploadDropzone-"]');
    return { notices: [...new Set(notices)].slice(0, 6), uploadClass: String(upload?.className), uploadBorder: upload ? getComputedStyle(upload).border : null, url: location.href };
  });

  // 模式切到 AI 后, 右栏模板网格是否还在视口内可见
  const tplBtn = await page.$('button:has-text("模板生成")');
  await tplBtn.click().catch(() => {});
  await page.waitForTimeout(600);
  await (await page.$('button:has-text("AI 智能生成")')).click().catch(() => {});
  await page.waitForTimeout(900);
  out.rightPaneAfterAi = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[class^="social-media-card-"]'));
    const vis = cards.filter((c) => { const b = c.getBoundingClientRect(); return b.width > 1 && b.height > 1 && getComputedStyle(c).display !== 'none'; });
    const showcase = document.querySelector('[class^="social-media-showcase-"]');
    return { total: cards.length, visible: vis.length, showcaseDisplay: showcase ? getComputedStyle(showcase).display : null, showcaseW: showcase?.getBoundingClientRect().width };
  });

  await page.screenshot({ path: `${OUT_DIR}/shot-1440.png` });
  // 右栏单独截图
  const showcase = await page.$('[class^="social-media-showcase-"]');
  if (showcase) await showcase.screenshot({ path: `${OUT_DIR}/shot-right-1440.png` });
  const sidebar = await page.$('[class^="social-media-sidebar-"]');
  if (sidebar) await sidebar.screenshot({ path: `${OUT_DIR}/shot-left-1440.png` });
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[class^="social-media-card-"]', { timeout: 60000 });
  await page.waitForTimeout(5000);
  out.vp1920 = await page.evaluate(() => {
    const sidebar = document.querySelector('[class^="social-media-sidebar-"]');
    const showcase = document.querySelector('[class^="social-media-showcase-"]');
    const grid = document.querySelector('[class^="social-media-showcaseTemplateList-"]');
    const card = document.querySelector('[class^="social-media-card-"]');
    const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      sidebar: sidebar && r(sidebar), showcase: showcase && r(showcase), grid: grid && r(grid), card: card && r(card),
      gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      gap: grid ? getComputedStyle(grid).gap : null,
    };
  });
  await page.screenshot({ path: `${OUT_DIR}/shot-1920.png` });
  await ctx.close();
}

await writeFile(`${OUT_DIR}/final.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await browser.close();
