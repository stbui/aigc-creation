import { test, expect } from '@playwright/test';
import { HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';

/**
 * 后台管理端 E2E 冒烟。
 *
 * 覆盖的是「权限链路 + 四页渲染」, 不是像素级视觉回归。
 * 前置: 后端与前端 dev server 已在 BASE 指向的端口运行, 且已 seed 管理员。
 *
 * ## 选择器约定（2026-10-30 外壳换单栏结构后）
 *
 * 后台共享控件只暴露 `data-testid="admin-*"`, 不再依赖 antd 的 `.ant-*` 与
 * 旧版 `adm-*` 组件类。DOM 结构、Tailwind 类名可以随时改, 这些钩子不能改 ——
 * 需要新钩子时在 `src/admin-ui/` 的共享控件里加, 不在页面里拼结构选择器。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

test.describe('后台管理端', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据, 跳过登录相关用例');

  test('概览页加载真实统计', async ({ page }) => {
    await page.goto(`${UI}/admin`);
    await expect(page.getByRole('heading', { name: '平台概览' })).toBeVisible({ timeout: 15000 });
    // 2026-10-30 起概览首屏改为值班台：先回答「什么坏了 / 机器是否在转」，
    // 累计指标下沉到下方区块。断言改为当前真实存在的工作表区块。
    await expect(page.getByRole('region', { name: '值班条' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '异常队列' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '机器状态' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '平台存量' })).toBeVisible();
    await expect(page.getByTestId('admin-overview-totals')).toContainText('任务总数');
  });

  test('用户管理页渲染列表', async ({ page }) => {
    await page.goto(`${UI}/admin/users`);
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('admin-filter').first()).toBeVisible();
    // 用户列表使用卡片网格，不再渲染表格
    await expect(page.getByTestId('admin-table')).toHaveCount(0);
    const firstCard = page.getByTestId('admin-user-card').first();
    await expect(firstCard).toBeVisible();
    await expect(firstCard.getByText('项目')).toBeVisible();
    const deletableCard = page
      .getByTestId('admin-user-card')
      .filter({ has: page.getByRole('button', { name: '删除用户' }) })
      .first();
    await expect(deletableCard).toBeVisible();
    await expect(firstCard.getByRole('button', { name: '更多' })).toHaveCount(0);
    await expect(page.getByTestId('admin-users-total')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: '导出用户 CSV' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '导出用户 CSV' }).locator('svg'),
    ).toHaveCount(1);
    await expect(page.getByTestId('admin-panel')).toHaveCount(0);

    await expect(page.getByTestId('admin-batch-actions')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^批量(禁用|启用)$/ })).toHaveCount(0);
    await expect(firstCard.getByRole('checkbox')).toHaveCount(0);
  });

  test('用户删除确认展示软注销影响面且操作区始终可用', async ({ page }) => {
    // 矮视口专门验证确认框不会撑出屏幕，也不会把底部按钮挤走。
    await page.setViewportSize({ width: 1440, height: 620 });
    await page.route('**/admin/users/*/impact', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          email: 'user@example.com',
          projects: 3,
          tasks: 8,
          assets: 12,
          retained: {
            orders: 2,
            payments: 2,
            refunds: 1,
            invoices: 1,
            billingOrders: 2,
            creditLedgerEntries: 5,
          },
          hardDeleteAllowed: false,
        }),
      }),
    );
    await page.goto(`${UI}/admin/users`);
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible({ timeout: 15000 });

    const deletableCard = page
      .getByTestId('admin-user-card')
      .filter({ has: page.getByRole('button', { name: '删除用户' }) })
      .first();
    await expect(deletableCard).toBeVisible();
    await deletableCard.getByRole('button', { name: '删除用户' }).click();

    const dialog = page.getByTestId('admin-delete-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('role', 'alertdialog');
    await expect(dialog).toHaveAttribute('data-slot', 'alert-dialog-content');
    await expect(dialog.getByRole('heading', { name: '删除用户' })).toBeVisible();
    await expect(dialog).toContainText('将注销账号');
    await expect(dialog).toContainText('项目 3 · 任务 8 · 素材 12');
    await expect(dialog).toContainText('将匿名保留（13 条）');
    await expect(dialog.getByRole('button', { name: '取消' })).toBeInViewport();
    const confirm = dialog.getByRole('button', { name: '确认注销' });
    await expect(confirm).toBeInViewport();
    await expect(confirm).toBeEnabled();
    await expect(page.locator('[data-slot="alert-dialog-overlay"]')).toHaveCount(1);

    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(bounds).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);
    expect(bounds!.x + bounds!.width / 2).toBeCloseTo(viewport!.width / 2, 0);
  });

  test('用户操作弹框使用 shadcn AlertDialog 与 Dialog', async ({ page }) => {
    await page.goto(`${UI}/admin/users`);
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible({ timeout: 15000 });

    const actionCard = page
      .getByTestId('admin-user-card')
      .filter({ has: page.getByRole('button', { name: '变更角色' }) })
      .first();
    await expect(actionCard).toBeVisible();

    await actionCard.getByRole('button', { name: /^(禁用账号|启用账号)$/ }).click();

    const statusDialog = page.getByTestId('admin-status-dialog');
    await expect(statusDialog).toBeVisible();
    await expect(statusDialog).toHaveAttribute('role', 'alertdialog');
    await expect(statusDialog).toHaveAttribute('data-slot', 'alert-dialog-content');
    await expect(statusDialog.getByRole('heading', { name: /^(禁用账号|启用账号)$/ })).toBeVisible();
    await statusDialog.getByRole('button', { name: '取消' }).click();
    await expect(statusDialog).toBeHidden();

    await actionCard.getByRole('button', { name: '变更角色' }).click();

    const roleDialog = page.getByTestId('admin-role-dialog');
    await expect(roleDialog).toBeVisible();
    await expect(roleDialog).toHaveAttribute('role', 'alertdialog');
    await expect(roleDialog).toHaveAttribute('data-slot', 'alert-dialog-content');
    await expect(roleDialog.getByRole('heading', { name: '变更角色' })).toBeVisible();
    await expect(roleDialog.getByRole('combobox', { name: '目标角色' })).toBeVisible();
    await expect(roleDialog.getByRole('button', { name: '确认变更' })).toBeDisabled();
    await roleDialog.getByRole('button', { name: '取消' }).click();
    await expect(roleDialog).toBeHidden();

    // 重置密码会改真实数据；这里只验证一次性密码弹框的 shadcn Dialog 形态。
    await page.route('**/admin/users/*/password', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tempPassword: 'Temp-e2e-password' }),
      }),
    );
    await actionCard.getByRole('button', { name: '重置密码' }).click();

    const tempPasswordDialog = page.getByRole('dialog', { name: '临时密码已生成' });
    await expect(tempPasswordDialog).toBeVisible();
    await expect(tempPasswordDialog).toHaveAttribute('data-slot', 'dialog-content');
    await expect(tempPasswordDialog.getByRole('textbox', { name: '临时密码' })).toHaveValue(
      'Temp-e2e-password',
    );
    await expect(tempPasswordDialog.getByRole('button', { name: '复制' })).toBeVisible();
    await tempPasswordDialog.getByRole('button', { name: '我已保存' }).click();
    await expect(tempPasswordDialog).toBeHidden();
  });

  test('角色权限页渲染权限模块', async ({ page }) => {
    await page.goto(`${UI}/admin/roles`);
    await expect(page.getByRole('heading', { name: '角色权限' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: '权限矩阵' })).toBeVisible();
    await expect(page.getByRole('checkbox').first()).toBeVisible();
  });

  test('会员套餐页渲染真实套餐列表', async ({ page }) => {
    await page.goto(`${UI}/admin/membership-plans`);
    await expect(page.getByRole('heading', { name: '会员套餐', exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('admin-table-row').filter({ hasText: 'free' })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建套餐' })).toBeVisible();
  });

  test('会员套餐关闭抽屉前保护未保存修改', async ({ page }) => {
    await page.goto(`${UI}/admin/membership-plans`);
    await expect(page.getByRole('heading', { name: '会员套餐', exact: true })).toBeVisible({ timeout: 15000 });

    await page.getByTestId('admin-table-row').first().getByRole('button', { name: '编辑' }).click();
    const panel = page.getByRole('dialog', { name: '编辑会员套餐' });
    await expect(panel).toBeVisible();
    const name = panel.getByLabel('套餐名称');
    await name.fill(`${await name.inputValue()} · 未保存`);

    await panel.getByRole('button', { name: '关闭' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: '放弃未保存的修改？' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: '继续编辑' }).click();
    await expect(panel).toBeVisible();

    await panel.getByRole('button', { name: '关闭' }).click();
    await confirm.getByRole('button', { name: '放弃修改' }).click();
    await expect(page.getByTestId('admin-drawer')).toHaveCount(0);
  });

  test('系统设置页渲染 Tab 与设置项', async ({ page }) => {
    await page.goto(`${UI}/admin/settings`);
    await expect(page.getByRole('heading', { name: '系统设置' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('tab').first()).toBeVisible();
    // 默认分组「站点」是只读配置地图，不渲染输入框；切到「上传」才应出现可编辑控件。
    await page.getByRole('tab', { name: /上传/ }).click();
    const panel = page.getByTestId('admin-panel').first();
    await expect(panel).toBeVisible();
    await expect(panel.locator('input').first()).toBeVisible();
  });

  test('操作审计页渲染表格', async ({ page }) => {
    await page.goto(`${UI}/admin/audit-logs`);
    await expect(page.getByRole('heading', { name: '操作审计' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('admin-filter').first()).toBeVisible();
  });

  /*
   * 常驻确认层回归。
   *
   * 2026-10-26 起高危操作确认改为页面内操作条，不再使用 Modal。这里断言
   * 首屏既没有弹窗/抽屉，也没有常驻的操作条；否则整页会被挡住或占位。
   */
  for (const [path, heading] of [
    ['/admin/legal', '法务文档'],
    ['/admin/notifications', '站内消息'],
  ] as const) {
    test(`${heading}页不得常驻确认弹窗或操作条`, async ({ page }) => {
      await page.goto(`${UI}${path}`);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('admin-modal')).toHaveCount(0);
      await expect(page.getByTestId('admin-drawer')).toHaveCount(0);
      await expect(page.getByTestId('admin-confirm-action')).toHaveCount(0);
      // 页面真的可点: 抓一个首屏按钮验证可交互
      await expect(page.getByRole('button').first()).toBeEnabled();
    });
  }
});

test.describe('越权拦截', () => {
  test('C端用户访问后台显示无权限页并说明原因', async ({ page }) => {
    /*
     * 现场注册一个普通账号（role='user'）—— 项目不再内置演示账号，
     * 也不再假设"库里某个账号的密码是什么"。
     */
    const stamp = Date.now().toString(36);
    const email = `e2e-admin-${stamp}@test.local`;
    const password = 'test123456';

    // 共用登录态会带到本用例；先清掉管理员会话，才是真正的普通用户路径。
    await page.goto(`${UI}/login`);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    const emailInput = page.locator('input[type="email"], input#email, input[name="email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 15000 });
    // 登录页默认是登录态，先切到注册
    await page.getByText('立即注册').click();
    await page.getByPlaceholder('展示名称').fill(`E2E${stamp.slice(-4)}`);
    await emailInput.fill(email);
    const pwdInput = page.locator('input[type="password"]').first();
    await pwdInput.fill(password);
    // 注册需勾选协议
    await page.getByRole('checkbox').check();
    await pwdInput.press('Enter');

    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });

    // 停在 /admin 并明确说明原因, 而不是静默弹回工作台
    await page.goto(`${UI}/admin`);
    await expect(page.getByRole('heading', { name: '需要后台权限' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('没有运营后台的访问权限')).toBeVisible();
    await expect(page.getByText('如何进入')).toBeVisible();
    expect(page.url()).toContain('/admin');

    // 「换个账号登录」应清 token 并跳登录页
    await page.getByRole('button', { name: '换个账号登录' }).click();
    await page.waitForURL((u) => u.pathname.includes('/login'), { timeout: 15000 });
    const token = await page.evaluate(() => localStorage.getItem('ecom_vision_token'));
    expect(token).toBeNull();
  });

  test('未登录访问后台跳登录页', async ({ page }) => {
    /*
     * 必须先goto 到同源页面才能操作 localStorage —— 直接 about:blank 上调用
     * localStorage.clear() 会抛 SecurityError, 且清理不彻底时后续用例会
     * 被上一个用例留下的登录态污染 (表现为单跑通过、联跑失败)。
     */
    await page.goto(`${UI}/login`);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    await page.goto(`${UI}/admin`);
    await page.waitForURL((u) => u.pathname.includes('/login'), { timeout: 15000 });
    expect(page.url()).toContain('/login');
  });
});
