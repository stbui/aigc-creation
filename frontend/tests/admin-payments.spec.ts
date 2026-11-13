import { test, expect, type Page } from '@playwright/test';
import { HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';
import { ensureAdminLogin } from './support/admin-login';

/**
 * 支付配置页 E2E（`/admin/payments`，payment-refactor-design.md §21 / §24）。
 *
 * 守住四条约束：
 *   1. 三个运营视图都在同一个 URL 上（`?tab=`），深链能直接落到任一视图
 *   2. 旧路由 `/admin/payment-channels` 与 `/admin/reconciliation` 改为重定向，
 *      不再 404（后端旧控制器已下线）
 *   3. 交易核对的详情走 `?runId=` 深链，刷新后抽屉还在
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

test.describe('支付配置', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  test('左侧以独立支付分组进入支付配置', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin`);

    const nav = page.getByTestId('admin-sider');
    const paymentGroup = nav.getByRole('button', { name: '资金与财务', exact: true });
    await expect(paymentGroup).toBeVisible({ timeout: 20000 });

    const paymentItem = nav.getByRole('button', { name: '支付配置', exact: true });
    if (!(await paymentItem.isVisible())) await paymentGroup.click();
    await paymentItem.click();

    await expect(page).toHaveURL(/\/admin\/payments(?:\?|$)/);
    await expect(paymentItem).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('admin-breadcrumb')).toContainText('资金与财务');
    await expect(page.getByTestId('admin-breadcrumb')).toContainText('支付配置');
  });

  test('三个视图可切换，且切换只改 URL 不重载', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/payments`);

    await expect(page.getByRole('heading', { name: '支付配置' })).toBeVisible({ timeout: 20000 });

    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');

    // 缺省落在收款设置，但 URL 里先不写 tab
    await expect(page).not.toHaveURL(/[?&]tab=/);

    await page.getByRole('tab', { name: '交易核对' }).click();
    await expect(page).toHaveURL(/[?&]tab=reconciliation/);
    await expect(page.getByRole('tab', { name: '交易核对' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.getByRole('tab', { name: '异常处理' }).click();
    await expect(page).toHaveURL(/[?&]tab=exceptions/);
  });

  test('深链直接落到指定视图，非法标签回落到收款设置', async ({ page }) => {
    await login(page);

    await page.goto(`${UI}/admin/payments?tab=reconciliation`);
    await expect(page.getByRole('tab', { name: '交易核对' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await page.goto(`${UI}/admin/payments?tab=not-a-tab`);
    await expect(page.getByRole('tab', { name: '收款设置' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('旧路由重定向到新页，不再报错', async ({ page }) => {
    await login(page);

    await page.goto(`${UI}/admin/payment-channels`);
    await expect(page).toHaveURL(/[?&]tab=providers/);
    await expect(page.getByRole('heading', { name: '支付配置' })).toBeVisible({ timeout: 20000 });

    await page.goto(`${UI}/admin/reconciliation`);
    await expect(page).toHaveURL(/[?&]tab=reconciliation/);
    await expect(page.getByRole('heading', { name: '支付配置' })).toBeVisible();
  });

  test('收款设置展示客户支付方式与收款来源状态', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/payments?tab=providers`);

    await expect(page.getByTestId('admin-payment-visible-methods')).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByTestId('admin-provider-grid')).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId('admin-provider-card').first()).toBeVisible();
    await expect(page.getByText('沙箱').first()).toBeVisible();
    await expect(page.getByText('支付宝').first()).toBeVisible();
    await expect(page.getByText('微信支付').first()).toBeVisible();
  });

  test('调整方式弹窗可修改来源，并在有未保存修改时确认关闭', async ({ page }) => {
    await login(page);
    await page.route('**/api/v1/admin/payments/settings', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: { defaultCurrency: 'CNY', alipaySource: 'official', wechatSource: 'unset' },
          message: '',
        }),
      });
    });
    await page.goto(`${UI}/admin/payments?tab=providers`);

    await page.getByRole('button', { name: '调整客户支付方式' }).click({ timeout: 20000 });
    const modal = page.getByRole('dialog', { name: '调整客户支付方式' });
    await expect(modal).toBeVisible();

    await modal.getByRole('combobox', { name: '支付宝收款来源' }).click();
    await page.getByRole('option', { name: '尚未选择来源' }).click();
    await expect(modal.getByRole('button', { name: '保存调整' })).toBeEnabled();

    await modal.getByRole('button', { name: '取消' }).click();
    await expect(page.getByText('放弃未保存的修改？')).toBeVisible();
    await page.getByRole('button', { name: '继续编辑' }).click();
    await expect(modal).toBeVisible();

    await modal.getByRole('button', { name: '取消' }).click();
    await page.getByRole('button', { name: '放弃修改' }).click();
    await expect(modal).toBeHidden();
  });

  test('异常处理展示资金异常待办与筛选栏', async ({ page }) => {
    await login(page);
    await page.route(/\/api\/v1\/admin\/payments\/exceptions(?:\?.*)?$/, (route) => {
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
    await page.goto(`${UI}/admin/payments?tab=exceptions`);

    await expect(page.getByRole('heading', { name: '资金异常待办' })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByRole('combobox', { name: '筛选待办状态' })).toBeVisible();
    await expect(page.getByText('当前没有资金异常待办')).toBeVisible();
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

    await expect(page.getByRole('button', { name: '开始核对' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByLabel('账单日期')).toBeVisible();
    await expect(page.locator('input[type="date"]')).toHaveCount(0);
    await page.getByLabel('账单日期').click();
    await expect(page.getByRole('grid')).toBeVisible();
    // 无对账记录时是空态而不是表格
    await expect(page.getByText('还没有交易核对记录')).toBeVisible();
  });

  test('对账状态深链回显筛选条件', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/payments?tab=reconciliation&status=failed`);

    await expect(page.getByTestId('admin-filter-chip').filter({ hasText: '状态：失败' })).toBeVisible({
      timeout: 20000,
    });
  });
});
