/**
 * 本仓三处弹层对拍: 素材库导入 / 手机上传 / 高级设置-分辨率。
 * 用法: node probe-local-modals.mjs
 */
import { chromium } from 'playwright';
// 探针查的是某个具体账号下的数据, 凭据必须显式提供（项目已无内置演示账号）
if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) {
  console.error('缺少 E2E_EMAIL / E2E_PASSWORD: 这些探针依赖某个具体账号的素材, 请显式提供凭据。');
  process.exit(1);
}

const EXEC = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const API = process.env.PROBE_API ?? 'http://127.0.0.1:4100/api/v1';
const SITE = process.env.PROBE_SITE ?? 'http://localhost:5100';

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.E2E_EMAIL ?? '', password: process.env.E2E_PASSWORD ?? '' }),
}).then((r) => r.json());

const token = login?.data?.accessToken ?? login?.accessToken;
if (!token) throw new Error('login failed: ' + JSON.stringify(login).slice(0, 300));

const b = await chromium.launch({ executablePath: EXEC });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
await ctx.addInitScript((t) => {
  localStorage.setItem('ecom_vision_token', t);
  localStorage.setItem('ecom_vision_email', process.env.E2E_EMAIL ?? '');
  localStorage.setItem('ecom_vision_role', 'user');
}, token);
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${SITE}/free-creation`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);

const dump = (rootSel, label) =>
  page.evaluate(
    ({ rootSel, label }) => {
      const root = document.querySelector(rootSel);
      if (!root) return `${label}: 未找到 ${rootSel}`;
      const box = (e) => {
        const r = e.getBoundingClientRect();
        return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      };
      const lines = [];
      const walk = (e, d) => {
        const c = getComputedStyle(e);
        const cls = (e.className?.baseVal ?? e.className ?? '').toString().trim();
        const txt = e.childElementCount === 0 ? (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26) : '';
        lines.push(
          `${'  '.repeat(d)}${e.tagName.toLowerCase()}${cls ? '.' + cls.slice(0, 40) : ''} ${box(e)} | d=${c.display} p=${c.padding} m=${c.margin} gap=${c.gap} bd=${c.borderWidth} ${c.borderColor} r=${c.borderRadius} bg=${c.backgroundColor} f=${c.fontSize}/${c.fontWeight}/${c.lineHeight} c=${c.color}${e.disabled ? ' DIS' : ''}${txt ? ' 「' + txt + '」' : ''}`,
        );
        [...e.children].forEach((k) => walk(k, d + 1));
      };
      walk(root, 0);
      return `${label}\n` + lines.join('\n');
    },
    { rootSel, label },
  );

/* ── 1. 素材库导入 ── */
await page.getByRole('button', { name: /从素材库导入/ }).first().click();
await page.waitForTimeout(1800);
console.log(await dump('.alp-modal', '\n════ ALP 素材库导入 ════'));
console.log('\n── ALP 关键类名实际值 ──');
console.log(
  await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const info = (s) => {
      const e = q(s);
      if (!e) return `${s}: 无`;
      const c = getComputedStyle(e);
      const r = e.getBoundingClientRect();
      return `${s} ${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.x)},${Math.round(r.y)} p=${c.padding} gap=${c.gap} bd=${c.borderWidth} ${c.borderColor} r=${c.borderRadius} bg=${c.backgroundColor}`;
    };
    return [
      '.ant-modal',
      '.alp-modal .ant-modal-content',
      '.alp-header',
      '.alp-toolbar',
      '.alp-layout',
      '.alp-sidebar',
      '.alp-content',
      '.alp-grid',
      '.alp-card',
      '.alp-cover',
      '.alp-name',
      '.alp-footer',
      '.alp-btn',
      '.alp-search',
    ].map(info).join('\n');
  }),
);
await page.screenshot({ path: '/tmp/local-alp.png' });

/* 关闭 */
await page.keyboard.press('Escape');
await page.waitForTimeout(900);

/* ── 2. 手机上传 ── */
await page.getByRole('button', { name: /手机上传/ }).first().click();
await page.waitForTimeout(2200);
console.log(await dump('.mum-modal', '\n════ MUM 手机上传 ════'));
await page.screenshot({ path: '/tmp/local-mum.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(900);

/* ── 3. 高级设置 / 分辨率 ── */
await page.locator('.pk-settings-summary').first().click();
await page.waitForTimeout(900);
console.log(await dump('.pk-settings-popover', '\n════ 高级设置弹层 ════'));
await page.screenshot({ path: '/tmp/local-settings.png' });

await b.close();
