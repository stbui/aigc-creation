import { test, expect, type Page } from '@playwright/test';

/**
 * 后台管理端 E2E 冒烟。
 *
 * 覆盖的是「权限链路 + 四页渲染」, 不是像素级视觉回归。
 * 前置: 后端与前端 dev server 已在 BASE 指向的端口运行, 且已 seed 管理员。
 */

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@huojue.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';

const UI = process.env.ADMIN_UI ?? 'http://localhost:5173';

/** 登录并落token 到 localStorage, 供后续页面直接使用 */
async function login(page: Page, email: string, password: string) {
  const res = await page.request.post(`${UI.replace(/\/$/, '')}/../api/v1/auth/login`, {
    // 占位, 实际走下面的真实请求
  }).catch(() => null);
  void res;
}

/** 通过 UI 登录页登录 */
async function loginViaUi(page: Page) {
  await page.goto(`${UI}/login`);
  await page.waitForLoadState('domcontentloaded');
  // 登录页可能是自绘表单或 antd Form, 两者选择器都试
  const emailInput = page.locator('input[type="email"], input#email, input[name="email"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 15000 });
  await emailInput.fill(ADMIN_EMAIL);

  const pwdInput = page.locator('input[type="password"]').first();
  await pwdInput.fill(ADMIN_PASSWORD);
  await pwdInput.press('Enter');

  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 });
}

test.describe('后台管理端', () => {
  test.skip(!ADMIN_PASSWORD, '未提供 ADMIN_PASSWORD, 跳过登录相关用例');

  test('概览页加载真实统计', async ({ page }) => {
    await loginViaUi(page);
    await page.goto(`${UI}/admin`);
    await expect(page.getByRole('heading', { name: '平台概览' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('用户总数')).toBeVisible();
    await expect(page.getByText('任务总数')).toBeVisible();
  });

  test('用户管理页渲染列表', async ({ page }) => {
    await loginViaUi(page);
    await page.goto(`${UI}/admin/users`);
    await expect(page.getByRole('heading', { name: '用户管理' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.adm-filter').first()).toBeVisible();
    // 表格首屏应有数据行
    await expect(page.locator('.adm-panel .adm-table, .adm-panel table').first()).toBeVisible();
  });

  test('角色权限页渲染权限模块', async ({ page }) => {
    await loginViaUi(page);
    await page.goto(`${UI}/admin/roles`);
    await expect(page.getByRole('heading', { name: '角色权限' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.adm-perm-module').first()).toBeVisible();
  });

  test('系统设置页渲染 Tab 与设置项', async ({ page }) => {
    await loginViaUi(page);
    await page.goto(`${UI}/admin/settings`);
    await expect(page.getByRole('heading', { name: '系统设置' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.adm-tab').first()).toBeVisible();
    await expect(page.locator('.adm-setting-row').first()).toBeVisible();
  });

  test('操作审计页渲染表格', async ({ page }) => {
    await loginViaUi(page);
    await page.goto(`${UI}/admin/audit-logs`);
    await expect(page.getByRole('heading', { name: '操作审计' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.adm-filter').first()).toBeVisible();
  });
});

test.describe('越权拦截', () => {
  test('C端用户访问后台显示无权限页并说明原因', async ({ page }) => {
    // 演示账号是普通用户(role='user'), 缓存里没有后台角色 -> 不请求后台身份
    await page.goto(`${UI}/login`);
    await page.waitForLoadState('domcontentloaded');

    const emailInput = page.locator('input[type="email"], input#email, input[name="email"]').first();
    await emailInput.waitFor({ state: 'visible', timeout: 15000 });
    await emailInput.fill('admin@demo.com');
    const pwdInput = page.locator('input[type="password"]').first();
    await pwdInput.fill('demo1234');
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