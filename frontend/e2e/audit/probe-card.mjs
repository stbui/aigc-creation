import { launchChromium } from './browser.mjs';

/**
 * 卡片内距探针（2026-11-01）。
 *
 * shadcn 的 `Card` 基类带 `py-6`（上下 24px 内距）与 `gap-6`（头尾之间 24px 间距），
 * 而 `CardHeader` / `CardContent` 自带 `px-6`（左右 24px）。后台的卡片密度比
 * shadcn 默认紧（全局主导字号 12/13/14，圆角 5 档），这些默认值叠上去会让
 * 卡片内部出现两套内距。这个探针把实际算出来的内距打出来，用于对齐口径。
 */


const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await page.goto('http://localhost:5100/login', { waitUntil: 'networkidle' });
await page.fill('input[type="email"], input[placeholder*="邮箱"], input[name="email"]', 'admin@admin.com');
await page.fill('input[type="password"]', '123456789');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

for (const path of ['/admin', '/admin/settings']) {
  await page.goto(`http://localhost:5100${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const report = await page.evaluate(() => {
    const rows = [];
    for (const el of Array.from(document.querySelectorAll('[data-slot="card"], [data-testid="admin-panel"]'))) {
      const cs = getComputedStyle(el);
      const title = el.querySelector('h2')?.textContent?.trim().slice(0, 12) ?? '(无标题)';
      rows.push({
        title,
        kind: el.getAttribute('data-slot') ?? 'panel',
        pad: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
        gap: cs.gap,
        radius: cs.borderRadius,
      });
      break;
    }
    // 卡片头与内容之间的距离
    const card = document.querySelector('[data-slot="card"]');
    if (card) {
      const header = card.querySelector('[data-slot="card-header"]');
      const content = card.querySelector('[data-slot="card-content"]');
      const hb = header?.getBoundingClientRect();
      const cb = content?.getBoundingClientRect();
      rows.push({
        title: '头尾间距',
        kind: 'gap',
        pad: hb && cb ? `${Math.round(cb.top - hb.bottom)}px` : '(缺)',
        gap: '',
        radius: '',
      });
    }
    return rows;
  });

  console.log(`=== ${path} ===`);
  for (const r of report) console.log(` ${r.title} [${r.kind}] 内距=${r.pad} gap=${r.gap} 圆角=${r.radius}`);
}

await browser.close();
