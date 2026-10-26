import { test, expect } from '@playwright/test';

/**
 * 后台布局回归。
 *
 * 守住两个曾经出过的问题:
 *   1. antd Layout 默认 column → 侧栏与内容竖排重叠(内容未扣侧栏宽度)
 *   2. 操作列平铺过多动作 → 换行把行高从 44 撑到 51+
 *
 * 断言用几何量测而非截图比对 —— 截图会被无关的样式改动弄红,
 * 而"内容区宽度 =视口 -侧栏" 与 "行高 ≤ 46" 是硬约束, 不会因视觉微调而失效。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@huojue.local';

async function login(page: import('@playwright/test').Page) {
  await page.goto(`${UI}/login`);
  await page.locator('input[type="email"], input#email').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(
    process.env.ADMIN_PASSWORD ?? '',
  );
  await page.locator('input[type="password"]').first().press('Enter');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
}

const PAGES = [
  ['/admin', '概览'],
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
  test.skip(!process.env.ADMIN_PASSWORD, '未提供 ADMIN_PASSWORD');

  for (const [w, h] of SIZES) {
    test(`${w}px 宽下内容区正确扣除侧栏宽度且无横向溢出`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await login(page);

      for (const [path, name] of PAGES) {
        await page.goto(`${UI}${path}`);
        await page.waitForSelector('.adm-content', { timeout: 15000 });
        await page.waitForTimeout(600);

        const m = await page.evaluate(() => {
          const sider = document.querySelector('.adm-sider')?.getBoundingClientRect();
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

  test('侧栏占满视口高度并独立滚动', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page);
    await page.goto(`${UI}/admin/roles`); // 权限页最长, 最能暴露滚动问题
    await page.waitForSelector('.adm-sider', { timeout: 15000 });

    const m = await page.evaluate(() => {
      const sider = document.querySelector('.adm-sider') as HTMLElement;
      const r = sider.getBoundingClientRect();
      return {
        height: Math.round(r.height),
        viewport: window.innerHeight,
        headerH: Math.round(document.querySelector('.adm-header')?.getBoundingClientRect().height ?? 0),
        overflowY: getComputedStyle(sider).overflowY,
      };
    });

    // 高度应等于视口 - Header, 而不是撑满整个视口(会盖住 Header)
    expect(m.height).toBeLessThanOrEqual(m.viewport - m.headerH + 2);
    expect(m.height).toBeGreaterThan(400);
    // 长内容时侧栏自身滚动, 页面整体不滚
    expect(['auto', 'scroll']).toContain(m.overflowY);
  });

  test('用户表格行高一致、操作列不换行', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page);
    await page.goto(`${UI}/admin/users`);
    await page.waitForSelector('.adm-row-actions', { timeout: 15000 });
    await page.waitForTimeout(800);

    const m = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('.adm-row-actions')) as HTMLElement[];
      return {
        heights: rows.map((r) => Math.round(r.getBoundingClientRect().height)),
        // 动作项数应 ≤2 (详情 + 更多), 多的应在下拉里
        counts: rows.map((r) => r.querySelectorAll('.adm-link').length),
      };
    });

    // 操作区高度 = 单行文本高度, 换行会翻倍到 ~34px 以上
    for (const [i, h] of m.heights.entries()) {
      expect(h, `第 ${i} 行操作区高度 ${h}px, 疑似换行`).toBeLessThanOrEqual(28);
    }
    for (const [i, c] of m.counts.entries()) {
      expect(c, `第 ${i} 行直显动作 ${c} 个, 应 ≤2`).toBeLessThanOrEqual(2);
    }
  });

  test('全局搜索可用 Ctrl+K 唤起并支持 Esc 关闭', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await login(page);
    await page.goto(`${UI}/admin/users`);
    await page.waitForSelector('.adm-layout', { timeout: 15000 });

    await page.keyboard.press('Control+K');
    const search = page.locator('.adm-search input');
    await expect(search).toBeFocused();
    await search.fill('o');
    await expect(page.getByText('至少输入 2 个字符开始搜索')).toBeVisible();

    await search.press('Escape');
    await expect(page.getByText('至少输入 2 个字符开始搜索')).toBeHidden();
  });

  test('操作列的下拉菜单可用', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await login(page);
    await page.goto(`${UI}/admin/users`);
    await page.waitForSelector('.adm-row-actions', { timeout: 15000 });

    await page.locator('.adm-row-actions').first().getByText('更多').click();
    // 下拉应至少含禁用/删除这类动作
    const items = page.locator('.ant-dropdown-menu-item');
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThanOrEqual(2);
  });
});
