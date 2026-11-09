import { launchChromium } from './browser.mjs';

/**
 * 后台样板页截图（2026-11-01）。
 *
 * 用途：shadcn 迁移过程中肉眼比对「旧骨架 vs 新骨架」的观感。截图落到
 * `/tmp/shot-admin-*.png`，控制台错误一并打印 —— 页面白屏 / 样式丢失在
 * 截图里看得出，但「React 报了个 key 警告」这类只有控制台有。
 */


const TARGETS = [
  { name: 'dashboard', path: '/admin' },
  { name: 'settings', path: '/admin/settings' },
  { name: 'channels', path: '/admin/channels' },
  { name: 'users', path: '/admin/users' },
  { name: 'orders', path: '/admin/orders' },
  { name: 'credits', path: '/admin/credits' },
  { name: 'alerts', path: '/admin/alerts' },
];

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

for (const target of TARGETS) {
  await page.goto(`http://localhost:5100${target.path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `/tmp/shot-admin-${target.name}.png`, fullPage: true });
  console.log(`已截图 ${target.name} → /tmp/shot-admin-${target.name}.png`);
}

console.log('=== console errors ===');
console.log(errors.length ? errors.join('\n') : '(无)');

await browser.close();
