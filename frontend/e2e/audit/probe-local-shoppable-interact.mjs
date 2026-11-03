/**
 * 本站 AI 带货图文页交互态验证（验收用）。
 *
 * 覆盖: 模板选中态 / 分类切换 / 模式切换 / 步进器边界 / 生成按钮三态。
 * 输出: /tmp/designkit-shoppable-carousel/local-interact.json
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const CHROME = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const LOCAL = 'http://localhost:5100/shoppable-carousel';
const OUT = '/tmp/designkit-shoppable-carousel/local-interact.json';

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-proxy-server'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })).newPage();
await page.goto(LOCAL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.sc-template-card', { timeout: 60000 });
await page.waitForTimeout(2000);

const out = {};

// 1. 初始态
out.initial = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => /生成带货图文/.test(b.textContent || ''));
  return {
    submitText: btn?.innerText.replace(/\n/g, '|'),
    submitDisabled: btn?.disabled,
    hint: document.querySelector('.tool-submit-hint')?.textContent?.trim() ?? null,
    selectedCards: document.querySelectorAll('.sc-template-card.is-selected').length,
    modePressed: Array.from(document.querySelectorAll('.sc-mode-option')).map((b) => b.getAttribute('aria-pressed')),
    count: document.querySelector('input[aria-label="生成张数"]')?.value,
    minusDisabled: document.querySelector('button[aria-label="减少张数"]')?.disabled,
    plusDisabled: document.querySelector('button[aria-label="增加张数"]')?.disabled,
  };
});

// 2. 步进器边界: 减号在 6 时应已禁用（参考站实测同）
out.stepperAfterMinus = await page.evaluate(() => ({
  count: document.querySelector('input[aria-label="生成张数"]')?.value,
  minusDisabled: document.querySelector('button[aria-label="减少张数"]')?.disabled,
}));
for (let i = 0; i < 8; i += 1) {
  const dis = await page.$eval('button[aria-label="增加张数"]', (b) => b.disabled);
  if (dis) break;
  await page.click('button[aria-label="增加张数"]');
  await page.waitForTimeout(120);
}
out.stepperAfterPlus = await page.evaluate(() => ({
  count: document.querySelector('input[aria-label="生成张数"]')?.value,
  plusDisabled: document.querySelector('button[aria-label="增加张数"]')?.disabled,
}));

// 3. 选中模板 → 模式自动切到「模板生成」
await page.click('.sc-template-card:nth-child(2) .sc-template-use');
await page.waitForTimeout(500);
out.afterSelect = await page.evaluate(() => {
  const card = document.querySelector('.sc-template-card.is-selected');
  const btn = Array.from(document.querySelectorAll('button')).find((b) => /生成带货图文/.test(b.textContent || ''));
  return {
    selectedName: card?.querySelector('.sc-template-title')?.textContent,
    useText: card?.querySelector('.sc-template-use')?.textContent,
    selectedBorder: card ? getComputedStyle(card).borderColor : null,
    modePressed: Array.from(document.querySelectorAll('.sc-mode-option')).map((b) => b.getAttribute('aria-pressed')),
    submitText: btn?.innerText.replace(/\n/g, '|'),
    submitDisabled: btn?.disabled,
    hint: document.querySelector('.tool-submit-hint')?.textContent?.trim() ?? null,
  };
});

// 4. 分类切换
await page.click('button.sc-category:has-text("美妆/个护")');
await page.waitForTimeout(600);
out.afterCategory = await page.evaluate(() => ({
  cardCount: document.querySelectorAll('.sc-template-card').length,
  activeCategory: document.querySelector('.sc-category.is-active')?.textContent,
  firstCard: document.querySelector('.sc-template-title')?.textContent,
}));

// 5. 切回「AI 智能生成」模式
await page.click('.sc-mode-option:has-text("AI 智能生成")');
await page.waitForTimeout(400);
out.afterAiMode = await page.evaluate(() => ({
  modePressed: Array.from(document.querySelectorAll('.sc-mode-option')).map((b) => b.getAttribute('aria-pressed')),
  hint: document.querySelector('.tool-submit-hint')?.textContent?.trim() ?? null,
}));

// 6. 模板区常驻 + 底部历史条
out.structure = await page.evaluate(() => ({
  templateCards: document.querySelectorAll('.sc-template-card').length,
  categoriesVisible: document.querySelectorAll('.sc-category').length,
  historyTitle: document.querySelector('.sc-history-title')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  historyEmpty: document.querySelector('.sc-history-empty')?.textContent?.trim() ?? null,
}));

await writeFile(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await browser.close();
