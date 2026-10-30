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
 * 2026-10-30 外壳换成 BoardUI 单栏结构：没有顶部 header，侧栏自带品牌头，
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

  test('侧栏占满视口高度且导航区独立滚动', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${UI}/admin/roles`); // 权限页最长, 最能暴露滚动问题
    await page.waitForSelector('[data-testid="admin-nav-scroll"]', { timeout: 15000 });

    const m = await page.evaluate(() => {
      const sider = document.querySelector('[data-testid="admin-sider"]') as HTMLElement;
      const navScroll = document.querySelector('[data-testid="admin-nav-scroll"]') as HTMLElement;
      const head = document.querySelector('[data-testid="admin-sider-head"]') as HTMLElement;
      const r = sider.getBoundingClientRect();
      return {
        height: Math.round(r.height),
        viewport: window.innerHeight,
        headH: Math.round(head.getBoundingClientRect().height),
        navOverflowY: getComputedStyle(navScroll).overflowY,
        docScrollH: document.documentElement.scrollHeight,
      };
    });

    // 侧栏高度 = 视口高度（单栏结构，没有顶部 header 要扣）
    expect(m.height).toBeLessThanOrEqual(m.viewport + 2);
    expect(m.height).toBeGreaterThan(400);
    // 品牌头固定 56px 不参与滚动
    expect(m.headH).toBeGreaterThan(40);
    expect(m.headH).toBeLessThanOrEqual(64);
    // 长内容时导航区自身滚动
    expect(['auto', 'scroll']).toContain(m.navOverflowY);
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

    // BoardUI small 按钮是 32px，单元格 py-2.5 ⇒ 单行行高约 52px；
    // 换行会把行高撑到 70+，所以「所有行等高且 ≤60」就是没换行。
    const max = Math.max(...m.heights);
    const min = Math.min(...m.heights);
    expect(max, `最高行 ${max}px, 疑似换行`).toBeLessThanOrEqual(60);
    expect(max - min, `行高不一致(${min}~${max}px), 疑似个别行换行`).toBeLessThanOrEqual(2);
    for (const [i, c] of m.counts.entries()) {
      expect(c, `第 ${i} 行直显动作 ${c} 个, 应 ≤2`).toBeLessThanOrEqual(2);
    }
  });

  test('全局搜索可用 Ctrl+K 唤起并支持 Esc 关闭', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${UI}/admin/users`);
    await page.waitForSelector('[data-testid="admin-sider"]', { timeout: 15000 });

    await page.keyboard.press('Control+K');
    const search = page.getByRole('textbox', { name: '后台全局搜索' });
    await expect(search).toBeFocused();
    await search.fill('o');
    await expect(page.getByText('输入至少 2 个字符开始搜索')).toBeVisible();

    await search.press('Escape');
    await expect(search).toBeHidden();
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
    // 下拉应至少含禁用/删除这类动作
    const items = page.getByRole('menuitem');
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThanOrEqual(2);
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
});
