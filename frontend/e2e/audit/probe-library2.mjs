import { chromium } from 'playwright';
// 探针查的是某个具体账号下的数据, 凭据必须显式提供（项目已无内置演示账号）
if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) {
  console.error('缺少 E2E_EMAIL / E2E_PASSWORD: 这些探针依赖某个具体账号的素材, 请显式提供凭据。');
  process.exit(1);
}
const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const b = await chromium.launch({ executablePath: EXEC });
const login = await fetch('http://127.0.0.1:4100/api/v1/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.E2E_EMAIL ?? '', password: process.env.E2E_PASSWORD ?? '' }),
}).then((r) => r.json());
const token = login.data.accessToken;
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((t) => {
  localStorage.setItem('ecom_vision_token', t);
  localStorage.setItem('ecom_vision_email', process.env.E2E_EMAIL ?? '');
  localStorage.setItem('ecom_vision_role', 'user');
}, token);
const page = await ctx.newPage();
await page.goto('http://localhost:5200/library', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const out = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('img')].map((i) => i.getAttribute('src'));
  const cards = [...document.querySelectorAll('[class*="asset-card"], [class*="library"] [class*="card"]')].slice(0, 3).map((c) => c.innerText.replace(/\n/g, ' | ').slice(0, 80));
  return { firstImgs: imgs.slice(0, 5), hit: imgs.filter((s) => s && s.includes('mvhqvovw0ql4s7')), total: imgs.length, cards };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
