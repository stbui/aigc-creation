import { test, expect, type Page } from '@playwright/test';

/**
 * 营销中心 E2E (admin-prd.md §3.12 B-64~B-67 / M11)。
 *
 * 守住三条约束:
 *   1. 券不提供删除 —— 已核销订单仍引用它
 *   2. 编辑时券码不可改 —— 改了等于让用户手里的券集体失效
 *   3. 无 marketing.write 权限时只读 (财务角色看不到写入口)
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

async function login(page: Page, email = 'admin@huojue.local') {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${UI}/login`);
  await page.locator('input[type="email"], input#email').first().fill(email);
  await page.locator('input[type="password"]').first().fill(process.env.ADMIN_PASSWORD ?? '');
  await page.locator('input[type="password"]').first().press('Enter');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
}

test.describe('营销中心', () => {
  test.skip(!process.env.ADMIN_PASSWORD, '未提供 ADMIN_PASSWORD');

  test('优惠券页渲染', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    await expect(page.getByRole('heading', { name: '优惠券' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: '新建优惠券' })).toBeVisible();
    await expect(page.locator('.adm-filter').first()).toBeVisible();
  });

  test('新建优惠券抽屉含全部字段', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    await page.getByRole('button', { name: '新建优惠券' }).click();

    await expect(page.getByText('新建优惠券').last()).toBeVisible();
    // 关键字段
    await expect(page.locator('#c-code')).toBeVisible();
    await expect(page.locator('#c-name')).toBeVisible();
    await expect(page.locator('#c-type')).toBeVisible();
    await expect(page.locator('#c-value')).toBeVisible();
    await expect(page.locator('#c-from')).toBeVisible();
    await expect(page.locator('#c-to')).toBeVisible();
  });

  test('折扣类型的面额标签随之变化', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    await page.getByRole('button', { name: '新建优惠券' }).click();

    // 默认满减 → 标签是「减免金额 (元)」
    await expect(page.locator('label[for="c-value"]')).toContainText('减免金额');
    // 切折扣 → 标签变「折扣 (万分比)」
    await page.locator('#c-type').selectOption('discount');
    await expect(page.locator('label[for="c-value"]')).toContainText('万分比');
  });

  test('表单校验: 非法券码被拒', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    await page.getByRole('button', { name: '新建优惠券' }).click();

    await page.locator('#c-code').fill('ab'); // 太短且小写
    await page.locator('#c-name').fill('测试券');
    await page.locator('#c-value').fill('10');
    await page.locator('.adm-modal-footer .adm-btn.is-primary, .adm-drawer-footer .adm-btn.is-primary').last().click();

    await expect(page.locator('.adm-form-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.adm-form-error')).toContainText('券码');
  });

  test('表单校验: 结束时间早于开始被拒', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    await page.getByRole('button', { name: '新建优惠券' }).click();

    await page.locator('#c-code').fill('VAL' + Date.now().toString().slice(-8));
    await page.locator('#c-name').fill('时间测试');
    await page.locator('#c-value').fill('10');
    await page.locator('#c-from').fill('2030-01-02T00:00');
    await page.locator('#c-to').fill('2030-01-01T00:00');
    await page.locator('.adm-drawer-footer .adm-btn.is-primary').click();

    await expect(page.locator('.adm-form-error')).toContainText('失效时间');
  });

  test('编辑时无券码输入框 (改码等于让已发出的券失效)', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    await page.waitForSelector('.adm-panel table tbody tr.ant-table-row', { timeout: 20000 });

    // 用列表里已有的券, 不依赖"新建成功" —— 建券要过唯一性校验,
    // 重复运行时容易因码已存在而让本用例的前置条件变得不稳定
    await page.locator('.adm-link', { hasText: '编辑' }).first().click();

    await expect(page.locator('.adm-form')).toBeVisible({ timeout: 10000 });
    // 券码输入框应不存在: 改码等于让用户手里的券集体失效
    await expect(page.locator('#c-code')).toHaveCount(0);
    // 其余可编辑字段正常存在
    await expect(page.locator('#c-name')).toBeVisible();
    await expect(page.locator('#c-value')).toBeVisible();
  });

  test('券列表无删除入口 (已核销订单仍引用)', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    await page.waitForSelector('.adm-panel table', { timeout: 20000 });
    await page.waitForTimeout(600);

    // 操作列只有「编辑」和「停用/启用」
    const firstRow = page.locator('.adm-panel table tbody tr.ant-table-row').first();
    const actions = await firstRow.locator('.adm-link').allTextContents();
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

    // 限时价 → 显示商品ID与活动价
    await expect(page.locator('#k-pid')).toBeVisible();
    await expect(page.locator('#k-price')).toBeVisible();

    // 切限时免费 → 显示能力ID, 限时价的字段消失
    await page.locator('#k-type').selectOption('limited_free');
    await expect(page.locator('#k-caps')).toBeVisible();
    await expect(page.locator('#k-pid')).toHaveCount(0);

    // 切弹窗 → 显示标题正文
    await page.locator('#k-type').selectOption('popup');
    await expect(page.locator('#k-title')).toBeVisible();
    await expect(page.locator('#k-caps')).toHaveCount(0);
  });

  test('弹窗跳转地址限制站内路径', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/campaigns`);
    await page.getByRole('button', { name: '新建活动' }).click();
    await page.locator('#k-type').selectOption('popup');

    await page.locator('#k-name').fill('外链测试');
    await page.locator('#k-title').fill('标题');
    await page.locator('#k-cta').fill('立即查看');
    await page.locator('#k-url').fill('https://evil.example.com');
    await page.locator('.adm-drawer-footer .adm-btn.is-primary').click();

    await expect(page.locator('.adm-form-error')).toContainText('站内相对路径');
  });

  test('邀请与签到规则页渲染', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/marketing-rules`);
    await expect(page.getByRole('heading', { name: '邀请与签到' })).toBeVisible({ timeout: 20000 });

    await expect(page.locator('.adm-panel-title', { hasText: '邀请分销规则' })).toBeVisible();
    await expect(page.locator('.adm-panel-title', { hasText: '签到规则' })).toBeVisible();
    await expect(page.locator('#i-inviter')).toBeVisible();
    await expect(page.locator('#i-invitee')).toBeVisible();
    await expect(page.locator('#c-base')).toBeVisible();
    // 「添加加成档位」按钮应始终存在 —— 默认无加成档位(bonusRules 为空数组)
    await expect(page.getByRole('button', { name: /添加加成档位/ })).toBeVisible();
  });

  test('签到加成档位可增删', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/marketing-rules`);
    await expect(page.getByRole('button', { name: /添加加成档位/ })).toBeVisible({ timeout: 20000 });

    const before = await page.locator('.adm-bonus-row').count();
    await page.getByRole('button', { name: /添加加成档位/ }).click();
    await expect(page.locator('.adm-bonus-row')).toHaveCount(before + 1);

    await page.locator('.adm-bonus-row').last().locator('.adm-link.is-danger').click();
    await expect(page.locator('.adm-bonus-row')).toHaveCount(before);
  });

  test('保存规则需二次确认', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/marketing-rules`);
    await page.waitForSelector('#i-inviter', { timeout: 20000 });

    await page.getByRole('button', { name: '保存邀请规则' }).click();
    await expect(page.locator('.adm-modal-title')).toContainText('保存邀请规则');
    // 应量化说明影响
    await expect(page.locator('.adm-confirm-impact')).toContainText('积分');
    await page.getByRole('button', { name: '取消' }).click();
  });
});

test.describe('营销中心权限', () => {
  test.skip(!process.env.ADMIN_PASSWORD, '未提供 ADMIN_PASSWORD');

  test('侧栏「交易」分组含三个营销入口', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/coupons`);
    for (const label of ['优惠券', '限时活动', '邀请与签到']) {
      await expect(page.locator('.adm-sider-item', { hasText: label })).toBeVisible({ timeout: 15000 });
    }
  });
});