import { test, expect, type Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';

/**
 * 系统信息 E2E（原「系统性能」页改版）。
 *
 * 覆盖：改名后的菜单 / 页头文案、全部区块平铺（无页签）、每条信息独占一行、
 * 数据库区块给的是库本身的信息（不再有定时任务）、打开页面只采集一次快照、
 * 以及旧地址重定向。
 *
 * 接口在这里被拦截并注入完整快照：改版新增 `system` 与数据库元信息字段、
 * 去掉 `scheduler`，本地后端不一定已经重启到最新代码 —— 页面渲染逻辑才是
 * 这里要验证的东西。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

const MOCK_SNAPSHOT = {
  generatedAt: '2026-11-26T10:20:30.000Z',
  durationMs: 8,
  runtime: {
    env: 'development',
    version: '1.0.0',
    uptimeSec: 3600,
    pid: 4242,
    node: 'v22.11.0',
    memory: {
      rssBytes: 256 * 1024 * 1024,
      heapUsedBytes: 128 * 1024 * 1024,
      heapTotalBytes: 200 * 1024 * 1024,
      externalBytes: 4 * 1024 * 1024,
    },
    cpu: { userMs: 60000, systemMs: 30000, cores: 8 },
    eventLoopLagMs: 3.4,
  },
  system: {
    hostname: 'stbui-mac.local',
    platform: 'darwin',
    arch: 'x64',
    kernel: '22.6.0',
    nodeVersion: 'v22.11.0',
    cpu: { model: 'Intel(R) Core(TM) i7-7820HQ CPU @ 2.90GHz', cores: 8 },
    totalMemoryBytes: 16 * 1024 * 1024 * 1024,
    loadavg: [0.12, 0.34, 0.56],
  },
  database: {
    ok: true,
    engine: 'SQLite',
    version: 'SQLite 3.53.2',
    location: '/Users/bright/github/aigc-creation/backend/dev.db',
    sizeBytes: 7 * 1024 * 1024,
    tables: 68,
    migrations: { total: 3, applied: 3, lastAppliedAt: '2026-11-24T06:15:01.000Z' },
    latencyMs: 2,
  },
  storage: {
    ok: true,
    latencyMs: 5,
    backend: 'local',
    message: '可读可写: /Users/bright/github/aigc-creation/backend/uploads',
    cached: false,
  },
  traffic: {
    windowHours: 24,
    tasks: {
      total: 100,
      succeeded: 95,
      failed: 5,
      successRate: 0.95,
      p95DurationMs: 4321,
      byStatus: { succeeded: 95, failed: 5 },
    },
    calls: { total: 200, terminal: 190, failed: 10, p95DurationMs: 512, byKind: { create: 100, poll: 90 } },
    storage: { assets: 300, bytes: 512 * 1024 * 1024 },
    cooling: { blocked: 0, keys: [] },
  },
};

async function login(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${UI}/admin/performance`);
  if (!page.url().includes('/login')) return;

  await page.locator('input[type="email"], input#email').first().fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(ADMIN_PASSWORD);
  await page.locator('input[type="password"]').first().press('Enter');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
}

test.describe('系统信息页', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/admin/system-performance', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: MOCK_SNAPSHOT, message: '' }),
      }),
    );
  });

  test('侧栏菜单与页头使用「系统信息」新名称', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/performance`);
    await expect(page.getByRole('heading', { name: '系统信息' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: '系统信息' })).toBeVisible();
    await expect(page.getByText('系统性能')).toHaveCount(0);
  });

  test('五个区块平铺展示，无页签、无定时任务', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/performance`);
    await expect(page.getByRole('heading', { name: '系统信息' })).toBeVisible({ timeout: 20000 });

    // 没有页签
    await expect(page.getByRole('tablist')).toHaveCount(0);

    for (const title of ['宿主机', '运行时', '数据库', '存储']) {
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
    await expect(
      page.getByRole('heading', { name: '近 24 小时任务与调用' }),
    ).toBeVisible();

    // 定时任务区块已下线（改由 /admin/scheduler 承载）
    await expect(page.getByText('调度器尚未执行过任务')).toHaveCount(0);
  });

  test('每条信息独占一行：主机名与其值同一行', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/performance`);
    const label = page.getByText('主机名：', { exact: true });
    await expect(label).toBeVisible({ timeout: 20000 });

    const row = label.locator('..');
    await expect(row).toHaveText('主机名：stbui-mac.local');
    // 内核、架构、CPU 各自单独一行
    await expect(page.getByText('内核版本：', { exact: true })).toBeVisible();
    await expect(page.getByText('架构：', { exact: true })).toBeVisible();
    await expect(page.getByText('CPU 型号：', { exact: true })).toBeVisible();
    await expect(page.getByText('负载均值：', { exact: true })).toBeVisible();
    // 枚举值换成人能读的名字，不把 darwin / x64 摆到界面上
    await expect(page.getByText('macOS')).toBeVisible();
    await expect(page.getByText('x86-64')).toBeVisible();
    await expect(page.getByText('darwin')).toHaveCount(0);
  });

  test('状态与分布按中文展示，不裸露枚举值', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/performance`);
    await expect(page.getByText('任务状态（全量）：', { exact: true })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByText(/已完成 95 · 失败 5/)).toBeVisible();
    await expect(page.getByText(/创建 100 · 轮询 90/)).toBeVisible();
    await expect(page.getByText('succeeded')).toHaveCount(0);
  });

  test('数据库区块给的是库本身的信息', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/performance`);
    await expect(page.getByText('引擎：', { exact: true })).toBeVisible({ timeout: 20000 });

    await expect(page.getByText('SQLite 3.53.2')).toBeVisible();
    await expect(page.getByText('/Users/bright/github/aigc-creation/backend/dev.db')).toBeVisible();
    await expect(page.getByText(/已应用 3 \/ 共 3/)).toBeVisible();
    await expect(page.getByText('表数量：', { exact: true })).toBeVisible();
    // 不再有「数据库探活」这类读数口径
    await expect(page.getByText('数据库探活')).toHaveCount(0);
  });

  test('不自动轮询，点「刷新」才取新快照', async ({ page }) => {
    await login(page);
    let requests = 0;
    page.on('request', (req) => {
      if (req.url().includes('/admin/system-performance')) requests += 1;
    });

    await page.goto(`${UI}/admin/performance`);
    await expect(page.getByText('主机名：', { exact: true })).toBeVisible({ timeout: 20000 });

    // 首屏请求数不固定（开发档 StrictMode 会双挂载），要看的是「之后不再自己发」
    const initial = requests;
    await page.waitForTimeout(8000);
    expect(requests).toBe(initial);

    await page.getByRole('button', { name: /刷新/ }).click();
    await expect.poll(() => requests, { timeout: 15000 }).toBeGreaterThan(initial);
  });

  test('旧地址 /admin/settings/performance 重定向到 /admin/performance', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/settings/performance`);
    await page.waitForURL((u) => u.pathname === '/admin/performance', { timeout: 20000 });
    await expect(page.getByRole('heading', { name: '系统信息' })).toBeVisible();
  });
});
