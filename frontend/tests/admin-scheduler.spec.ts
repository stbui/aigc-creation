import { test, expect, type Page } from '@playwright/test';

/**
 * 定时任务可观测 E2E (admin-prd.md §3.18 B-90 / M9.5)。
 *
 * 核心价值是"让静默失败可见", 故重点验证:
 *   1. 每个任务的状态都能看到 (上次执行/耗时/成败)
 *   2. 只有幂等任务给「立即执行」按钮 —— 备份/清理不给
 *   3. 手动执行直接触发, 不使用确认弹窗
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

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

    /*
     * 行数必须与 `backend/src/admin/scheduler.service.ts` 的 TASK_LABELS 一致。
     * 这里曾写死 5 —— 后来补了 campaign-expire / membership / task-recover 三项,
     * 页面渲染 7 行而断言仍要 5, 红的是断言不是产品。新增任务时同步改这里。
     */
    const TASKS = [
      '订单超时关闭',
      '积分到期回收',
      '数据备份',
      '数据保留期清理',
      '活动到期收尾',
      '会员到期与月度积分',
      '中断任务与会员补发',
    ];
    await expect(page.locator('.adm-task-row')).toHaveCount(TASKS.length, { timeout: 10000 });
    // B-90 的三项必须都在, 其余任务同样不得漏渲染
    for (const label of TASKS) {
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

  test('手动执行直接触发, 不再弹窗确认', async ({ page }) => {
    let runCalls = 0;
    await page.route('**/api/v1/admin/scheduler/run*', async (route) => {
      runCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: { name: 'order-expire' }, message: '' }),
      });
    });

    await login(page);
    await page.goto(`${UI}/admin/scheduler`);
    await page.waitForSelector('.adm-task-row', { timeout: 20000 });

    await page.locator('.adm-task-row', { hasText: '订单超时关闭' })
      .getByRole('button', { name: '立即执行' }).click();

    await expect(page.locator('.ant-modal')).toHaveCount(0);
    await expect(page.locator('.adm-inline-confirm')).toHaveCount(0);
    await expect.poll(() => runCalls).toBe(1);
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
