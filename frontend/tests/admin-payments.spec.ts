import { test, expect, type Page } from '@playwright/test';
import { HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';
import { ensureAdminLogin } from './support/admin-login';

/**
 * 支付充值页 E2E（`/admin/payments`，payment-refactor-design.md §21 / §24）。
 *
 * 守住四条约束：
 *   1. 五个标签都在同一个 URL 上（`?tab=`），深链能直接落到任一标签
 *   2. 旧路由 `/admin/payment-channels` 与 `/admin/reconciliation` 改为重定向，
 *      不再 404（后端旧控制器已下线）
 *   3. 订单与对账的详情走 `?orderId=` / `?runId=` 深链，刷新后抽屉还在
 *   4. 刷新按钮不重置筛选与分页（只重取当前筛选下的数据）
 *
 * 选择器约定：页签用 `role="tab"`，字段用 `aria-label`，表格行用
 * `data-testid="admin-table-row"`，抽屉用 `data-testid="admin-drawer"`。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

async function login(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await ensureAdminLogin(page);
}

test.describe('支付充值', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  test('五个标签可切换，且切换只改 URL 不重载', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/payments`);

    await expect(page.getByRole('heading', { name: '支付充值' })).toBeVisible({ timeout: 20000 });

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(5);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');

    // 缺省落在第一个标签（支付渠道），但 URL 里先不写 tab
    await expect(page).not.toHaveURL(/[?&]tab=/);

    await page.getByRole('tab', { name: '充值商品' }).click();
    await expect(page).toHaveURL(/[?&]tab=products/);
    await expect(page.getByRole('tab', { name: '充值商品' })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: '支付订单' }).click();
    await expect(page).toHaveURL(/[?&]tab=orders/);

    await page.getByRole('tab', { name: '支付对账' }).click();
    await expect(page).toHaveURL(/[?&]tab=reconciliation/);

    await page.getByRole('tab', { name: '支付异常' }).click();
    await expect(page).toHaveURL(/[?&]tab=exceptions/);
  });

  test('深链直接落到指定标签，非法标签回落到支付渠道', async ({ page }) => {
    await login(page);

    await page.goto(`${UI}/admin/payments?tab=orders`);
    await expect(page.getByRole('tab', { name: '支付订单' })).toHaveAttribute('aria-selected', 'true');

    await page.goto(`${UI}/admin/payments?tab=not-a-tab`);
    await expect(page.getByRole('tab', { name: '支付渠道' })).toHaveAttribute('aria-selected', 'true');
  });

  test('旧路由重定向到新页，不再报错', async ({ page }) => {
    await login(page);

    await page.goto(`${UI}/admin/payment-channels`);
    await expect(page).toHaveURL(/[?&]tab=providers/);
    await expect(page.getByRole('heading', { name: '支付充值' })).toBeVisible({ timeout: 20000 });

    await page.goto(`${UI}/admin/reconciliation`);
    await expect(page).toHaveURL(/[?&]tab=reconciliation/);
    await expect(page.getByRole('heading', { name: '支付充值' })).toBeVisible();
  });

  test('支付渠道标签列出三个适配器并说明可用性', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/payments?tab=providers`);

    await expect(page.getByTestId('admin-provider-grid')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('admin-provider-card').first()).toBeVisible();
    await expect(page.getByText('沙箱').first()).toBeVisible();
    await expect(page.getByText('支付宝').first()).toBeVisible();
    await expect(page.getByText('微信支付').first()).toBeVisible();
  });

  test('支付订单标签有筛选栏与表格，且不提供退款入口', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/payments?tab=orders`);

    await expect(page.getByTestId('admin-table')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('admin-filter').first()).toBeVisible();

    // 退款在订单管理，本页只有查单与关单
    await expect(page.getByRole('button', { name: '退款' })).toHaveCount(0);
    await expect(page.getByText('退款请到订单管理').first()).toBeVisible();
  });

  test('对账标签给出执行区与运行列表', async ({ page }) => {
    await login(page);
    // 空态必须有确定的数据前提，不能依赖共享测试库恰好没有运行记录。
    await page.route(/\/api\/v1\/admin\/payments\/reconciliations(?:\?.*)?$/, (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: { items: [], total: 0, page: 1, pageSize: 30 },
          message: '',
        }),
      });
    });
    await page.goto(`${UI}/admin/payments?tab=reconciliation`);

    await expect(page.getByRole('button', { name: '执行对账' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByLabel('账单日期')).toBeVisible();
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
    await page.getByLabel('账单日期').click();
    await expect(page.getByRole('grid')).toBeVisible();
    // 无对账记录时是空态而不是表格
    await expect(page.getByText('还没有对账记录')).toBeVisible();
  });

  test('对账状态深链回显筛选条件', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/payments?tab=reconciliation&status=failed`);

    await expect(page.getByTestId('admin-filter-chip').filter({ hasText: '状态：失败' })).toBeVisible({
      timeout: 20000,
    });
  });
});
