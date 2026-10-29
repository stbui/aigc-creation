import { test, expect } from '@playwright/test';
import { ADMIN_PASSWORD, HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';

/**
 * 后台高频动线回归。
 *
 * 覆盖 2026-10-29 的三处体验优化:
 *   1. 筛选条件可从地址栏恢复，并可逐条清除
 *   2. 角色权限页有未保存变更时出现底部保存条，离开前二次确认
 *   3. 概览页最近任务可直达任务详情
 *   4. 订单 / 任务 / 模型线路三张宽表在 1440px 下无需横向滚动
 *   5. 配置页与编辑抽屉有未保存修改时不会静默丢弃
 *   6. 工单 / 商品 / 告警筛选可深链；回复与积分调整草稿关闭前会确认
 */
const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';
const PASSWORD = ADMIN_PASSWORD;

test.describe('后台高频动线', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  test('筛选条件从地址栏恢复，并可逐条清除', async ({ page }) => {
    await page.goto(`${UI}/admin/users?role=admin&status=active`);
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible({
      timeout: 15000,
    });

    const chips = page.locator('.adm-filter-chips');
    await expect(chips).toBeVisible();
    await expect(chips).toContainText('角色：管理员');
    await expect(chips).toContainText('状态：正常');

    const roleChip = chips.locator('.adm-filter-chip', { hasText: '角色：管理员' });
    await roleChip.locator('.ant-tag-close-icon').click();

    await expect(page).not.toHaveURL(/role=admin/);
    await expect(page).toHaveURL(/status=active/);
    await expect(chips).not.toContainText('角色：管理员');

    // 刷新后只恢复仍生效的条件，已清除的角色不能“复活”
    await page.reload();
    await expect(page.locator('.adm-filter-chips')).toContainText('状态：正常');
    await expect(page.locator('.adm-filter-chip', { hasText: '角色：管理员' })).toHaveCount(0);
  });

  test('其余深链列表页同样回显已生效筛选', async ({ page }) => {
    const cases = [
      ['/admin/audit-logs?action=user.delete&success=false', '操作审计', ['动作：删除用户', '结果：失败']],
      ['/admin/model-calls?source=gateway&success=false', '模型调用记录', ['通道：真实模型', '结果：失败']],
      ['/admin/invoices?status=pending&keyword=INV', '发票管理', ['状态：待开具', '关键词：INV']],
      ['/admin/coupons?type=full_cut&status=on', '优惠券', ['类型：满减', '状态：启用']],
      ['/admin/campaigns?status=active', '限时活动', ['状态：进行中']],
      ['/admin/credits?email=audit@test.local', '积分账本', ['邮箱：audit@test.local']],
      [
        '/admin/tickets?status=open&type=bug&priority=high&assigneeId=unassigned&q=INV',
        '工单处理',
        ['状态：待处理', '类型：功能异常', '优先级：高', '归属：仅未指派', '关键词：INV'],
      ],
      ['/admin/products?status=active', '商品管理', ['状态：在售']],
      [
        '/admin/reconciliation?channel=alipay&status=imported&from=2026-10-01&to=2026-10-31',
        '渠道对账',
        ['渠道：支付宝', '状态：待处置', '账单日 ≥ 2026-10-01', '账单日 ≤ 2026-10-31'],
      ],
      ['/admin/capabilities?q=image&runtime=unavailable', '能力管控', ['关键词：image', '运行结论：暂不可用']],
    ] as const;

    for (const [path, heading, labels] of cases) {
      await page.goto(`${UI}${path}`);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 15000 });
      const chips = page.locator('.adm-filter-chips');
      await expect(chips).toBeVisible();
      for (const label of labels) await expect(chips).toContainText(label);
    }
  });

  test('告警级别从地址栏恢复，并随切换同步', async ({ page }) => {
    await page.goto(`${UI}/admin/alerts?severity=critical`);
    await expect(page.getByRole('heading', { name: '告警中心' })).toBeVisible({
      timeout: 15000,
    });

    const toolbar = page.locator('.adm-alert-toolbar');
    await expect(toolbar.locator('.ant-segmented-item-selected')).toContainText('紧急');

    await toolbar.getByText(/^全部/).click();
    await expect(page).not.toHaveURL(/severity=critical/);
  });

  test('能力管控筛选会缩小结果集，并可一键清除', async ({ page }) => {
    await page.goto(`${UI}/admin/capabilities?q=__no_such_capability__`);
    await expect(page.getByRole('heading', { name: '能力管控' })).toBeVisible({
      timeout: 15000,
    });
    const chips = page.locator('.adm-filter-chips');
    await expect(chips).toContainText('关键词：__no_such_capability__');
    await expect(page.getByText('没有符合当前筛选的能力。')).toBeVisible();

    await page.getByRole('button', { name: '清除筛选' }).click();
    await expect(chips).toHaveCount(0);
    await expect(page.locator('.ant-table-tbody .ant-table-row').first()).toBeVisible();
  });

  test('核心宽表在 1440px 下无需横向滚动', async ({ page }) => {
    for (const [path, heading] of [
      ['/admin/orders', '订单管理'],
      ['/admin/tasks', '任务监控'],
      ['/admin/model-config', '模型配置'],
    ] as const) {
      await page.goto(`${UI}${path}`);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 15000 });
      await expect(page.locator('.adm-page-loading')).toHaveCount(0, { timeout: 30000 });
      await expect(page.locator('.ant-table-tbody .ant-table-row').first()).toBeVisible({
        timeout: 15000,
      });

      const m = await page.evaluate(() => {
        const table = document.querySelector('.ant-table-content') as HTMLElement | null;
        return { clientWidth: table?.clientWidth ?? 0, scrollWidth: table?.scrollWidth ?? 0 };
      });
      expect(m.clientWidth, `${heading}: 未找到表格`).toBeGreaterThan(0);
      expect(m.scrollWidth, `${heading}: 表格仍横向溢出`).toBeLessThanOrEqual(m.clientWidth + 2);
    }
  });

  test('营销规则修改后离开会先确认，并可放弃变更', async ({ page }) => {
    await page.goto(`${UI}/admin/marketing-rules`);
    await expect(page.getByRole('heading', { name: '邀请与签到' })).toBeVisible({
      timeout: 15000,
    });

    const inviter = page.locator('#i-inviter');
    const original = await inviter.inputValue();
    await inviter.fill(String(Number(original || '0') + 1));
    await expect(page.getByRole('button', { name: '放弃变更', exact: true })).toBeVisible();

    await page.locator('.adm-sider').getByRole('button', { name: /用户管理/ }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: '有未保存的变更' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '留下继续编辑' }).click();
    await expect(page).toHaveURL(/\/admin\/marketing-rules/);

    await page.getByRole('button', { name: '放弃变更', exact: true }).click();
    await expect(inviter).toHaveValue(original);
    await page.locator('.adm-sider').getByRole('button', { name: /用户管理/ }).click();
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible({ timeout: 15000 });
  });

  test('关闭有修改的商品抽屉会先确认是否放弃', async ({ page }) => {
    await page.goto(`${UI}/admin/products`);
    await expect(page.getByRole('heading', { name: '商品管理' })).toBeVisible({
      timeout: 15000,
    });
    await page
      .locator('.ant-table-tbody .ant-table-row')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => undefined);

    const edit = page.locator('.ant-table-tbody').getByRole('button', { name: '编辑' }).first();
    test.skip((await edit.count()) === 0, '当前库中暂无商品');
    await edit.click();

    const drawer = page.locator('.ant-drawer').filter({ hasText: '编辑商品' });
    await expect(drawer).toBeVisible();
    const name = drawer.locator('#p-name');
    await name.fill(`${await name.inputValue()} · 未保存`);

    await drawer.locator('.ant-drawer-close').click();
    const confirm = page.getByRole('dialog').filter({ hasText: '放弃未保存的修改？' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: '继续编辑' }).click();
    await expect(drawer).toBeVisible();

    await drawer.locator('.ant-drawer-close').click();
    await confirm.getByRole('button', { name: '放弃修改' }).click();
    await expect(drawer).toBeHidden();
  });

  test('营销、法务与消息模板抽屉同样保护未保存内容', async ({ page }) => {
    const cases = [
      ['/admin/coupons', '优惠券', '新建优惠券', '#c-name', '新建优惠券'],
      ['/admin/campaigns', '限时活动', '新建活动', '#k-name', '新建活动'],
      ['/admin/legal', '法务文档', '新建版本', '#lg-version', '新建法务文档版本'],
      ['/admin/notifications', '站内消息', '新建模板', '#tp-code', '新建消息模板'],
    ] as const;

    for (const [path, heading, openButton, field, drawerTitle] of cases) {
      await page.goto(`${UI}${path}`);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 15000 });
      await page.getByRole('button', { name: openButton, exact: true }).first().click();

      const drawer = page
        .locator('.ant-drawer')
        .filter({ hasText: drawerTitle })
        .filter({ has: page.locator(field) })
        .last();
      await expect(drawer).toBeVisible();
      await drawer.locator(field).fill('unsaved-check');
      await drawer.locator('.ant-drawer-close').click();
      const confirm = page.getByRole('dialog').filter({ hasText: '放弃未保存的修改？' });
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: '继续编辑' }).click();
      await expect(drawer).toBeVisible();

      await drawer.locator('.ant-drawer-close').click();
      await confirm.getByRole('button', { name: '放弃修改' }).click();
      await expect(page.locator('.ant-drawer-open')).toHaveCount(0);
    }
  });

  test('工单回复未发送时关闭详情会先确认', async ({ page }) => {
    await page.goto(`${UI}/admin/tickets`);
    await expect(page.getByRole('heading', { name: '工单处理' })).toBeVisible({
      timeout: 15000,
    });
    await page
      .locator('.ant-table-tbody .ant-table-row')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => undefined);

    const handle = page.locator('.ant-table-tbody').getByRole('button', { name: '处理' }).first();
    test.skip((await handle.count()) === 0, '当前库中暂无可处理工单');
    await handle.click();

    const drawer = page.locator('.ant-drawer').filter({ hasText: '回复用户' });
    const reply = drawer.locator('textarea');
    await expect(reply).toBeVisible({ timeout: 15000 });
    await reply.fill('这段回复还没发送');

    await drawer.locator('.ant-drawer-close').click();
    const confirm = page.getByRole('dialog').filter({ hasText: '放弃未保存的修改？' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: '继续编辑' }).click();
    await expect(drawer).toBeVisible();

    await drawer.locator('.ant-drawer-close').click();
    await confirm.getByRole('button', { name: '放弃修改' }).click();
    await expect(drawer).toBeHidden();
  });

  test('积分批量调整未提交时关闭会先确认', async ({ page }) => {
    await page.goto(`${UI}/admin/credits`);
    await expect(page.getByRole('heading', { name: '积分账本' })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: '批量调整' }).click();

    const drawer = page.locator('.ant-drawer').filter({ hasText: '批量调整积分' });
    await expect(drawer).toBeVisible();
    await drawer.locator('#b-lines').fill('user-1,100');

    await drawer.locator('.ant-drawer-close').click();
    const confirm = page.getByRole('dialog').filter({ hasText: '放弃未保存的修改？' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: '继续编辑' }).click();
    await expect(drawer).toBeVisible();

    await drawer.locator('.ant-drawer-close').click();
    await confirm.getByRole('button', { name: '放弃修改' }).click();
    await expect(drawer).toBeHidden();
  });

  test('角色权限修改后出现保存条，离开前二次确认', async ({ page }) => {
    await page.goto(`${UI}/admin/roles`);
    await expect(page.getByRole('heading', { name: '角色权限' })).toBeVisible({
      timeout: 15000,
    });

    // 只改动草稿，不点保存；测试结束后放弃，避免污染开发库里的真实权限
    await page.locator('.adm-perm-row').first().locator('input[type="checkbox"]').nth(1).click();

    const saveBar = page.locator('.adm-role-save-bar');
    await expect(saveBar).toBeVisible();
    await expect(saveBar).toContainText('未保存');
    await expect(saveBar.getByRole('button', { name: '保存全部变更' })).toBeEnabled();

    await page.locator('.adm-sider').getByRole('button', { name: /用户管理/ }).click();
    await expect(page.getByText('有未保存的变更')).toBeVisible();
    await page.getByRole('button', { name: '留下继续编辑' }).click();
    await expect(page).toHaveURL(/\/admin\/roles/);
    await expect(saveBar).toBeVisible();

    await saveBar.getByRole('button', { name: '放弃变更' }).click();
    await expect(saveBar).toHaveCount(0);
  });

  test('概览页最近任务可直达任务详情', async ({ page }) => {
    await page.goto(`${UI}/admin`);
    await expect(page.getByRole('heading', { name: '平台概览' })).toBeVisible({
      timeout: 15000,
    });

    const firstTask = page.locator('a.adm-task-item').first();
    test.skip((await firstTask.count()) === 0, '当前库中暂无任务记录');
    await firstTask.click();

    await expect(page).toHaveURL(/\/admin\/tasks\?id=/);
    await expect(page.locator('.adm-drawer')).toBeVisible({ timeout: 15000 });
  });

  test('任务详情可带用户条件直达积分账本', async ({ page }) => {
    await page.goto(`${UI}/admin/tasks`);
    await expect(page.getByRole('heading', { name: '任务监控' })).toBeVisible({
      timeout: 15000,
    });
    await page
      .locator('.ant-table-tbody .ant-table-row')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => undefined);

    const detail = page.locator('.ant-table-tbody').getByRole('button', { name: '详情' }).first();
    test.skip((await detail.count()) === 0, '当前库中暂无任务记录');
    await detail.click();

    const drawer = page.locator('.ant-drawer').filter({ hasText: '任务概要' });
    await expect(drawer).toBeVisible({ timeout: 15000 });

    const userLink = drawer.locator('.adm-desc a[href^="/admin/users?id="]').first();
    await expect(userLink).toBeVisible();
    const userHref = await userLink.getAttribute('href');
    const email = (await userLink.textContent())?.trim();
    expect(email).toBeTruthy();
    expect(new URL(userHref!, UI).searchParams.get('id')).toBeTruthy();

    const orderLink = drawer.getByRole('link', { name: '订单记录' });
    expect(new URL((await orderLink.getAttribute('href'))!, UI).searchParams.get('email')).toBe(
      email,
    );

    const creditsLink = drawer.getByRole('link', { name: '积分账本' });
    const creditsHref = new URL((await creditsLink.getAttribute('href'))!, UI);
    expect(creditsHref.searchParams.get('email')).toBe(email);
    const userId = creditsHref.searchParams.get('userId');
    expect(userId).toBeTruthy();

    await creditsLink.click();
    await expect(page.getByRole('heading', { name: '积分账本' })).toBeVisible({
      timeout: 15000,
    });
    await expect(page).toHaveURL(/\/admin\/credits\?/);
    await expect(page.locator('.adm-filter-chips')).toContainText(`邮箱：${email}`);
    await expect(page.locator('.adm-filter-chips')).toContainText(`用户 ID：${userId}`);
  });

  test('任务详情的项目入口会回到已筛选列表', async ({ page }) => {
    await page.goto(`${UI}/admin/tasks`);
    await expect(page.getByRole('heading', { name: '任务监控' })).toBeVisible({
      timeout: 15000,
    });
    await page
      .locator('.ant-table-tbody .ant-table-row')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => undefined);

    const detail = page.locator('.ant-table-tbody').getByRole('button', { name: '详情' }).first();
    test.skip((await detail.count()) === 0, '当前库中暂无任务记录');
    await detail.click();

    const drawer = page.locator('.ant-drawer').filter({ hasText: '任务概要' });
    await expect(drawer).toBeVisible({ timeout: 15000 });
    const projectLink = drawer.locator('.adm-desc a[href*="projectId="]').first();
    await expect(projectLink).toBeVisible();
    const projectId = new URL((await projectLink.getAttribute('href'))!, UI).searchParams.get(
      'projectId',
    );
    expect(projectId).toBeTruthy();

    await projectLink.click();
    await expect(page).toHaveURL(new RegExp(`projectId=${encodeURIComponent(projectId!)}`));
    await expect(drawer).toBeHidden();
    await expect(page.locator('.adm-filter-chips')).toContainText(`项目 ID：${projectId}`);
  });

  test('列表详情写入 id，刷新可恢复且关闭后移除', async ({ page }) => {
    await page.goto(`${UI}/admin/orders`);
    await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible({
      timeout: 15000,
    });
    await page
      .locator('.ant-table-tbody .ant-table-row')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 })
      .catch(() => undefined);

    const orderLink = page.locator('.ant-table-tbody a[href^="/admin/orders?id="]').first();
    test.skip((await orderLink.count()) === 0, '当前库中暂无订单');
    await orderLink.click();

    const drawer = page.locator('.ant-drawer').filter({ hasText: '订单概要' });
    await expect(drawer).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/\/admin\/orders\?id=/);

    await page.reload();
    await expect(drawer).toBeVisible({ timeout: 15000 });

    await drawer.locator('.ant-drawer-close').click();
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/[?&]id=/);

    await page.reload();
    await expect(page.locator('.ant-drawer')).toBeHidden();
  });
});
