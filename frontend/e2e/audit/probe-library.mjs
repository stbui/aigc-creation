/** 素材库是否显示某条素材: 逐站点实测 */
import { chromium } from 'playwright';
// 探针查的是某个具体账号下的数据, 凭据必须显式提供（项目已无内置演示账号）
if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) {
  console.error('缺少 E2E_EMAIL / E2E_PASSWORD: 这些探针依赖某个具体账号的素材, 请显式提供凭据。');
  process.exit(1);
}
const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const TARGET = 'cmvhqvow30002gk69vzuwxqe7';
const sites = [
  { site: 'http://localhost:5100', api: 'http://127.0.0.1:4100' },
  { site: 'http://localhost:5274', api: 'http://127.0.0.1:4100' },
  { site: 'http://localhost:5200', api: 'http://127.0.0.1:4200' },
];
const b = await chromium.launch({ executablePath: EXEC });
for (const { site, api } of sites) {
  const login = await fetch(`${api}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: process.env.E2E_EMAIL ?? '', password: process.env.E2E_PASSWORD ?? '' }),
  }).then((r) => r.json()).catch(() => null);
  const token = login?.data?.accessToken;
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem('ecom_vision_token', t);
    localStorage.setItem('ecom_vision_email', process.env.E2E_EMAIL ?? '');
    localStorage.setItem('ecom_vision_role', 'user');
  }, token ?? '');
  const page = await ctx.newPage();
  let apiTotal = null;
  page.on('response', async (r) => {
    if (/\/api\/v1\/assets\?/.test(r.url())) {
      try { const j = await r.json(); apiTotal = j?.data?.total; } catch {}
    }
  });
  await page.goto(`${site}/library`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500);
  const info = await page.evaluate((id) => {
    const txt = document.body.innerText;
    return {
      hasNew: txt.includes('mvhqvovw0ql4s7'),
      imgs: document.querySelectorAll('img').length,
      headline: (txt.match(/共\s*\d+\s*个素材|\d+\s*个素材/) || [''])[0],
      empty: /暂无|还没有/.test(txt),
    };
  }, TARGET);
  console.log(`${site} (api total=${apiTotal}):`, JSON.stringify(info));
  await ctx.close();
}
await b.close();
