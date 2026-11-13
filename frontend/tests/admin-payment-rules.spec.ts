import { test, expect, type Page } from '@playwright/test';
import { HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';

/**
 * 支付与退费独立运营工作台 E2E。
 *
 * 守住四个约束：
 *   1. 左侧「支付」分组同时提供支付配置与支付与退费入口
 *   2. 页面使用独立运营布局，系统设置不再展示支付/退款分组
 *   3. 旧设置深链不兼容，未知系统设置路径进入后台 404
 *   4. 保存只提交本页白名单内的 payment.* / refund.* 键
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

type SettingValue = string | number | boolean | null;

function settingItem(
  key: string,
  type: 'string' | 'number' | 'boolean',
  value: SettingValue,
  extra: Record<string, unknown> = {},
) {
  return {
    key,
    label: key,
    description: '',
    type,
    value,
    default: value,
    overridden: false,
    group: key.split('.')[0],
    updatedBy: null,
    updatedAt: null,
    ...extra,
  };
}

function paymentRulesSettings() {
  return {
    groups: [
      {
        key: 'site',
        label: '站点',
        items: [
          settingItem('site.name', 'string', '货觉AI', {
            readOnly: true,
            maxLength: 40,
          }),
        ],
      },
      {
        key: 'payment',
        label: '支付',
        items: [
          settingItem('payment.enabled', 'boolean', true),
          settingItem('payment.defaultCurrency', 'string', 'CNY', {
            options: ['CNY', 'USD'],
          }),
          settingItem('payment.productNamePrefix', 'string', '', { maxLength: 40 }),
          settingItem('payment.productNameSuffix', 'string', '', { maxLength: 20 }),
          settingItem('payment.minAmountYuan', 'number', 1, { min: 0.01 }),
          settingItem('payment.maxAmountYuan', 'number', null, {
            min: 0.01,
            nullable: true,
          }),
          settingItem('payment.dailyLimitYuan', 'number', null, {
            min: 0.01,
            nullable: true,
          }),
          settingItem('payment.helpImage', 'string', '', {
            control: 'image-upload',
            maxLength: 500,
          }),
          settingItem('payment.helpText', 'string', '', { maxLength: 1000 }),
          settingItem('payment.orderTtlMinutes', 'number', 30, { min: 1, max: 1440 }),
          settingItem('payment.maxPendingOrders', 'number', 3, { min: 1, max: 100 }),
          settingItem('payment.cancelLimitEnabled', 'boolean', false),
          settingItem('payment.cancelWindowMode', 'string', 'rolling', {
            options: ['rolling', 'fixed'],
            optionLabels: { rolling: '滚动窗口', fixed: '固定窗口' },
          }),
          settingItem('payment.cancelWindowSize', 'number', 10, { min: 1, max: 10080 }),
          settingItem('payment.cancelWindowUnit', 'string', 'minute', {
            options: ['minute', 'hour'],
            optionLabels: { minute: '分钟', hour: '小时' },
          }),
          settingItem('payment.cancelLimitMax', 'number', 5, { min: 1, max: 1000 }),
          settingItem('payment.loadBalancingStrategy', 'string', 'round-robin', {
            options: ['round-robin', 'least-amount'],
          }),
          settingItem('payment.alipayMobilePrecreateDeepLink', 'boolean', false),
          // 下列两项由 /admin/payments 管理。本页只读取到它们，不得渲染或提交。
          settingItem('payment.alipaySource', 'string', 'official'),
          settingItem('payment.wechatSource', 'string', 'official'),
        ],
      },
      {
        key: 'refund',
        label: '退款',
        items: [
          settingItem('refund.windowDays', 'number', 7, { min: 0, max: 365 }),
          settingItem('refund.maxRatioBps', 'number', 10000, { min: 0, max: 10000 }),
          settingItem('refund.allowConsumedTask', 'boolean', true),
        ],
      },
    ],
  };
}

async function mockSettingsApi(page: Page) {
  await page.route(/\/api\/v1\/admin\/settings(?:\?.*)?$/, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: paymentRulesSettings(), message: '' }),
      });
      return;
    }
    if (route.request().method() === 'PATCH') {
      const payload = route.request().postDataJSON() as {
        settings: Record<string, SettingValue>;
        clears?: string[];
      };
      const updated = Object.keys(payload.settings);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: { updated, cleared: payload.clears ?? [], changes: [] },
          message: '',
        }),
      });
      return;
    }
    await route.continue();
  });
}

test.describe('支付与退费运营工作台', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  test('左侧支付分组提供两个独立入口', async ({ page }) => {
    await page.goto(`${UI}/admin`);

    const nav = page.getByTestId('admin-sider');
    const paymentGroup = nav.getByRole('button', { name: '资金与财务', exact: true });
    await expect(paymentGroup).toBeVisible({ timeout: 20000 });

    const configItem = nav.getByRole('button', { name: '支付配置', exact: true });
    if (!(await configItem.isVisible())) await paymentGroup.click();
    await expect(configItem).toBeVisible();
    await expect(
      nav.getByRole('button', { name: '支付与退费', exact: true }),
    ).toBeVisible();

    await nav.getByRole('button', { name: '支付与退费', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/payment-rules$/);
    await expect(page.getByRole('heading', { name: '支付与退费' })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByTestId('admin-breadcrumb')).toContainText('资金与财务');
    await expect(page.getByTestId('admin-breadcrumb')).toContainText('支付与退费');
    await expect(page.getByText('客户支付体验', { exact: true })).toBeVisible();
    await expect(page.getByText('退款处理边界', { exact: true })).toBeVisible();
  });

  test('旧退款深链不兼容，系统设置只保留四个规范页签', async ({ page }) => {
    await mockSettingsApi(page);

    await page.goto(`${UI}/admin/settings/refund`);
    await expect(page).toHaveURL(/\/admin\/settings\/refund$/);
    await expect(page.getByRole('heading', { name: '页面不存在' })).toBeVisible({
      timeout: 20000,
    });

    await page.goto(`${UI}/admin/settings?group=refund`);
    await expect(page).toHaveURL(/\/admin\/settings\/generate$/);
    await expect(page.getByRole('heading', { name: '系统设置' })).toBeVisible({
      timeout: 20000,
    });
    const groupTabs = page.getByRole('tablist', { name: '系统设置' });
    await expect(groupTabs.getByRole('tab', { name: '运行与生成' })).toBeVisible();
    await expect(groupTabs.getByRole('tab', { name: /^支付/ })).toHaveCount(0);
    await expect(groupTabs.getByRole('tab', { name: /^退款/ })).toHaveCount(0);
  });

  test('修改后有离开确认，保存只提交本页运营规则白名单', async ({ page }) => {
    await mockSettingsApi(page);
    await page.goto(`${UI}/admin/payment-rules`);
    await expect(page.getByRole('heading', { name: '支付与退费' })).toBeVisible({
      timeout: 20000,
    });

    const minimumAmount = page.getByLabel('最低单笔充值');
    await minimumAmount.fill('20');
    await expect(page.getByText('有 1 项规则待保存')).toBeVisible();

    const nav = page.getByTestId('admin-sider');
    const transactionGroup = nav.getByRole('button', { name: '商品与交易', exact: true });
    const orderItem = nav.getByRole('button', { name: '订单管理', exact: true });
    if (!(await orderItem.isVisible())) await transactionGroup.click();
    await orderItem.click();
    const leaveDialog = page.getByRole('dialog').filter({ hasText: '有未保存的变更' });
    await expect(leaveDialog).toBeVisible();
    await leaveDialog.getByRole('button', { name: '留下继续编辑' }).click();
    await expect(page).toHaveURL(/\/admin\/payment-rules$/);

    const saveRequest = page.waitForRequest(
      (request) =>
        request.method() === 'PATCH' && /\/api\/v1\/admin\/settings$/.test(request.url()),
    );
    await page.getByRole('button', { name: '保存变更' }).click();
    await expect(page.getByRole('dialog', { name: '确认保存支付与退费规则' })).toBeVisible();
    await page.getByRole('button', { name: '确认保存' }).click();

    const payload = (await saveRequest).postDataJSON() as {
      settings: Record<string, SettingValue>;
      clears?: string[];
    };
    expect(payload.settings).toMatchObject({ 'payment.minAmountYuan': 20 });
    expect(Object.keys(payload.settings).every((key) => /^(payment|refund)\./.test(key))).toBe(
      true,
    );
    expect(payload.settings).not.toHaveProperty('payment.alipaySource');
    expect(payload.settings).not.toHaveProperty('payment.wechatSource');
    await expect(page.getByText('支付与退费规则已保存')).toBeVisible({ timeout: 20000 });
  });
});
