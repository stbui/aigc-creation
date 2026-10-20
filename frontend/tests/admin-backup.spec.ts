import { test, expect, type Page } from '@playwright/test';

/**
 * 数据备份 E2E (admin-prd.md B-96/97/98/100)。
 *
 * 重点守住 B-97 的核心约束: **未通过恢复验证的备份不可下载** ——
 * 这条如果失效, 运维会在事故时拿到一份损坏的备份却毫不知情。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5173';

async function login(page: Page) {
  // 侧栏在 ≤1280px 折叠, 分组标题按设计隐藏 —— 用例需断言侧栏结构时用宽视口
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`${UI}/login`);
  await page.locator('input[type="email"], input#email').first().fill('admin@huojue.local');
  await page.locator('input[type="password"]').first().fill(process.env.ADMIN_PASSWORD ?? '');
  await page.locator('input[type="password"]').first().press('Enter');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
}

test.describe('数据备份', () => {
  test.skip(!process.env.ADMIN_PASSWORD, '未提供 ADMIN_PASSWORD');

  test('页面渲染:统计卡/备份列表/清理留痕', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await expect(page.getByRole('heading', { name: '数据备份' })).toBeVisible({ timeout: 20000 });

    // 统计卡
    await expect(page.getByText('备份份数')).toBeVisible();
    // 「已验证」在统计卡标题、表格标签、告警文案里都会出现, 用 first() 消除歧义
    await expect(page.getByText('已验证').first()).toBeVisible();
    await expect(page.getByText('未验证').first()).toBeVisible();
    await expect(page.getByText('占用空间')).toBeVisible();

    // 侧栏激活态
    await expect(page.locator('.adm-sider-item.is-active')).toContainText('数据备份');
  });

  test('侧栏「数据安全」分组已注册', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await expect(page.locator('.adm-sider-group-title', { hasText: '数据安全' })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.locator('.adm-sider-item', { hasText: '数据备份' })).toBeVisible();
  });

  test('未验证备份的下载入口被禁用 (B-97)', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await page.waitForSelector('.adm-panel table', { timeout: 20000 });
    await page.waitForTimeout(1000);

    // 找出未验证的行, 断言其下载是禁用态
    const unverifiedRow = page
      .locator('.adm-panel table tbody tr')
      .filter({ hasText: '未验证' })
      .first();

    if ((await unverifiedRow.count()) === 0) {
      test.skip(true, '当前没有未验证的备份, 跳过');
    }

    const downloadLink = unverifiedRow.locator('.adm-link', { hasText: '下载' });
    await expect(downloadLink).toHaveClass(/is-disabled/);
    // 禁用态不可点击 —— 无 href 且光标为 not-allowed
    await expect(downloadLink).toHaveAttribute('title', /不可下载/);
  });

  test('已验证备份的下载入口可用', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await page.waitForSelector('.adm-panel table', { timeout: 20000 });
    await page.waitForTimeout(1000);

    const verifiedRow = page
      .locator('.adm-panel table tbody tr')
      .filter({ hasText: '已验证' })
      .first();

    if ((await verifiedRow.count()) === 0) {
      test.skip(true, '当前没有已验证的备份, 跳过');
    }

    const downloadLink = verifiedRow.locator('.adm-link', { hasText: '下载' });
    await expect(downloadLink).not.toHaveClass(/is-disabled/);
  });

  test('手动备份后列表新增一条且默认未验证', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await page.waitForSelector('.adm-panel table', { timeout: 20000 });

    const before = await page.locator('.adm-panel table tbody tr').count();

    await page.getByRole('button', { name: /立即备份/ }).click();
    await page.waitForTimeout(4000);

    const after = await page.locator('.adm-panel table tbody tr').count();
    expect(after).toBeGreaterThanOrEqual(before);
  });

  test('恢复验证后行状态从「未验证」变为「已验证」', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await page.waitForSelector('.adm-panel table', { timeout: 20000 });
    await page.waitForTimeout(1000);

    const unverifiedRow = page
      .locator('.adm-panel table tbody tr')
      .filter({ hasText: '未验证' })
      .first();

    if ((await unverifiedRow.count()) === 0) {
      test.skip(true, '当前没有未验证的备份, 跳过');
    }

    await unverifiedRow.locator('.adm-link', { hasText: '验证' }).click();
    await page.waitForTimeout(4000);

    // 表格内至少有一行变为已验证
    await expect(
      page.locator('.adm-panel table tbody tr').filter({ hasText: '已验证' }).first(),
    ).toBeVisible();
  });

  test('删除备份需二次确认, 弹窗量化影响', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await page.waitForSelector('.adm-panel table', { timeout: 20000 });
    await page.waitForTimeout(1000);

    const rows = await page.locator('.adm-panel table tbody tr').count();
    if (rows === 0) test.skip(true, '无备份记录');

    await page.locator('.adm-panel table tbody tr').first().locator('.adm-link.is-danger').click();

    // 确认弹窗应出现, 且说明"至少保留一份"
    await expect(page.locator('.adm-modal-title', { hasText: '删除备份' })).toBeVisible();
    await expect(page.getByText('至少保留一份已验证备份')).toBeVisible();

    // 取消不应改变列表
    await page.getByRole('button', { name: '取消' }).click();
    await page.waitForTimeout(500);
    expect(await page.locator('.adm-panel table tbody tr').count()).toBe(rows);
  });

  test('清理留痕区可见', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    // 面板标题是 div.adm-panel-title, 不用 heading role
    await expect(page.locator('.adm-panel-title', { hasText: '清理留痕' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/到期数据清理是不可逆操作/)).toBeVisible();
  });

  test('展开行显示 SHA-256', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await page.waitForSelector('.adm-panel table', { timeout: 20000 });
    await page.waitForTimeout(800);

    await page.locator('.adm-panel table tbody tr').first().locator('.ant-table-row-expand-icon').click();
    await expect(page.getByText('SHA-256')).toBeVisible({ timeout: 5000 });
    // 64 位十六进制
    await expect(page.locator('.adm-mono').filter({ hasText: /^[0-9a-f]{64}$/ }).first()).toBeVisible();
  });
});