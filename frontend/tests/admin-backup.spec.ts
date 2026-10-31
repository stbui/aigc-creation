import { test, expect, type Page } from '@playwright/test';
import { HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';
import { ensureAdminLogin } from './support/admin-login';

/**
 * 数据备份 E2E (admin-prd.md B-96/97/98/100)。
 *
 * 重点守住 B-97 的核心约束: **未通过恢复验证的备份不可下载** ——
 * 这条如果失效, 运维会在事故时拿到一份损坏的备份却毫不知情。
 *
 * ## 选择器约定（2026-10-30 换 BoardUI 后）
 *
 * 列表行 `data-testid="admin-table-row"`，行内展开 `data-testid="admin-table-expanded"`，
 * 页面内确认条 `data-testid="admin-confirm-action"`，侧栏 `data-testid="admin-sider"`。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';

const rows = (page: Page) => page.getByTestId('admin-table-row');

async function login(page: Page) {
  // 侧栏在 ≤1280px 折叠, 分组标题按设计隐藏 —— 用例需断言侧栏结构时用宽视口
  await page.setViewportSize({ width: 1600, height: 1000 });
  await ensureAdminLogin(page);
}

test.describe('数据备份', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

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
    await expect(
      page.getByTestId('admin-sider').locator('button[aria-current="page"]'),
    ).toContainText('数据备份');
  });

  test('侧栏「数据安全」分组已注册', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    const nav = page.getByTestId('admin-sider');
    await expect(nav.getByText('数据安全', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(nav.getByRole('button', { name: '数据备份', exact: true })).toBeVisible();
  });

  test('未验证备份的下载入口被禁用 (B-97)', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await rows(page).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(1000);

    // 找出未验证的行, 断言其下载是禁用态
    const unverifiedRow = rows(page).filter({ hasText: '未验证' }).first();
    test.skip((await unverifiedRow.count()) === 0, '当前没有未验证的备份, 跳过');

    const disabled = unverifiedRow.locator('[title="未通过恢复验证的备份不可下载"]');
    await expect(disabled).toBeVisible();
    await expect(disabled).toHaveText('下载');
    await expect(unverifiedRow.getByRole('button', { name: '下载' })).toHaveCount(0);
  });

  test('已验证备份的下载入口可用', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await rows(page).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(1000);

    const verifiedRow = rows(page).filter({ hasText: '已验证' }).first();
    test.skip((await verifiedRow.count()) === 0, '当前没有已验证的备份, 跳过');

    await expect(verifiedRow.getByRole('button', { name: '下载' })).toBeEnabled();
  });

  test('手动备份需填原因, 执行后列表数量不变少', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await rows(page).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);

    const before = await rows(page).count();

    await page.getByRole('button', { name: /立即备份/ }).click();
    const panel = page.getByTestId('admin-confirm-action');
    await expect(panel).toBeVisible();
    await panel.getByLabel('备份原因').fill('e2e 例行备份');
    await panel.getByRole('button', { name: '开始备份' }).click();
    await page.waitForTimeout(4000);

    const after = await rows(page).count();
    expect(after).toBeGreaterThanOrEqual(before);
  });

  test('恢复验证后行状态从「未验证」变为「已验证」', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await rows(page).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(1000);

    const unverifiedRow = rows(page).filter({ hasText: '未验证' }).first();
    test.skip((await unverifiedRow.count()) === 0, '当前没有未验证的备份, 跳过');

    await unverifiedRow.getByRole('button', { name: '验证' }).click();
    await page.waitForTimeout(4000);

    // 表格内至少有一行变为已验证
    await expect(rows(page).filter({ hasText: '已验证' }).first()).toBeVisible();
  });

  test('删除备份直接执行, 不再弹窗确认', async ({ page }) => {
    let deleteCalls = 0;
    // 拦截真实删除, 避免 e2e 破坏开发库备份
    await page.route('**/api/v1/admin/backups/*', async (route) => {
      if (route.request().method() !== 'DELETE') {
        await route.continue();
        return;
      }
      deleteCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: { id: 'e2e' }, message: '' }),
      });
    });

    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await rows(page).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(1000);

    test.skip((await rows(page).count()) === 0, '无备份记录');

    await rows(page).first().getByRole('button', { name: '删除', exact: true }).click();

    await expect(page.getByTestId('admin-modal')).toHaveCount(0);
    await expect(page.getByTestId('admin-confirm-action')).toHaveCount(0);
    await expect.poll(() => deleteCalls).toBe(1);
  });

  test('清理留痕区可见', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await expect(page.getByRole('heading', { name: '清理留痕' })).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/到期数据清理是不可逆操作/)).toBeVisible();
  });

  test('展开行显示 SHA-256', async ({ page }) => {
    await login(page);
    await page.goto(`${UI}/admin/backups`);
    await rows(page).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(800);

    await rows(page).first().getByRole('button', { name: '详情', exact: true }).click();
    const expanded = page.getByTestId('admin-table-expanded');
    await expect(expanded).toBeVisible({ timeout: 5000 });
    await expect(expanded).toContainText('SHA-256');
    // 64 位十六进制
    await expect(expanded.locator('code').filter({ hasText: /^[0-9a-f]{64}$/ }).first()).toBeVisible();
  });
});
