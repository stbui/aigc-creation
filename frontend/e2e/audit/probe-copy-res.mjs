/** 分辨率组文案实拍: 标题 + 每张卡的 strong/span/禁用态 */
import { chromium } from 'playwright';
// 探针查的是某个具体账号下的数据, 凭据必须显式提供（项目已无内置演示账号）
if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) {
  console.error('缺少 E2E_EMAIL / E2E_PASSWORD: 这些探针依赖某个具体账号的素材, 请显式提供凭据。');
  process.exit(1);
}
const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const API = process.env.PROBE_API ?? 'http://127.0.0.1:4200/api/v1';
const SITE = process.env.PROBE_SITE ?? 'http://localhost:5200';
const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.E2E_EMAIL ?? '', password: process.env.E2E_PASSWORD ?? '' }),
}).then((r) => r.json());
const token = login?.data?.accessToken ?? login?.accessToken;
const b = await chromium.launch({ executablePath: EXEC });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
await ctx.addInitScript((t) => {
  localStorage.setItem('ecom_vision_token', t);
  localStorage.setItem('ecom_vision_email', process.env.E2E_EMAIL ?? '');
  localStorage.setItem('ecom_vision_role', 'user');
}, token);
const page = await ctx.newPage();
for (const route of ['/free-creation', '/product-kit', '/product-detail', '/viral-clone', '/multi-image-fusion']) {
  await page.goto(`${SITE}${route}`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  const sum = page.locator('.pk-settings-summary').first();
  if (!(await sum.count())) {
    // multi-fusion 用独立入口
    const alt = page.locator('button:has-text("高级设置"), .multi-image-fusion-settings-toggle').first();
    if (!(await alt.count())) { console.log(`${route}: 无入口`); continue; }
    await alt.click();
  } else {
    await sum.click();
  }
  await page.waitForTimeout(600);
  const out = await page.evaluate(() => {
    const pop = document.querySelector('.pk-settings-popover');
    if (!pop) return null;
    const label = [...pop.querySelectorAll('.pk-settings-group-label, .image-output-settings-label')].map((e) => e.textContent.trim());
    const cards = [...pop.querySelectorAll('.pk-resolution-option, .multi-image-fusion-resolution-option')].map((c) => ({
      strong: c.querySelector('strong')?.textContent,
      span: c.querySelector('span')?.textContent,
      dis: c.disabled,
      title: c.getAttribute('title'),
    }));
    return { label, cards };
  });
  console.log(`${route}:`, JSON.stringify(out));
  await page.keyboard.press('Escape');
}
await b.close();
