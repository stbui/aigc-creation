import { chromium } from 'playwright';

const CHROME =
  process.env.CHROMIUM_PATH ??
  '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-proxy-server'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await context.newPage();

for (const route of ['/background-remove', '/product-recolor']) {
  await page.goto(`https://ijihua.cn${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  const data = await page.evaluate(() => {
    const root = document.querySelector('.background-color-options');
    if (!root) return null;
    const describe = (el) => {
      const s = getComputedStyle(el);
      const before = getComputedStyle(el, '::before');
      const after = getComputedStyle(el, '::after');
      return {
        tag: el.tagName,
        className: el.className,
        ariaLabel: el.getAttribute('aria-label'),
        ariaChecked: el.getAttribute('aria-checked'),
        html: el.innerHTML,
        rect: el.getBoundingClientRect().toJSON(),
        style: {
          width: s.width,
          height: s.height,
          borderRadius: s.borderRadius,
          border: s.border,
          background: s.backgroundColor,
          backgroundImage: s.backgroundImage,
          color: s.color,
          boxShadow: s.boxShadow,
          position: s.position,
          display: s.display,
        },
        before: {
          content: before.content,
          background: before.backgroundColor,
          backgroundImage: before.backgroundImage,
          width: before.width,
          height: before.height,
          borderRadius: before.borderRadius,
        },
        after: {
          content: after.content,
          background: after.backgroundColor,
          backgroundImage: after.backgroundImage,
          width: after.width,
          height: after.height,
          borderRadius: after.borderRadius,
          color: after.color,
          fontSize: after.fontSize,
        },
      };
    };
    return {
      root: describe(root),
      children: [...root.children].map(describe),
    };
  });
  console.log(`\n=== ${route}\n${JSON.stringify(data, null, 2)}`);

  const lightBlue = page.locator('.background-color-option').nth(2);
  if (await lightBlue.count()) {
    await lightBlue.click();
    await page.waitForTimeout(300);
    console.log(
      `\nselected #2 ${route}:`,
      await lightBlue.evaluate((el) => ({
        className: el.className,
        html: el.innerHTML,
        style: {
          border: getComputedStyle(el).border,
          background: getComputedStyle(el).backgroundColor,
          boxShadow: getComputedStyle(el).boxShadow,
        },
      })),
    );
  }
}

await browser.close();
