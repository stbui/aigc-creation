import { test, expect, type Page } from '@playwright/test';
import { HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';
import { ensureAdminLogin } from './support/admin-login';
import {
  createCouponFixture,
  removeCouponFixture,
  type CouponFixture,
} from './support/marketing-fixtures';

/**
 * 营销中心 E2E (admin-prd.md §3.12 B-64~B-67 / M11)。
 *
 * 守住三条约束:
 *   1. 券不提供删除 —— 已核销订单仍引用它
 *   2. 编辑时券码不可改 —— 改了等于让用户手里的券集体失效
 *   3. 无 marketing.write 权限时只读 (财务角色看不到写入口)
 *
 * ## 选择器约定（2026-10-30 后台改版后）
 *
 * 表单字段没有 `id` 了，一律用 `aria-label`（`getByLabel`）定位；弹层用
 * `getByRole('dialog', { name })`；列表行用 `data-testid="admin-table-row"`。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

async function login(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await ensureAdminLogin(page);
}

/** 单值下拉（shadcn Select）：点触发器 → 选选项 */
async function pick(page: Page, label: string, option: string) {
  // 触发器是 combobox，无障碍名就是 SelectBox 的 aria-label（字段名本身）。
  await page.getByRole('combobox', { name: label, exact: true }).first().click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('营销中心', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  let couponFixture: CouponFixture | null = null;

  test.beforeAll(async () => {
    if (!HAS_ADMIN_CREDENTIALS) return;
    couponFixture = await createCouponFixture();
  });

  test.afterAll(async () => {
    if (!HAS_ADMIN_CREDENTIALS) return;
    await removeCouponFixture();
  });

  test('优惠券页渲染', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    await expect(page.getByRole('heading', { name: '优惠券' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: '新建优惠券' })).toBeVisible();
    await expect(page.getByTestId('admin-filter').first()).toBeVisible();
  });

  test('新建优惠券抽屉含全部字段', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    await page.getByRole('button', { name: '新建优惠券' }).click();

    const panel = page.getByRole('dialog', { name: '新建优惠券' });
    await expect(panel).toBeVisible();
    // 关键字段。类型是下拉触发器（combobox），不是原生输入框。
    for (const label of ['券码', '券名称', '面额', '生效时间', '失效时间']) {
      await expect(panel.getByLabel(label)).toBeVisible();
    }
    await expect(panel.getByRole('combobox', { name: '类型', exact: true })).toBeVisible();
  });

  test('折扣类型的面额标签随之变化', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    await page.getByRole('button', { name: '新建优惠券' }).click();

    const panel = page.getByRole('dialog', { name: '新建优惠券' });
    // 默认满减 → 标签是「减免金额 (元)」
    await expect(panel).toContainText('减免金额');
    // 切折扣 → 标签变「折扣 (万分比)」
    await pick(page, '类型', '折扣');
    await expect(panel).toContainText('万分比');
  });

  test('表单校验: 非法券码被拒', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    await page.getByRole('button', { name: '新建优惠券' }).click();

    const panel = page.getByRole('dialog', { name: '新建优惠券' });
    await panel.getByLabel('券码').fill('ab'); // 太短且小写
    await panel.getByLabel('券名称').fill('测试券');
    await panel.getByLabel('面额').fill('10');
    await panel.getByRole('button', { name: '保存', exact: true }).click();

    // 表单错误走 Notice(tone=danger) → role="alert"
    await expect(panel.getByRole('alert')).toBeVisible({ timeout: 5000 });
    await expect(panel.getByRole('alert')).toContainText('券码');
  });

  test('表单校验: 结束时间早于开始被拒', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    await page.getByRole('button', { name: '新建优惠券' }).click();

    const panel = page.getByRole('dialog', { name: '新建优惠券' });
    await panel.getByLabel('券码').fill('VAL' + Date.now().toString().slice(-8));
    await panel.getByLabel('券名称').fill('时间测试');
    await panel.getByLabel('面额').fill('10');
    await panel.getByLabel('生效时间').fill('2030-01-02T00:00');
    await panel.getByLabel('失效时间').fill('2030-01-01T00:00');
    await panel.getByRole('button', { name: '保存', exact: true }).click();

    await expect(panel.getByRole('alert')).toContainText('失效时间');
  });

  test('编辑时无券码输入框 (改码等于让已发出的券失效)', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    const couponRow = page.getByTestId('admin-table-row').filter({ hasText: couponFixture!.code });
    await expect(couponRow).toBeVisible({ timeout: 20000 });
    const edit = couponRow.getByRole('button', { name: '编辑' });
    await expect(edit).toBeVisible();
    await edit.click();

    const panel = page.getByRole('dialog', { name: /^编辑优惠券/ });
    await expect(panel).toBeVisible({ timeout: 10000 });
    // 券码输入框应不存在: 改码等于让用户手里的券集体失效
    await expect(panel.getByLabel('券码')).toHaveCount(0);
    // 其余可编辑字段正常存在
    await expect(panel.getByLabel('券名称')).toBeVisible();
    await expect(panel.getByLabel('面额')).toBeVisible();
  });

  test('券列表无删除入口 (已核销订单仍引用)', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    const couponRow = page.getByTestId('admin-table-row').filter({ hasText: couponFixture!.code });
    await expect(couponRow).toBeVisible({ timeout: 20000 });

    // 操作列只有「编辑」和「停用/启用」
    const actions = await couponRow.locator('td:last-child button').allTextContents();
    expect(actions.join(',')).not.toContain('删除');
  });

  test('限时活动页渲染', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/campaigns`);
    await expect(page.getByRole('heading', { name: '限时活动' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: '新建活动' })).toBeVisible();
  });

  test('活动 payload 字段随类型切换', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/campaigns`);
    await page.getByRole('button', { name: '新建活动' }).click();

    const panel = page.getByRole('dialog', { name: '新建活动' });
    await expect(panel).toBeVisible();

    // 限时价 → 显示商品ID与活动价
    await expect(panel.getByLabel('目标商品 ID')).toBeVisible();
    await expect(panel.getByLabel('活动价')).toBeVisible();

    // 切限时免费 → 显示能力ID, 限时价的字段消失
    await pick(page, '活动类型', '限时免费');
    await expect(panel.getByLabel('能力 ID')).toBeVisible();
    await expect(panel.getByLabel('目标商品 ID')).toHaveCount(0);

    // 切弹窗 → 显示标题正文
    await pick(page, '活动类型', '弹窗位');
    await expect(panel.getByLabel('弹窗标题')).toBeVisible();
    await expect(panel.getByLabel('能力 ID')).toHaveCount(0);
  });

  test('弹窗跳转地址限制站内路径', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/campaigns`);
    await page.getByRole('button', { name: '新建活动' }).click();

    const panel = page.getByRole('dialog', { name: '新建活动' });
    await pick(page, '活动类型', '弹窗位');
    await panel.getByLabel('活动名称').fill('外链测试');
    await panel.getByLabel('弹窗标题').fill('标题');
    await panel.getByLabel('按钮文案').fill('立即查看');
    await panel.getByLabel('跳转地址').fill('https://evil.example.com');
    await panel.getByRole('button', { name: '保存', exact: true }).click();

    await expect(panel.getByRole('alert')).toContainText('站内相对路径');
  });

  test('邀请与签到规则页渲染', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/marketing-rules`);
    await expect(page.getByRole('heading', { name: '邀请与签到' })).toBeVisible({ timeout: 20000 });

    await expect(page.getByRole('heading', { name: '邀请分销规则' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '签到规则' })).toBeVisible();
    await expect(page.getByLabel('邀请人奖励积分', { exact: true })).toBeVisible();
    await expect(page.getByLabel('被邀请人奖励积分', { exact: true })).toBeVisible();
    await expect(page.getByLabel('每日基础积分')).toBeVisible();
    // 「添加加成档位」按钮应始终存在 —— 默认无加成档位(bonusRules 为空数组)
    await expect(page.getByRole('button', { name: /添加加成档位/ })).toBeVisible();
  });

  test('签到加成档位可增删', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/marketing-rules`);
    await expect(page.getByRole('button', { name: /添加加成档位/ })).toBeVisible({
      timeout: 20000,
    });

    const tiers = page.getByLabel(/^第 \d+ 档连续天数$/);
    const before = await tiers.count();
    await page.getByRole('button', { name: /添加加成档位/ }).click();
    await expect(tiers).toHaveCount(before + 1);

    await page.getByRole('button', { name: `删除第 ${before + 1} 档加成` }).click();
    await expect(tiers).toHaveCount(before);
  });

  test('保存规则直接执行, 不再弹窗确认', async ({ page }) => {
    let saved = false;
    await page.route('**/api/v1/admin/invites/rules', async (route) => {
      if (route.request().method() !== 'PUT') {
        await route.continue();
        return;
      }
      saved = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: route.request().postDataJSON(), message: '' }),
      });
    });

    await login(page);
    await page.goto(`${UI}/admin/marketing-rules`);
    await page.getByLabel('邀请人奖励积分', { exact: true }).waitFor({ state: 'visible', timeout: 20000 });

    await page.getByRole('button', { name: '保存邀请规则' }).click();

    await expect(page.getByTestId('admin-modal')).toHaveCount(0);
    await expect(page.getByTestId('admin-confirm-action')).toHaveCount(0);
    await expect.poll(() => saved).toBe(true);
  });
});

test.describe('营销中心权限', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  test('侧栏「交易」分组含三个营销入口', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    const nav = page.getByTestId('admin-sider');
    for (const label of ['优惠券', '限时活动', '邀请与签到']) {
      await expect(nav.getByRole('button', { name: label, exact: true })).toBeVisible({
        timeout: 15000,
      });
    }
    // 分组标题仍在（宽视口不折叠）
    await expect(nav.getByText('交易', { exact: true })).toBeVisible();
  });
});
