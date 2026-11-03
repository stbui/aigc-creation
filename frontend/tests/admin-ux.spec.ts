import { test, expect, type Page } from '@playwright/test';
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
 *
 * ## 选择器约定
 *
 * 2026-10-30 后台改版后，后台只保证两类钩子：
 * `data-testid="admin-*"`（共享控件）与 `aria-label`（表单控件）。不再使用
 * antd 的 `.ant-*`、也不再依赖旧版 `adm-*` 组件类。
 */
const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';
const PASSWORD = ADMIN_PASSWORD;

const chips = (page: Page) => page.getByTestId('admin-filter-chips');
const drawer = (page: Page) => page.getByTestId('admin-drawer');
const rows = (page: Page) => page.getByTestId('admin-table-row');

test.describe('后台高频动线', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  test('筛选条件从地址栏恢复，并可逐条清除', async ({ page }) => {
    await page.goto(`${UI}/admin/users?role=admin&status=active`);
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible({
      timeout: 15000,
    });

    await expect(chips(page)).toBeVisible();
    await expect(chips(page)).toContainText('角色：管理员');
    await expect(chips(page)).toContainText('状态：正常');

    await chips(page).getByRole('button', { name: '清除筛选：角色：管理员' }).click();

    await expect(page).not.toHaveURL(/role=admin/);
    await expect(page).toHaveURL(/status=active/);
    await expect(chips(page)).not.toContainText('角色：管理员');

    // 刷新后只恢复仍生效的条件，已清除的角色不能“复活”
    await page.reload();
    await expect(chips(page)).toContainText('状态：正常');
    await expect(
      page.getByTestId('admin-filter-chip').filter({ hasText: '角色：管理员' }),
    ).toHaveCount(0);
  });

  test('其余深链列表页同样回显已生效筛选', async ({ page }) => {
    const cases = [
      ['/admin/audit-logs?action=user.delete&success=false', '操作审计', ['动作：删除用户', '结果：失败']],
      ['/admin/model-calls?status=failed&requestKind=poll', '调用记录', ['状态：失败', '类型：轮询']],
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
        '/admin/payments?tab=reconciliation&providerId=alipay&status=failed&from=2026-10-01&to=2026-10-31',
        '支付充值',
        ['渠道：支付宝', '状态：失败', '起始：2026-10-01', '截止：2026-10-31'],      ],
      ['/admin/capabilities?q=image&runtime=unavailable', '能力管控', ['关键词：image', '运行结论：暂不可用']],
    ] as const;

    for (const [path, heading, labels] of cases) {
      await page.goto(`${UI}${path}`);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 15000 });
      await expect(chips(page)).toBeVisible();
      for (const label of labels) await expect(chips(page)).toContainText(label);
    }
  });

  test('调用详情按当前行渲染，不为渠道任务号拼本地任务页坏链', async ({ page }) => {
    const row = {
      id: 'test-gateway-task',
      userId: 'u-1',
      traceId: 'trace-1',
      requestId: 'req-1',
      channelId: 'ch-1',
      channelName: 'a6api',
      taskId: '1793119194',
      billingOrderId: 'bill-1',
      source: 'gateway',
      capability: 'free_create',
      operation: 'images.generate',
      requestKind: 'create',
      billable: true,
      apiFormat: 'openai-image',
      method: 'POST',
      path: '/v1/images/generations',
      model: 'gpt-image-1',
      status: 'failed',
      statusCode: 500,
      durationMs: 179,
      pollCount: 0,
      providerStatus: 'failed',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      usageAvailable: false,
      mediaCount: 0,
      videoSeconds: 0,
      providerRequestId: 'prov-1',
      estimatedCostMicros: 0,
      costAvailable: false,
      currency: 'USD',
      errorCode: '42201',
      error: '渠道返回失败',
      createdAt: '2026-10-31T08:00:00.000Z',
    };

    await page.route(/\/api\/v1\/admin\/api-logs(\?|$)/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            items: [row],
            total: 1,
            page: 1,
            pageSize: 20,
            summary: { total: 1, success: 0, failed: 1, other: 0, avgDurationMs: 179 },
          },
        }),
      }),
    );

    // 渠道任务号只做文本展示，不能拼成本地任务页链接（历史实现会稳定 404）
    await page.goto(`${UI}/admin/model-calls?id=test-gateway-task`);
    await expect(drawer(page)).toBeVisible({ timeout: 15000 });
    await expect(drawer(page).getByText('1793119194')).toBeVisible();
    await expect(drawer(page).getByText('a6api（ch-1）')).toBeVisible();
    await expect(drawer(page).getByRole('link')).toHaveCount(0);
  });

  test('调用统计卡与 summary 同口径，成功与失败条数之和不超过总数', async ({ page }) => {
    const summary = { total: 7, success: 4, failed: 2, other: 1, avgDurationMs: 321 };
    const row = {
      id: 'summary-row',
      userId: 'u-1',
      traceId: 'trace-1',
      requestId: 'req-1',
      channelId: 'ch-1',
      channelName: 'a6api',
      taskId: 'task-1',
      billingOrderId: 'bill-1',
      source: 'gateway',
      capability: 'free_create',
      operation: 'images.generate',
      requestKind: 'create',
      billable: true,
      apiFormat: 'openai-image',
      method: 'POST',
      path: '/v1/images/generations',
      model: 'gpt-image-1',
      status: 'canceled',
      statusCode: 200,
      durationMs: 321,
      pollCount: 0,
      providerStatus: 'canceled',
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      usageAvailable: false,
      mediaCount: 1,
      videoSeconds: 0,
      providerRequestId: 'prov-1',
      estimatedCostMicros: 0,
      costAvailable: false,
      currency: 'USD',
      errorCode: '',
      error: '',
      createdAt: '2026-10-31T08:00:00.000Z',
    };

    await page.route(/\/api\/v1\/admin\/api-logs(\?|$)/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: { items: [row], total: 1, page: 1, pageSize: 20, summary },
        }),
      }),
    );

    await page.goto(`${UI}/admin/model-calls`);
    await expect(page.getByRole('heading', { name: '调用记录' })).toBeVisible({
      timeout: 15000,
    });
    await expect(rows(page).first()).toBeVisible();

    // StatCard 的结构：标签 / 数值 / 可选提示，三者都是根节点的直接子 div
    const card = (label: string) => page.getByText(label, { exact: true }).first().locator('..');
    const value = async (label: string) =>
      Number((await card(label).locator('div').nth(1).textContent()) ?? '0');

    expect(await value('调用总数')).toBe(summary.total);
    expect(await value('成功')).toBe(summary.success);
    expect(await value('失败 / 取消')).toBe(summary.failed);
    // 「其它」只出现在平均耗时卡片的提示行：总数 − 成功 − 失败 的部分不会被吞掉
    await expect(card('平均耗时')).toContainText(`其它状态 ${summary.other} 条`);
    expect(summary.success + summary.failed + summary.other).toBe(summary.total);
  });

  test('告警级别从地址栏恢复，并随切换同步', async ({ page }) => {
    await page.goto(`${UI}/admin/alerts?severity=critical`);
    await expect(page.getByRole('heading', { name: '告警中心' })).toBeVisible({
      timeout: 15000,
    });

    // 分段控件是单选组（radiogroup），不是一组普通按钮
    await expect(page.getByRole('radio', { name: /^紧急/ })).toBeChecked();

    await page.getByRole('radio', { name: /^全部/ }).click();
    await expect(page).not.toHaveURL(/severity=critical/);
  });

  test('能力管控筛选会缩小结果集，并可一键清除', async ({ page }) => {
    await page.goto(`${UI}/admin/capabilities?q=__no_such_capability__`);
    await expect(page.getByRole('heading', { name: '能力管控' })).toBeVisible({
      timeout: 15000,
    });
    await expect(chips(page)).toContainText('关键词：__no_such_capability__');
    await expect(page.getByText('没有符合当前筛选的能力。')).toBeVisible();

    await page.getByRole('button', { name: '清除筛选', exact: true }).click();
    await expect(chips(page)).toHaveCount(0);
    await expect(page.getByTestId('admin-table-row').first()).toBeVisible();
  });

  test('核心宽表在 1440px 下无需横向滚动', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [path, heading] of [
      ['/admin/orders', '订单管理'],
      ['/admin/tasks', '任务监控'],
      ['/admin/model-calls', '调用记录'],
      ['/admin/channels', '渠道工作台'],
    ] as const) {
      await page.goto(`${UI}${path}`);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('admin-page-loading')).toHaveCount(0, { timeout: 30000 });
      await expect(rows(page).first()).toBeVisible({ timeout: 15000 });

      const m = await page.evaluate(() => {
        const scroll = document.querySelector('[data-testid="admin-table-scroll"]') as HTMLElement | null;
        return { clientWidth: scroll?.clientWidth ?? 0, scrollWidth: scroll?.scrollWidth ?? 0 };
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

    const inviter = page.getByLabel('邀请人奖励积分', { exact: true });
    const original = await inviter.inputValue();
    await inviter.fill(String(Number(original || '0') + 1));
    await expect(page.getByRole('button', { name: '放弃变更', exact: true })).toBeVisible();

    await page
      .getByTestId('admin-sider')
      .getByRole('button', { name: /用户管理/ })
      .click();
    const dialog = page.getByRole('dialog').filter({ hasText: '有未保存的变更' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '留下继续编辑' }).click();
    await expect(page).toHaveURL(/\/admin\/marketing-rules/);

    await page.getByRole('button', { name: '放弃变更', exact: true }).click();
    await expect(inviter).toHaveValue(original);
    await page
      .getByTestId('admin-sider')
      .getByRole('button', { name: /用户管理/ })
      .click();
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible({ timeout: 15000 });
  });

  test('关闭有修改的商品抽屉会先确认是否放弃', async ({ page }) => {
    await page.goto(`${UI}/admin/products`);
    await expect(page.getByRole('heading', { name: '商品管理' })).toBeVisible({
      timeout: 15000,
    });
    await rows(page).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);

    const edit = rows(page).getByRole('button', { name: '编辑' }).first();
    test.skip((await edit.count()) === 0, '当前库中暂无商品');
    await edit.click();

    const panel = page.getByRole('dialog', { name: '编辑商品' });
    await expect(panel).toBeVisible();
    const name = panel.getByLabel('商品名称');
    await name.fill(`${await name.inputValue()} · 未保存`);

    await panel.getByRole('button', { name: '关闭' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: '放弃未保存的修改？' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: '继续编辑' }).click();
    await expect(panel).toBeVisible();

    await panel.getByRole('button', { name: '关闭' }).click();
    await confirm.getByRole('button', { name: '放弃修改' }).click();
    await expect(drawer(page)).toHaveCount(0);
  });

  test('营销、法务与消息模板抽屉同样保护未保存内容', async ({ page }) => {
    const cases = [
      ['/admin/coupons', '优惠券', '新建优惠券', '券名称', '新建优惠券'],
      ['/admin/campaigns', '限时活动', '新建活动', '活动名称', '新建活动'],
      ['/admin/legal', '法务文档', '新建版本', '版本号', '新建法务文档版本'],
      ['/admin/notifications', '站内消息', '新建模板', '模板编码', '新建消息模板'],
    ] as const;

    for (const [path, heading, openButton, fieldLabel, drawerTitle] of cases) {
      await page.goto(`${UI}${path}`);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 15000 });
      await page.getByRole('button', { name: openButton, exact: true }).first().click();

      const panel = page.getByRole('dialog', { name: drawerTitle });
      await expect(panel).toBeVisible();
      await panel.getByLabel(fieldLabel).fill('unsaved-check');
      await panel.getByRole('button', { name: '关闭' }).click();
      const confirm = page.getByRole('dialog').filter({ hasText: '放弃未保存的修改？' });
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: '继续编辑' }).click();
      await expect(panel).toBeVisible();

      await panel.getByRole('button', { name: '关闭' }).click();
      await confirm.getByRole('button', { name: '放弃修改' }).click();
      await expect(drawer(page)).toHaveCount(0);
    }
  });

  test('工单回复未发送时关闭详情会先确认', async ({ page }) => {
    await page.goto(`${UI}/admin/tickets`);
    await expect(page.getByRole('heading', { name: '工单处理' })).toBeVisible({
      timeout: 15000,
    });
    await rows(page).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);

    const handle = rows(page).getByRole('button', { name: '处理' }).first();
    test.skip((await handle.count()) === 0, '当前库中暂无可处理工单');
    await handle.click();

    const panel = drawer(page);
    const reply = panel.getByLabel('回复内容');
    await expect(reply).toBeVisible({ timeout: 15000 });
    await reply.fill('这段回复还没发送');

    await panel.getByRole('button', { name: '关闭' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: '放弃未保存的修改？' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: '继续编辑' }).click();
    await expect(panel).toBeVisible();

    await panel.getByRole('button', { name: '关闭' }).click();
    await confirm.getByRole('button', { name: '放弃修改' }).click();
    await expect(drawer(page)).toHaveCount(0);
  });

  test('积分批量调整未提交时关闭会先确认', async ({ page }) => {
    await page.goto(`${UI}/admin/credits`);
    await expect(page.getByRole('heading', { name: '积分账本' })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: '批量调整' }).click();

    const panel = drawer(page);
    await expect(panel).toBeVisible();
    await panel.getByLabel('调整清单').fill('user-1,100');

    await panel.getByRole('button', { name: '关闭' }).click();
    const confirm = page.getByRole('dialog').filter({ hasText: '放弃未保存的修改？' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: '继续编辑' }).click();
    await expect(panel).toBeVisible();

    await panel.getByRole('button', { name: '关闭' }).click();
    await confirm.getByRole('button', { name: '放弃修改' }).click();
    await expect(drawer(page)).toHaveCount(0);
  });

  test('角色权限修改后出现保存条，离开前二次确认', async ({ page }) => {
    await page.goto(`${UI}/admin/roles`);
    await expect(page.getByRole('heading', { name: '角色权限' })).toBeVisible({
      timeout: 15000,
    });

    // 只改动草稿，不点保存；测试结束后放弃，避免污染开发库里的真实权限。
    // 复选框的可视勾选框会挡住指针，这里用键盘操作，也更贴近无障碍真实路径。
    const permission = page.getByRole('checkbox', { name: '运营 · 查看平台概览' });
    await permission.focus();
    await page.keyboard.press('Space');

    const saveBar = page.getByTestId('admin-role-save-bar');
    await expect(saveBar).toBeVisible();
    await expect(saveBar).toContainText('未保存');
    const saveButton = saveBar.getByRole('button', { name: '保存全部变更' });
    await expect(saveBar.getByRole('textbox', { name: '变更原因' })).toHaveCount(0);
    await expect(saveButton).toBeEnabled();

    await page
      .getByTestId('admin-sider')
      .getByRole('button', { name: /用户管理/ })
      .click();
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

    const firstTask = page.getByRole('link', { name: /^查看产出任务：/ }).first();
    test.skip((await firstTask.count()) === 0, '当前库中暂无产出图');
    await firstTask.click();

    await expect(page).toHaveURL(/\/admin\/tasks\?id=/);
    await expect(drawer(page)).toBeVisible({ timeout: 15000 });
  });

  test('任务详情可带用户条件直达积分账本', async ({ page }) => {
    await page.goto(`${UI}/admin/tasks`);
    await expect(page.getByRole('heading', { name: '任务监控' })).toBeVisible({
      timeout: 15000,
    });
    await rows(page).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);

    const detail = rows(page).getByRole('button', { name: '详情' }).first();
    test.skip((await detail.count()) === 0, '当前库中暂无任务记录');
    await detail.click();

    const panel = page.getByRole('dialog', { name: '任务详情' });
    await expect(panel).toBeVisible({ timeout: 15000 });

    // 后台不加载 preflight，必须显式清掉 dl / dd 的浏览器默认边距，避免值整体右缩。
    const descriptions = panel.getByTestId('admin-desc').first();
    await expect(descriptions).toHaveCSS('margin-top', '0px');
    await expect(descriptions.locator('dd').first()).toHaveCSS('margin-left', '0px');

    const userLink = panel.locator('a[href^="/admin/users?id="]').first();
    await expect(userLink).toBeVisible();
    // 抽屉挂在 body 下，必须带上 admin-portal 才能继承后台链接排版：
    // 品牌紫、500 字重、默认无下划线（悬停/聚焦才出现）。
    await expect(userLink).toHaveCSS('font-weight', '500');
    await expect(userLink).toHaveCSS('text-decoration-line', 'none');
    const userHref = await userLink.getAttribute('href');
    const email = (await userLink.textContent())?.trim();
    expect(email).toBeTruthy();
    expect(new URL(userHref!, UI).searchParams.get('id')).toBeTruthy();

    const orderLink = panel.getByRole('link', { name: '订单记录' });
    expect(new URL((await orderLink.getAttribute('href'))!, UI).searchParams.get('email')).toBe(
      email,
    );

    const creditsLink = panel.getByRole('link', { name: '积分账本' });
    const creditsHref = new URL((await creditsLink.getAttribute('href'))!, UI);
    expect(creditsHref.searchParams.get('email')).toBe(email);
    const userId = creditsHref.searchParams.get('userId');
    expect(userId).toBeTruthy();

    await creditsLink.click();
    await expect(page.getByRole('heading', { name: '积分账本' })).toBeVisible({
      timeout: 15000,
    });
    await expect(page).toHaveURL(/\/admin\/credits\?/);
    await expect(chips(page)).toContainText(`邮箱：${email}`);
    await expect(chips(page)).toContainText(`用户 ID：${userId}`);
  });

  test('任务详情的项目入口会回到已筛选列表', async ({ page }) => {
    await page.goto(`${UI}/admin/tasks`);
    await expect(page.getByRole('heading', { name: '任务监控' })).toBeVisible({
      timeout: 15000,
    });
    await rows(page).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);

    const detail = rows(page).getByRole('button', { name: '详情' }).first();
    test.skip((await detail.count()) === 0, '当前库中暂无任务记录');
    await detail.click();

    const panel = page.getByRole('dialog', { name: '任务详情' });
    await expect(panel).toBeVisible({ timeout: 15000 });
    const projectLink = panel.locator('a[href*="projectId="]').first();
    await expect(projectLink).toBeVisible();
    const projectId = new URL((await projectLink.getAttribute('href'))!, UI).searchParams.get(
      'projectId',
    );
    expect(projectId).toBeTruthy();

    await projectLink.click();
    await expect(page).toHaveURL(new RegExp(`projectId=${encodeURIComponent(projectId!)}`));
    await expect(drawer(page)).toHaveCount(0);
    await expect(chips(page)).toContainText(`项目 ID：${projectId}`);
  });

  test('第二页任务直链仍显示详情与删除操作', async ({ page }) => {
    await page.goto(`${UI}/admin/tasks`);
    await expect(page.getByRole('heading', { name: '任务监控' })).toBeVisible({
      timeout: 15000,
    });

    // 取一条不在默认第一页的已完成任务，覆盖“列表里没有该行”时由详情合成
    // 操作行摘要的路径。直接读页面现有登录态，避免另起一套 API 鉴权。
    const task = await page.evaluate(async () => {
      const token = localStorage.getItem('ecom_vision_token');
      const response = await fetch(
        '/api/v1/admin/tasks?status=succeeded&page=2&pageSize=20',
        { headers: token ? { Authorization: `Bearer ${token}` } : {} },
      );
      if (!response.ok) return null;
      const body = (await response.json()) as {
        data?: { result?: { items?: Array<{ id: string }> } };
      };
      return body.data?.result?.items?.[0] ?? null;
    });
    test.skip(!task?.id, '当前库中暂无第二页已完成任务');

    await page.goto(`${UI}/admin/tasks?id=${encodeURIComponent(task!.id)}`);
    const panel = page.getByRole('dialog', { name: '任务详情' });
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(panel.getByText('任务概要', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: '删除此任务' })).toBeVisible();
  });

  test('列表详情写入 id，刷新可恢复且关闭后移除', async ({ page }) => {
    await page.goto(`${UI}/admin/orders`);
    await expect(page.getByRole('heading', { name: '订单管理' })).toBeVisible({
      timeout: 15000,
    });
    await rows(page).first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => undefined);

    const orderLink = rows(page).locator('a[href^="/admin/orders?id="]').first();
    test.skip((await orderLink.count()) === 0, '当前库中暂无订单');
    await orderLink.click();

    const panel = page.getByRole('dialog', { name: '订单详情' });
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(/\/admin\/orders\?id=/);

    await page.reload();
    await expect(panel).toBeVisible({ timeout: 15000 });

    await panel.getByRole('button', { name: '关闭' }).click();
    await expect(drawer(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/[?&]id=/);

    await page.reload();
    await expect(drawer(page)).toHaveCount(0);
  });
});
