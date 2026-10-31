import { test, expect, type Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';

/**
 * 定时任务可观测 E2E (admin-prd.md §3.18 B-90 / M9.5)。
 *
 * 核心价值是"让静默失败可见", 故重点验证:
 *   1. 每个任务的状态都能看到 (上次执行/耗时/成败)
 *   2. 只有幂等任务给「立即执行」按钮 —— 备份/清理不给
 *   3. 手动执行直接触发, 不使用确认弹窗
 *
 * 选择器：任务行 `data-testid="admin-task-row"`（带 `data-task` 名称）。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

const taskRows = (page: Page) => page.getByTestId('admin-task-row');

async function login(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  /*
   * 本套件复用 admin-auth.setup.ts 落盘的登录态。此时直接打开 /login 会被
   * 重定向到工作台，页面上根本没有邮箱输入框。先访问后台目标页；只有真的
   * 落在登录页（单独运行本文件、没有 storageState 时）才补一次登录。
   */
  await page.goto(`${UI}/admin/scheduler`);
  if (!page.url().includes('/login')) return;

  await page.locator('input[type="email"], input#email').first().fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(ADMIN_PASSWORD);
  await page.locator('input[type="password"]').first().press('Enter');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
}

test.describe('定时任务', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

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
    await expect(taskRows(page)).toHaveCount(TASKS.length, { timeout: 10000 });
    // B-90 的三项必须都在, 其余任务同样不得漏渲染
    for (const label of TASKS) {
      await expect(taskRows(page).filter({ hasText: label })).toBeVisible();
    }
  });

  test('每行显示上次执行与耗时', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/scheduler`);
    await taskRows(page).first().waitFor({ state: 'visible', timeout: 20000 });

    await expect(taskRows(page).first()).toContainText('上次执行');
    await expect(taskRows(page).first()).toContainText(/耗时|累计/);
  });

  test('只有幂等任务有「立即执行」按钮', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/scheduler`);
    await taskRows(page).first().waitFor({ state: 'visible', timeout: 20000 });

    // 订单/积分 有按钮
    for (const label of ['订单超时关闭', '积分到期回收']) {
      await expect(
        taskRows(page).filter({ hasText: label }).getByRole('button', { name: '立即执行' }),
      ).toBeVisible();
    }

    // 备份/清理 不该有 —— 它们会写文件或删数据
    for (const label of ['数据备份', '数据保留期清理']) {
      await expect(
        taskRows(page).filter({ hasText: label }).getByRole('button', { name: '立即执行' }),
      ).toHaveCount(0);
    }
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
    await taskRows(page).first().waitFor({ state: 'visible', timeout: 20000 });

    await taskRows(page)
      .filter({ hasText: '订单超时关闭' })
      .getByRole('button', { name: '立即执行' })
      .click();

    await expect(page.getByTestId('admin-modal')).toHaveCount(0);
    await expect(page.getByTestId('admin-confirm-action')).toHaveCount(0);
    await expect.poll(() => runCalls).toBe(1);
  });

  test('设计说明解释可触发与不可触发', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/scheduler`);
    const panel = page
      .getByTestId('admin-panel')
      .filter({ has: page.getByRole('heading', { name: '设计说明' }) });
    await expect(panel).toBeVisible({ timeout: 20000 });

    const notes = await panel.innerText();
    expect(notes).toContain('幂等');
    expect(notes).toContain('失败隔离');
    // 解释为什么备份/清理不能手动触发
    expect(notes).toContain('覆盖可用备份');
  });

  test('侧栏入口已注册', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/scheduler`);
    await expect(
      page.getByTestId('admin-sider').locator('button[aria-current="page"]'),
    ).toContainText('定时任务');
  });
});
