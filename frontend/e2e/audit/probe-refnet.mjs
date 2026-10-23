import { chromium } from 'playwright';
const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b = await chromium.launch({ executablePath: EXEC });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await ctx.newPage();
const hits = [];
page.on('response', async (r) => {
  const u = r.url();
  if (!/\.(js|css|png|jpg|svg|woff2?)$/.test(u)) hits.push(`${r.status()} ${u}`);
});
await page.goto('https://ijihua.cn/free-creation', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);
console.log(hits.join('\n'));
await b.close();
