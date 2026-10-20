import { test, expect, type Page } from '@playwright/test';

/**
 * 定时任务可观测 E2E (admin-prd.md §3.18 B-90 / M9.5)。
 *
 * 核心价值是"让静默失败可见", 故重点验证:
 *   1. 每个任务的状态都能看到 (上次执行/耗时/成败)
 *   2. 只有幂等任务给「立即执行」按钮 —— 备份/清理不给
 *   3. 手动执行走二次确认
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5173';

async function login(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${UI}/login`);
  await page.locator('input[type="email"], input#email').first().fill('admin@huojue.local');
  await page.locator('input[type="password"]').first().fill(process.env.ADMIN_PASSWORD ?? '');
  await page.locator('input[type="password"]').first().press('Enter');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
}

test.describe('定时任务', () => {
  test.skip(!process.env.ADMIN_PASSWORD, '未提供 ADMIN_PASSWORD');

  test('页面渲染全部任务', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/scheduler`);
    await expect(page.getByRole('heading', { name: '定时任务' })).toBeVisible({ timeout: 20000 });

    await expect(page.locator('.adm-task-row')).toHaveCount(5, { timeout: 10000 });
    // B-90 的三项必须都在
    for (const label of ['订单超时关闭', '积分到期回收', '数据备份']) {
      await expect(page.locator('.adm-task-row', { hasText: label })).toBeVisible();
    }
  });

  test('每行显示上次执行与耗时', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/scheduler`);
    await page.waitForSelector('.adm-task-row', { timeout: 20000 });

    const firstRow = page.locator('.adm-task-row').first();
    await expect(firstRow.locator('.adm-task-meta')).toContainText('上次执行');
  });

  test('只有幂等任务有「立即执行」按钮', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/scheduler`);
    await page.waitForSelector('.adm-task-row', { timeout: 20000 });

    // 订单/积分 有按钮
    await expect(
      page.locator('.adm-task-row', { hasText: '订单超时关闭' }).getByRole('button', { name: '立即执行' }),
    ).toBeVisible();
    await expect(
      page.locator('.adm-task-row', { hasText: '积分到期回收' }).getByRole('button', { name: '立即执行' }),
    ).toBeVisible();

    // 备份/清理 不该有 —— 它们会写文件或删数据
    await expect(
      page.locator('.adm-task-row', { hasText: '数据备份' }).getByRole('button', { name: '立即执行' }),
    ).toHaveCount(0);
    await expect(
      page.locator('.adm-task-row', { hasText: '数据保留期清理' }).getByRole('button', { name: '立即执行' }),
    ).toHaveCount(0);
  });

  test('手动执行走二次确认并说明幂等', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/scheduler`);
    await page.waitForSelector('.adm-task-row', { timeout: 20000 });

    await page.locator('.adm-task-row', { hasText: '订单超时关闭' })
      .getByRole('button', { name: '立即执行' }).click();

    await expect(page.locator('.adm-modal-title')).toContainText('立即执行');
    // 应说明影响范围与幂等性
    await expect(page.locator('.adm-confirm-impact')).toContainText('超时');
    await expect(page.locator('.adm-confirm-impact')).toContainText('幂等');

    await page.getByRole('button', { name: '取消' }).click();
  });

  test('设计说明解释可触发与不可触发', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/scheduler`);
    await expect(page.locator('.adm-panel-title', { hasText: '设计说明' })).toBeVisible({ timeout: 20000 });

    const notes = await page.locator('.adm-note-list').innerText();
    expect(notes).toContain('幂等');
    expect(notes).toContain('失败隔离');
    // 解释为什么备份/清理不能手动触发
    expect(notes).toContain('覆盖可用备份');
  });

  test('侧栏入口已注册', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/scheduler`);
    await expect(page.locator('.adm-sider-item.is-active')).toContainText('定时任务');
  });
});
