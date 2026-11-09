import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

/**
 * 描边颜色探针（2026-11-01）。
 *
 * 用途：验证 shadcn 组件的描边颜色。项目样式表刻意不导入 Tailwind preflight，
 * `border` 单独出现时颜色会退回 `currentColor`（实测 shadcn 的 outline 按钮
 * 渲染成近黑色 `oklch(0.145 0 none)`）。修法是在 base 层给 `[data-slot]`
 * 兜底 `border-color`，但这条兜底必须**低于** utilities 层，否则会盖掉
 * `border-transparent`（徽章 / 开关 / 页签都靠它隐藏描边）。
 *
 * 判据：
 *   - `border` 无颜色类 → 应为 rgb(229, 231, 239)（--border）
 *   - `border-transparent` → 应为 rgba(0, 0, 0, 0)
 */

const LOCAL_CHROMIUM_PATH =
  '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';

const browser = await chromium.launch({
  executablePath: existsSync(LOCAL_CHROMIUM_PATH) ? LOCAL_CHROMIUM_PATH : undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await page.goto('http://localhost:5100/login', { waitUntil: 'networkidle' });
await page.fill('input[type="email"], input[placeholder*="邮箱"], input[name="email"]', 'admin@admin.com');
await page.fill('input[type="password"]', '123456789');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

await page.goto('http://localhost:5100/admin', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const report = await page.evaluate(() => {
  const rows = [];
  for (const el of Array.from(document.querySelectorAll('[data-slot]'))) {
    const cs = getComputedStyle(el);
    const w = cs.borderTopWidth;
    if (!w || w === '0px') continue;
    const cls = el.getAttribute('class') ?? '';
    const hasExplicitColor = /border-(transparent|input|primary|ring|destructive|background)/.test(cls);
    rows.push({
      slot: el.getAttribute('data-slot'),
      variant: el.getAttribute('data-variant'),
      color: cs.borderTopColor,
      hasExplicitColor,
    });
  }
  return rows;
});

const bare = report.filter((r) => !r.hasExplicitColor);
const explicit = report.filter((r) => r.hasExplicitColor);

console.log('=== 只写 border 不写颜色（应落到 --border 兜底） ===');
for (const r of bare) console.log(` ${r.slot}${r.variant ? '/' + r.variant : ''} → ${r.color}`);

console.log('=== 显式颜色类（必须仍是它自己的颜色） ===');
for (const r of explicit) console.log(` ${r.slot}${r.variant ? '/' + r.variant : ''} → ${r.color}`);

await browser.close();
