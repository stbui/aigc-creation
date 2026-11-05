/**
 * 本站 AI 带货图文页真实交互验证（浏览器内，验收用）。
 *
 * 覆盖五态里的「有结果」: 登录 → 上传真实图 → 选模板 → 提交 → 结果区出现批次行。
 * 截图落在 /tmp/designkit-shoppable-carousel/local-result-1440.png
 */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const CHROME = '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const LOCAL = 'http://localhost:5100/shoppable-carousel';
const EMAIL = 'sc-e2e@test.local';
const PASSWORD = 'Sctest123456';
const OUT = '/tmp/designkit-shoppable-carousel';

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-proxy-server'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
const page = await context.newPage();
const out = {};

// 1. 登录（前端登录弹窗走真实接口）
await page.goto(LOCAL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.sc-template-card', { timeout: 60000 });
await page.waitForTimeout(2000);

// 直接注入 token（与 AuthContext 的 localStorage 键一致），避免依赖登录弹窗 DOM
const token = await page.evaluate(async (creds) => {
  const res = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });
  const json = await res.json();
  return json?.data?.accessToken ?? null;
}, { email: EMAIL, password: PASSWORD });
out.tokenAcquired = Boolean(token);
if (!token) throw new Error('登录失败');

await page.evaluate((t) => {
  localStorage.setItem('huojue_token', t);
  localStorage.setItem('huojue_email', 'sc-e2e@test.local');
  localStorage.setItem('huojue_role', 'user');
}, token);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.sc-template-card', { timeout: 60000 });
await page.waitForTimeout(2500);

// 2. 登录后按钮文案应变成真实文案（不再是「登录后…」）
out.afterLogin = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find((b) => /生成带货图文/.test(b.textContent || ''));
  return { text: btn?.innerText.replace(/\n/g, '|'), disabled: btn?.disabled, hint: document.querySelector('.tool-submit-hint')?.textContent?.trim() ?? null };
});

// 3. 填卖点
await page.fill('.sc-copy-editor textarea', '轻量便携，续航 12 小时，通勤首选');

// 4. 选模板
await page.locator('.sc-template-use').nth(1).click();
await page.waitForTimeout(400);

// 5. 上传真实图片（用仓库内已有的 webp 模板图，浏览器可直接解码）
const fileInput = await page.$('input[type=file]');
await fileInput.setInputFiles('/tmp/product-sample.png');
await page.waitForTimeout(3000);
out.afterUpload = await page.evaluate(() => ({
  thumbs: document.querySelectorAll('.pk-thumb').length,
  count: document.querySelector('.pk-upload-count')?.textContent?.trim() ?? null,
}));

// 6. 提交
const btn = await page.$('button.pk-primary-btn');
out.submitEnabled = await btn.isEnabled();
if (out.submitEnabled) {
  await btn.click();
  await page.waitForTimeout(3000);
}
out.afterSubmit = await page.evaluate(() => ({
  historyCards: document.querySelectorAll('.sc-history-card').length,
  historyTitle: document.querySelector('.sc-history-title')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  templateCards: document.querySelectorAll('.sc-template-card').length,
}));

// 7. 等生成完成：打开「全部记录」看批次明细
for (let i = 0; i < 40; i += 1) {
  await page.waitForTimeout(2000);
  const st = await page.evaluate(async () => {
    const res = await fetch('/api/v1/tasks/page?limit=30&capability=shoppable_carousel', {
      headers: { Authorization: `Bearer ${localStorage.getItem('huojue_token')}` },
    });
    const json = await res.json();
    const items = json.data?.items ?? [];
    return {
      total: items.length,
      pending: items.filter((t) => t.status === 'queued' || t.status === 'running').length,
      succeeded: items.filter((t) => t.status === 'succeeded').length,
      failed: items.filter((t) => t.status === 'failed').length,
    };
  });
  out.final = st;
  if (st.pending === 0) break;
}

// 8. 打开「全部记录」抽屉截图
await page.click('.sc-history-link');
await page.waitForTimeout(1200);
out.drawer = await page.evaluate(() => ({
  open: !!document.querySelector('.ui-modal, [role=dialog]'),
  rows: document.querySelectorAll('.pd-result-row').length,
  toolbar: document.querySelector('.pk-result-toolbar')?.innerText?.replace(/\n/g, ' | ') ?? null,
}));

await page.screenshot({ path: `${OUT}/local-result-1440.png` });
await writeFile(`${OUT}/local-browser.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await browser.close();
