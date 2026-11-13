import { chromium } from 'playwright';

const UI = 'http://localhost:5100';
const API = 'http://127.0.0.1:4101';
const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';

const res = await fetch(`${API}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@admin.com', password: '123456789' }),
});
const json = await res.json();
const token = json.data.accessToken;

const browser = await chromium.launch({ executablePath: EXEC });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript((t) => {
  localStorage.setItem('huojue_token', t);
  localStorage.setItem('huojue_email', 'admin@admin.com');
  localStorage.setItem('huojue_role', 'admin');
}, token);
const page = await ctx.newPage();
const target = process.argv[2] ?? '/admin/capabilities?tab=overview&id=main_image';
const out = process.argv[3] ?? '/tmp/cap-overview.png';
await page.goto(`${UI}${target}`);
await page.waitForTimeout(3000);
await page.screenshot({ path: out, fullPage: true });
console.log('saved', out);
await browser.close();
