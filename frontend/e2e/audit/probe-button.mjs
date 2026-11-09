import { launchChromium } from './browser.mjs';


const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

await page.goto('http://localhost:5100/login', { waitUntil: 'networkidle' });
await page.fill('input[type="email"], input[placeholder*="邮箱"], input[name="email"]', 'admin@admin.com');
await page.fill('input[type="password"]', '123456789');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

await page.goto('http://localhost:5100/admin/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

const report = await page.evaluate(() => {
  const rows = [];
  for (const el of Array.from(document.querySelectorAll('button'))) {
    const text = el.textContent?.trim() ?? '';
    if (!['保存变更', '放弃变更', '撤销', '恢复默认'].includes(text)) continue;
    const cs = getComputedStyle(el);
    rows.push({
      text,
      disabled: el.disabled,
      opacity: cs.opacity,
      bg: cs.backgroundColor,
      color: cs.color,
      pointerEvents: cs.pointerEvents,
    });
  }
  return rows;
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
