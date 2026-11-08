import { test, expect } from '@playwright/test';
import { HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';
import { createAdminAuditFixture } from './support/admin-business-fixtures';

/**
 * 后台布局回归。
 *
 * 守住两个曾经出过的问题:
 *   1. antd Layout 默认 column → 侧栏与内容竖排重叠(内容未扣侧栏宽度)
 *   2. 操作列平铺过多动作 → 换行把行高从 44 撑到 51+
 *
 * 断言用几何量测而非截图比对 —— 截图会被无关的样式改动弄红,
 * 而"内容区宽度 =视口 -侧栏" 与 "行高 ≤ 46" 是硬约束, 不会因视觉微调而失效。
 *
 * 外壳采用 shadcn Sidebar 组合：侧栏占满视口高度（品牌头 + 导航 + 账号底），
 * 内容区顶部是 56px 顶栏（折叠开关 + 面包屑），导航区独立滚动。
 * 选择器统一走 `data-testid="admin-*"`。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

const PAGES = [
  ['/admin', '平台概览'],
  ['/admin/users', '用户管理'],
  ['/admin/roles', '角色权限'],
  ['/admin/settings', '系统设置'],
  ['/admin/audit-logs', '操作审计'],
];

const SIZES: Array<[number, number]> = [
  [1920, 1080],
  [1440, 900],
  [1280, 800],
];

test.describe('后台布局', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  let auditFixture: Awaited<ReturnType<typeof createAdminAuditFixture>> | null = null;

  test.beforeAll(async () => {
    if (!HAS_ADMIN_CREDENTIALS) return;
    auditFixture = await createAdminAuditFixture();
  });

  for (const [w, h] of SIZES) {
    test(`${w}px 宽下内容区正确扣除侧栏宽度且无横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });

      for (const [path, name] of PAGES) {
        await page.goto(`${UI}${path}`);
        await page.waitForSelector('[data-testid="admin-sider"]', { timeout: 15000 });
        await page.waitForTimeout(600);

        const m = await page.evaluate(() => {
          const sider = document.querySelector('[data-testid="admin-sider"]')?.getBoundingClientRect();
          const content = document.querySelector('.adm-content')?.getBoundingClientRect();
          return {
            siderW: sider?.width ?? 0,
            contentW: content?.width ?? 0,
            contentLeft: content?.left ?? 0,
            docW: document.documentElement.scrollWidth,
            winW: window.innerWidth,
          };
        });

        // 内容区左边必须紧贴侧栏右边(不相交、不留空)
        expect(
          Math.abs(m.contentLeft - m.siderW),
          `${name}: 内容区未与侧栏对齐(left=${m.contentLeft}, sider=${m.siderW})`,
        ).toBeLessThanOrEqual(2);

        // 无横向溢出
        expect(m.docW, `${name}: 出现横向溢出`).toBeLessThanOrEqual(m.winW + 2);
      }
    });
  }

  test('侧栏首次默认全展开，折叠分组互不影响', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${UI}/admin`);
    await page.waitForSelector('[data-testid="admin-sider"]', { timeout: 15000 });

    // 清除历史偏好，验证首次进入的默认态，而不是测试浏览器里残留的折叠状态。
    await page.evaluate(() => localStorage.removeItem('huojue.admin.sidebar-groups'));
    await page.reload();
    const nav = page.getByTestId('admin-sider');
    const overview = nav.getByRole('button', { name: '总览', exact: true });
    const operations = nav.getByRole('button', { name: '运营', exact: true });

    await expect(overview).toHaveAttribute('aria-expanded', 'true');
    await expect(operations).toHaveAttribute('aria-expanded', 'true');

    await overview.click();
    await expect(overview).toHaveAttribute('aria-expanded', 'false');
    await expect(operations).toHaveAttribute('aria-expanded', 'true');
    await expect(nav.getByRole('button', { name: '用户管理', exact: true })).toBeVisible();
  });

  test('顶栏固定 56px、侧栏占满视口且导航区独立滚动', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${UI}/admin/roles`); // 权限页最长, 最能暴露滚动问题
    await page.waitForSelector('[data-testid="admin-header"]', { timeout: 15000 });
    await page.waitForSelector('[data-testid="admin-nav-scroll"]', { timeout: 15000 });

    const m = await page.evaluate(() => {
      const header = document.querySelector('[data-testid="admin-header"]') as HTMLElement;
      const sider = document.querySelector('[data-testid="admin-sider"]') as HTMLElement;
      const navScroll = document.querySelector('[data-testid="admin-nav-scroll"]') as HTMLElement;
      const headerRect = header.getBoundingClientRect();
      const r = sider.getBoundingClientRect();
      return {
        headerHeight: Math.round(headerRect.height),
        headerTop: Math.round(headerRect.top),
        siderTop: Math.round(r.top),
        height: Math.round(r.height),
        viewport: window.innerHeight,
        navOverflowY: getComputedStyle(navScroll).overflowY,
      };
    });

    // 侧栏全高，顶栏在内容区顶部固定 56px（不随内容滚动）
    expect(m.headerHeight).toBe(56);
    expect(m.headerTop).toBe(0);
    expect(m.siderTop).toBe(0);
    expect(Math.abs(m.height - m.viewport)).toBeLessThanOrEqual(2);
    // 长内容时导航区自身滚动
    expect(['auto', 'scroll']).toContain(m.navOverflowY);
  });

  test('品牌在侧栏顶部，账号在侧栏底部', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${UI}/admin`);
    await page.waitForSelector('[data-testid="admin-sider"]', { timeout: 15000 });
    await page.waitForSelector('[data-testid="admin-account-trigger"]', { timeout: 15000 });

    const sider = page.getByTestId('admin-sider');
    await expect(sider.getByTestId('admin-brand')).toContainText('货觉');
    await expect(sider.getByTestId('admin-account-trigger')).toBeVisible();

    const m = await page.evaluate(() => {
      const rect = (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      return {
        sider: rect('[data-testid="admin-sider"]'),
        brand: rect('[data-testid="admin-brand"]'),
        account: rect('[data-testid="admin-account-trigger"]'),
      };
    });

    expect(m.brand.top - m.sider.top).toBeLessThan(32);
    expect(m.sider.bottom - m.account.bottom).toBeLessThan(32);
    expect(m.account.top).toBeGreaterThan(m.brand.bottom);
    expect(m.brand.left).toBeGreaterThanOrEqual(m.sider.left);
    expect(m.account.right).toBeLessThanOrEqual(m.sider.right + 1);
  });

  test('用户列表使用四列卡片网格且操作平铺', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${UI}/admin/users`);
    await page.waitForSelector('[data-testid="admin-user-card"]', { timeout: 15000 });
    await page.waitForTimeout(800);

    const m = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('[data-testid="admin-user-card"]'),
      ) as HTMLElement[];
      const grid = document.querySelector('[data-testid="admin-user-grid"]') as HTMLElement | null;
      const actionGroups = cards.map(
        (card) =>
          card.querySelector('[data-testid="admin-user-card-actions"]') as HTMLElement | null,
      );
      return {
        gridDisplay: grid ? getComputedStyle(grid).display : '',
        columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
        counts: cards.map(
          (card) =>
            card
              .querySelector('[data-testid="admin-user-card-actions"]')
              ?.querySelectorAll('button').length ?? 0,
        ),
        actionDisplays: actionGroups.map((group) => (group ? getComputedStyle(group).display : '')),
        actionColumns: actionGroups.map((group) =>
          group ? getComputedStyle(group).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
        ),
      };
    });

    expect(m.gridDisplay).toBe('grid');
    expect(m.columns).toBe(4);
    // 当前登录管理员等身份会少显示高风险操作，不能假设每张卡片都有同样权限。
    // 页面只需保证所有可用操作平铺在四列网格中，且至少有一个完整操作组可验证布局。
    expect(Math.min(...m.counts)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...m.counts)).toBeGreaterThanOrEqual(3);
    expect(m.actionDisplays.every((display) => display === 'grid')).toBe(true);
    expect(m.actionColumns.every((columns) => columns === 4)).toBe(true);
  });

  test('顶栏不提供全局搜索入口', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${UI}/admin/users`);
    await page.waitForSelector('[data-testid="admin-sider"]', { timeout: 15000 });

    await expect(page.getByTestId('admin-global-search-trigger')).toHaveCount(0);
    await page.keyboard.press('Control+K');
    await expect(page.getByRole('dialog', { name: '全局搜索' })).toHaveCount(0);
  });

  test('点击用户卡片打开详情', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${UI}/admin/users`);
    await page.waitForSelector('[data-testid="admin-user-card"]', { timeout: 15000 });

    const firstCard = page.getByTestId('admin-user-card').first();
    await firstCard.getByRole('button', { name: /查看用户 .* 详情/ }).click();

    const drawer = page.getByTestId('admin-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { name: '用户详情' })).toBeVisible();
    await expect(drawer.getByText('账号资料、登录活动与最近使用情况')).toBeVisible();
    await expect(drawer.getByRole('link', { name: '任务记录' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: '订单记录' })).toBeVisible();
    await expect(drawer.getByRole('link', { name: '积分账本' })).toBeVisible();
    await expect(drawer.getByRole('heading', { name: '会员', exact: true })).toBeVisible();
    await expect(drawer.getByTestId('admin-user-membership')).toBeVisible();

    const bodyOverflow = await drawer.locator('.overflow-y-auto').evaluate((el) => ({
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
    }));
    expect(bodyOverflow.scrollWidth).toBeLessThanOrEqual(bodyOverflow.clientWidth);

    await drawer.getByRole('button', { name: '关闭' }).click();
    await expect(drawer).toHaveCount(0);
  });

  test('审计详情在行内展开，不使用抽屉或确认弹窗', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(
      `${UI}/admin/audit-logs?action=${encodeURIComponent(auditFixture!.action)}&targetId=${encodeURIComponent(auditFixture!.productId)}`,
    );
    await page.waitForSelector('.adm-content', { timeout: 15000 });
    await page.waitForSelector('[data-testid="admin-table-row"]', { timeout: 15000 });

    const detailButton = page.getByRole('button', { name: '详情', exact: true }).first();
    await expect(detailButton).toBeVisible();

    await detailButton.click();
    await expect(page.getByTestId('admin-table-expanded')).toBeVisible();
    await expect(page.getByText('审计详情', { exact: true })).toBeVisible();
    await expect(page.getByTestId('admin-drawer')).toHaveCount(0);
    await expect(page.getByTestId('admin-modal')).toHaveCount(0);
    await expect(page.getByTestId('admin-confirm-action')).toHaveCount(0);

    await page.getByRole('button', { name: '收起', exact: true }).click();
    await expect(page.getByTestId('admin-table-expanded')).toHaveCount(0);
  });

  test('窄版表单页的面板与保存条左对齐且同宽', async ({ page }) => {
    // 回归：`.adm-content > *` 的居中限宽会把窄面板推到内容区中线附近，
    // 而同页另一块面板是左对齐 —— 两块的左边缘差出 190px 以上。
    await page.setViewportSize({ width: 1440, height: 900 });

    for (const [path, label] of [
      ['/admin/settings', '系统设置'],
      ['/admin/marketing-rules', '营销规则'],
    ] as const) {
      await page.goto(`${UI}${path}`);
      await page.waitForSelector('[data-testid="admin-panel"]', { timeout: 15000 });
      await page.waitForTimeout(400);

      const m = await page.evaluate(() => {
        const panels = Array.from(document.querySelectorAll('[data-testid="admin-panel"]'))
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.width > 0)
          .map((r) => ({ left: Math.round(r.left), width: Math.round(r.width) }));
        const bar = document.querySelector('[data-testid="admin-save-bar"]')?.getBoundingClientRect();
        return {
          panels,
          bar: bar && bar.width > 0 ? { left: Math.round(bar.left), width: Math.round(bar.width) } : null,
        };
      });

      expect(m.panels.length, `${label}: 未找到窄版面板`).toBeGreaterThanOrEqual(2);
      const [first] = m.panels;
      for (const panel of m.panels) {
        expect(Math.abs(panel.left - first.left), `${label}: 面板左边缘不一致`).toBeLessThanOrEqual(1);
        expect(Math.abs(panel.width - first.width), `${label}: 面板宽度不一致`).toBeLessThanOrEqual(1);
      }
      expect(first.width, `${label}: 窄版面板应限宽 760px`).toBeLessThanOrEqual(761);

      // 保存条必须与面板同宽同左边缘（宽版页面没有窄保存条则跳过）
      if (m.bar) {
        expect(Math.abs(m.bar.left - first.left), `${label}: 保存条与面板左边缘不一致`).toBeLessThanOrEqual(1);
        expect(Math.abs(m.bar.width - first.width), `${label}: 保存条与面板宽度不一致`).toBeLessThanOrEqual(1);
      }
    }
  });

  test('1440px 下筛选条不换行', async ({ page }) => {
    // 回归：订单/任务页的筛选项 + 查询重置曾撑到两行，结束日期单独掉行。
    await page.setViewportSize({ width: 1440, height: 900 });

    for (const [path, label] of [
      ['/admin/orders', '订单'],
      ['/admin/tasks', '任务'],
    ] as const) {
      await page.goto(`${UI}${path}`);
      await page.waitForSelector('[data-testid="admin-filter"]', { timeout: 15000 });
      await page.waitForTimeout(400);

      const rows = await page.evaluate(() => {
        const bar = document.querySelector('[data-testid="admin-filter"]');
        if (!bar) return 0;
        const tops = new Set<number>();
        for (const el of Array.from(bar.children)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0) tops.add(Math.round(rect.top));
        }
        return tops.size;
      });

      expect(rows, `${label} 页筛选条发生换行`).toBe(1);
    }
  });
});
