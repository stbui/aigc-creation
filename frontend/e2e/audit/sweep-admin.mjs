import { launchChromium } from './browser.mjs';

/**
 * 后台全路由巡检（2026-11-01，shadcn 迁移期）。
 *
 * 逐条打开后台路由，收集控制台错误与页面异常，并对重点页截图。
 * 迁移期用它替代「一页一页点」—— 白屏、样式丢失、key 冲突都会在这里冒出来。
 */


const ROUTES = [
  'alerts', 'users', 'roles', 'settings', 'backups', 'assets', 'storage',
  'coupons', 'campaigns', 'marketing-rules', 'scheduler', 'channels', 'logical-models',
  'user-groups', 'plugins', 'billing-orders', 'finance', 'model-calls', 'capabilities',
  'tasks', 'tickets', 'products', 'membership-plans', 'orders', 'credits',
  'retention', 'payments', 'invoices', 'legal', 'notifications',
  'aigc-label',
];

const SHOTS = new Set(['roles', 'campaigns', 'marketing-rules', 'storage', 'scheduler', 'aigc-label', 'logical-models', 'tickets']);

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`${current} :: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`${current} :: pageerror ${e.message}`));
let current = 'login';

await page.goto('http://localhost:5100/login', { waitUntil: 'networkidle' });
await page.fill('input[type="email"], input[placeholder*="邮箱"]', 'admin@admin.com');
await page.fill('input[type="password"]', '123456789');
await page.click('button[type="submit"]');
await page.waitForTimeout(2500);

for (const route of ROUTES) {
  current = route;
  await page.goto(`http://localhost:5100/admin/${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const text = await page.locator('main').innerText().catch(() => '');
  const blank = text.trim().length < 10;
  const title = text.split('\n')[0] ?? '';
  console.log(`${blank ? '⚠ 空' : '✓'} ${route} — ${title.slice(0, 30)}`);
  if (SHOTS.has(route)) {
    await page.screenshot({ path: `/tmp/sweep-${route}.png`, fullPage: false });
  }
}

console.log('=== console errors ===');
console.log(errors.length ? [...new Set(errors)].join('\n') : '(无)');
await browser.close();
