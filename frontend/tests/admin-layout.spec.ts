import { test, expect } from '@playwright/test';
import { HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';

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
 * 外壳采用经典「上左右」：顶部 56px 承担品牌与账号，侧栏只放导航，
 * 导航区独立滚动。选择器统一走 `data-testid="admin-*"`。
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

  test('顶栏固定、侧栏占满剩余高度且导航区独立滚动', async ({ page }) => {
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
        headerBottom: Math.round(headerRect.bottom),
        siderTop: Math.round(r.top),
        height: Math.round(r.height),
        viewport: window.innerHeight,
        navOverflowY: getComputedStyle(navScroll).overflowY,
        docScrollH: document.documentElement.scrollHeight,
      };
    });

    // 顶栏固定 56px，侧栏从顶栏底部开始并占满剩余视口
    expect(m.headerHeight).toBe(56);
    expect(m.siderTop).toBe(m.headerBottom);
    expect(m.height).toBeLessThanOrEqual(m.viewport - m.headerHeight + 2);
    expect(m.height).toBeGreaterThan(400);
    // 长内容时导航区自身滚动
    expect(['auto', 'scroll']).toContain(m.navOverflowY);
  });

  test('品牌在顶栏左侧，账号在顶栏右侧', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${UI}/admin`);
    await page.waitForSelector('[data-testid="admin-header"]', { timeout: 15000 });
    await page.waitForSelector('[data-testid="admin-account-trigger"]', { timeout: 15000 });

    await expect(page.getByTestId('admin-brand')).toContainText('货觉');
    await expect(page.getByRole('button', { name: /折叠|收起侧栏|展开侧栏/ })).toHaveCount(0);

    const m = await page.evaluate(() => {
      const rect = (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement;
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      return {
        header: rect('[data-testid="admin-header"]'),
        brand: rect('[data-testid="admin-brand"]'),
        account: rect('[data-testid="admin-account-trigger"]'),
      };
    });

    expect(m.brand.left - m.header.left).toBeLessThan(32);
    expect(m.header.right - m.account.right).toBeLessThan(32);
    expect(m.account.left).toBeGreaterThan(m.brand.right);
    expect(m.brand.top).toBeGreaterThanOrEqual(m.header.top);
    expect(m.brand.bottom).toBeLessThanOrEqual(m.header.bottom);
    expect(m.account.top).toBeGreaterThanOrEqual(m.header.top);
    expect(m.account.bottom).toBeLessThanOrEqual(m.header.bottom);
  });

  test('用户表格行高一致、操作列不换行', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${UI}/admin/users`);
    await page.waitForSelector('[data-testid="admin-table-row"]', { timeout: 15000 });
    await page.waitForTimeout(800);

    const m = await page.evaluate(() => {
      const rows = Array.from(
        document.querySelectorAll('[data-testid="admin-table-row"]'),
      ) as HTMLElement[];
      return {
        heights: rows.map((r) => Math.round(r.getBoundingClientRect().height)),
        // 动作项数应 ≤2 (详情 + 更多), 多的应在下拉里
        counts: rows.map(
          (r) => r.querySelectorAll('td:last-child button').length,
        ),
      };
    });

    // 小号按钮是 32px，单元格 py-2.5 ⇒ 单行行高约 52px；
    // 换行会把行高撑到 70+，所以「所有行等高且 ≤60」就是没换行。
    const max = Math.max(...m.heights);
    const min = Math.min(...m.heights);
    expect(max, `最高行 ${max}px, 疑似换行`).toBeLessThanOrEqual(60);
    expect(max - min, `行高不一致(${min}~${max}px), 疑似个别行换行`).toBeLessThanOrEqual(2);
    for (const [i, c] of m.counts.entries()) {
      expect(c, `第 ${i} 行直显动作 ${c} 个, 应 ≤2`).toBeLessThanOrEqual(2);
    }
  });

  test('顶栏不提供全局搜索入口', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${UI}/admin/users`);
    await page.waitForSelector('[data-testid="admin-sider"]', { timeout: 15000 });

    await expect(page.getByTestId('admin-global-search-trigger')).toHaveCount(0);
    await page.keyboard.press('Control+K');
    await expect(page.getByRole('dialog', { name: '全局搜索' })).toHaveCount(0);
  });

  test('操作列的下拉菜单可用', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${UI}/admin/users`);
    await page.waitForSelector('[data-testid="admin-table-row"]', { timeout: 15000 });

    await page
      .getByTestId('admin-table-row')
      .first()
      .getByRole('button', { name: '更多' })
      .click();
    // shadcn DropdownMenu（radix 底座）：弹层是 role=menu，动作是 menuitem。
    // 菜单的可访问名由 RowMenu 显式给成「更多操作」，radix 默认会取触发器文字「更多」。
    const menu = page.getByRole('menu', { name: '更多操作' });
    await expect(menu).toBeVisible();
    expect(await menu.getByRole('menuitem').count()).toBeGreaterThanOrEqual(2);
  });

  test('审计详情在行内展开，不使用抽屉或确认弹窗', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${UI}/admin/audit-logs`);
    await page.waitForSelector('.adm-content', { timeout: 15000 });
    await page
      .waitForSelector('[data-testid="admin-table-row"]', { timeout: 15000 })
      .catch(() => undefined);

    const detailButton = page.getByRole('button', { name: '详情', exact: true }).first();
    test.skip((await detailButton.count()) === 0, '当前库中暂无审计记录');

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
