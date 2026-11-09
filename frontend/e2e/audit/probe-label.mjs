import { launchChromium } from './browser.mjs';

/**
 * 标签关联探针（2026-11-01）。
 *
 * 验证后台控件的 `<label for>` 与控件 `id` 在真实浏览器里真的配上了 ——
 * jsdom 的 getByLabel 与浏览器的可访问名计算规则不完全一致，只有真实浏览器
 * 才能证明「屏幕阅读器读得出这个输入框叫什么」。
 */


const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:5100/login', { waitUntil: 'networkidle' });
await page.fill(
  'input[type="email"], input[placeholder*="邮箱"], input[name="email"]',
  'admin@admin.com',
);
await page.fill('input[type="password"]', '123456789');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

await page.goto('http://localhost:5100/admin/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.getByRole('tab', { name: /上传/ }).click();
await page.waitForTimeout(600);

/* ① 设置项控件的可访问名来自 aria-label（表格行内，没有 <label>） */
const controlNames = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('input[type="text"], input[type="number"]'));
  return rows.map((el) => ({
    ariaLabel: el.getAttribute('aria-label'),
    id: el.id || null,
    labels: Array.from(el.labels ?? []).map((l) => l.textContent?.trim()),
  }));
});
console.log('=== 设置项控件 ===');
console.log(JSON.stringify(controlNames, null, 2));

/* ② 弹层里的「变更原因」输入：FormField 的 label 必须真的关联到它 */
/* 先改一个值，「保存变更」才可点（无变更时按钮是禁用的） */
const firstNumber = page.locator('input[type="number"]').first();
await firstNumber.fill('12');
await page.waitForTimeout(400);
await page.getByRole('button', { name: '保存变更' }).click();
await page.waitForTimeout(800);

const reasonInfo = await page.evaluate(() => {
  const el = document.querySelector('#adm-setting-reason');
  if (!el) return { found: false };
  return {
    found: true,
    id: el.id,
    labels: Array.from(el.labels ?? []).map((l) => l.textContent?.trim()),
    ariaLabel: el.getAttribute('aria-label'),
    // 浏览器实际算出来的可访问名
    accessibleName: el.labels?.[0]?.textContent?.trim() ?? null,
  };
});
console.log('=== 变更原因输入 ===');
console.log(JSON.stringify(reasonInfo, null, 2));

/* ③ Playwright 自己的 getByLabel 能不能命中 */
try {
  const byLabel = page.getByLabel('变更原因（写入审计）');
  const count = await byLabel.count();
  console.log(`getByLabel('变更原因（写入审计）') 命中 ${count} 个`);
} catch (e) {
  console.log(`getByLabel 失败: ${e.message}`);
}

console.log('=== console errors ===');
console.log(errors.length ? errors.join('\n') : '(无)');

await browser.close();
