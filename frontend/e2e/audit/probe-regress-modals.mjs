/**
 * 回归: 其他工具页的高级设置弹层 / 390 宽下的两个弹窗是否溢出。
 * 用法: PROBE_API=... PROBE_SITE=... node probe-regress-modals.mjs
 */
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
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: process.env.E2E_EMAIL ?? '', password: process.env.E2E_PASSWORD ?? '' }),
}).then((r) => r.json());
const token = login?.data?.accessToken ?? login?.accessToken;

const b = await chromium.launch({ executablePath: EXEC });

/* ── 1. 其他工具页: 高级设置弹层 ── */
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await ctx.addInitScript((t) => {
    localStorage.setItem('ecom_vision_token', t);
    localStorage.setItem('ecom_vision_email', process.env.E2E_EMAIL ?? '');
    localStorage.setItem('ecom_vision_role', 'user');
  }, token);
  const page = await ctx.newPage();
  for (const route of ['/product-kit', '/product-detail', '/viral-clone', '/multi-image-fusion']) {
    await page.goto(`${SITE}${route}`, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1500);
    const sum = page.locator('.pk-settings-summary').first();
    if ((await sum.count()) === 0) {
      console.log(`${route}: 无高级设置入口`);
      continue;
    }
    await sum.click();
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const pop = document.querySelector('.pk-settings-popover');
      if (!pop) return null;
      const b = pop.getBoundingClientRect();
      const cards = [...pop.querySelectorAll('.pk-resolution-option')].map((e) => {
        const s = e.querySelector('strong');
        const sp = e.querySelector('span');
        return `${s?.textContent}/${sp?.textContent}`;
      });
      const groups = [...pop.querySelectorAll('.pk-settings-group')].map((g) => {
        const r = g.getBoundingClientRect();
        return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;
      });
      const head = pop.querySelector('.fc-settings-popover-head');
      const docOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      return {
        box: `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`,
        gap: getComputedStyle(pop).gap,
        cards,
        groups,
        hasHead: !!head,
        docOverflow,
      };
    });
    console.log(`${route}: popover ${r?.box} gap=${r?.gap} head=${r?.hasHead} overflow=${r?.docOverflow}`);
    console.log(`    cards: ${r?.cards.join(' | ')}`);
    console.log(`    groups: ${r?.groups.join(' | ')}`);
    await page.keyboard.press('Escape');
  }
  await ctx.close();
}

/* ── 2. 390 宽: 两个弹窗 ── */
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
  await ctx.addInitScript((t) => {
    localStorage.setItem('ecom_vision_token', t);
    localStorage.setItem('ecom_vision_email', process.env.E2E_EMAIL ?? '');
    localStorage.setItem('ecom_vision_role', 'user');
  }, token);
  const page = await ctx.newPage();
  await page.goto(`${SITE}/free-creation`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const measure = async (name) =>
    page.evaluate((name) => {
      const m = document.querySelector(name === 'alp' ? '.alp-modal' : '.mum-modal');
      if (!m) return `${name}: 未打开`;
      const r = m.getBoundingClientRect();
      const inner = m.querySelector('.alp-body, .mum');
      const ir = inner?.getBoundingClientRect();
      return `${name}: modal ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} | inner ${Math.round(ir?.width ?? 0)}x${Math.round(ir?.height ?? 0)} | docScrollW=${document.documentElement.scrollWidth} clientW=${document.documentElement.clientWidth}`;
    }, name);

  await page.getByRole('button', { name: /从素材库导入/ }).first().click();
  await page.waitForTimeout(1500);
  console.log('\n', await measure('alp'));
  await page.screenshot({ path: '/tmp/m-alp-390.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  await page.getByRole('button', { name: /手机上传/ }).first().click();
  await page.waitForTimeout(2000);
  console.log(await measure('mum'));
  await page.screenshot({ path: '/tmp/m-mum-390.png' });
  await ctx.close();
}

await b.close();
