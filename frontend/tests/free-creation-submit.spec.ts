import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * 自由创作页（/free-creation）提交按钮契约 —— 登录墙 + 必填置灰。
 *
 * 守住两个曾经出过的问题:
 *   1. 提示词为空时按钮 disabled 逻辑正确, 但 `.fc-actions .pk-primary-btn:disabled`
 *      有一条 `opacity: 1` 覆盖(据称对齐参考站不淡出), 把 `.pk-primary-btn:disabled`
 *      的 `opacity: .55` 顶掉了 —— **功能禁用、视觉零变化**, 用户看不出不能提交。
 *      这里断言 computed opacity + cursor, 防止覆盖规则再回来。
 *   2. 按钮文案不区分登录态: 未登录与已登录都是「免费生图」, 且无积分角标。
 *      现契约: 未登录「登录免费生成」(无角标, 点击弹登录框), 已登录「立即生成」+「本次消耗 10 积分」。
 *
 * 断言用 computed style 与网络请求计数, 不用截图比对 —— 截图会被无关视觉微调弄红,
 * 而 "禁用必须 opacity .55" / "未登录点生成不得发请求" 是硬契约, 不会因调色而失效。
 *
 * 前置: 前端 dev server 与后端已运行 (baseURL + /api 代理可用), 且后端允许注册。
 * 登录态用例需要可用的 C 端账号: 走 E2E_USER_EMAIL/E2E_USER_PASSWORD,
 * 未提供则用 API 现注册一个一次性账号 (test 结束不回滚库, 只在本地 dev.db 留一行 User)。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5173';
const API = process.env.E2E_API ?? 'http://localhost:3001';

const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? '';
const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? '';

/** 一键测试邮箱 (注册已存在时会退化为登录失败, 故加随机后缀保证每次都是新号) */
const autoEmail = `e2e-fc-${Date.now()}-${Math.floor(Math.random() * 1e6)}@local.dev`;

/** 直取 accessToken: 优先用环境变量账号, 否则现注册一次性账号 */
async function fetchToken(request: APIRequestContext): Promise<{ token: string; email: string }> {
  if (E2E_EMAIL && E2E_PASSWORD) {
    const res = await request.post(`${API}/api/v1/auth/login`, {
      data: { email: E2E_EMAIL, password: E2E_PASSWORD },
    });
    if (!res.ok()) throw new Error(`登录失败 ${res.status()}: ${await res.text()}`);
    return { token: (await res.json()).data.accessToken, email: E2E_EMAIL };
  }

  const res = await request.post(`${API}/api/v1/auth/register`, {
    data: { email: autoEmail, password: 'E2e@123456', name: 'e2e-free-creation' },
  });
  if (!res.ok()) throw new Error(`注册失败 ${res.status()}: ${await res.text()}`);
  return { token: (await res.json()).data.accessToken, email: autoEmail };
}

/** 以 guest 身份进入页面 (清掉可能残留的 token) */
async function gotoAsGuest(page: Page) {
  await page.goto(`${UI}/free-creation`);
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('button.pk-primary-btn').first().waitFor({ state: 'visible', timeout: 15000 });
}

/** 以登录身份进入页面 (token 直接落 localStorage, 不走 UI 登录表单) */
async function gotoAsAuthed(page: Page, token: string, email: string) {
  await page.goto(`${UI}/free-creation`);
  await page.evaluate(
    ([t, e]) => {
      localStorage.setItem('ecom_vision_token', t as string);
      localStorage.setItem('ecom_vision_email', e as string);
    },
    [token, email],
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('button.pk-primary-btn').first().waitFor({ state: 'visible', timeout: 15000 });
}

/** 读按钮的文案与真实禁用表现 (computed style, 而非只看 disabled 属性) */
async function submitState(page: Page) {
  const btn = page.locator('button.pk-primary-btn').first();
  return {
    text: ((await btn.innerText()) ?? '').replace(/\s+/g, ' ').trim(),
    disabled: await btn.isDisabled(),
    ...(await btn.evaluate((el) => {
      const s = getComputedStyle(el);
      return { opacity: Number(s.opacity), cursor: s.cursor };
    })),
  };
}

const PROMPT = page => page.locator('textarea.fc-prompt-textarea').first();

test.describe('自由创作 · 提交按钮登录墙', () => {
  test('未登录 + 提示词为空 → 「登录免费生成」且视觉置灰', async ({ page }) => {
    await gotoAsGuest(page);
    const s = await submitState(page);

    expect(s.text).toContain('登录免费生成');
    expect(s.text).not.toContain('积分');
    // 核心回归点: 禁用态必须在视觉上可辨 (曾被 opacity:1 覆盖成看不出禁用)
    expect(s.disabled).toBe(true);
    expect(s.opacity).toBeLessThan(1);
    expect(s.cursor).toBe('not-allowed');
  });

  test('未登录 + 提示词已填 → 按钮可点, 点击弹登录框且不发生成请求', async ({ page }) => {
    await gotoAsGuest(page);
    await PROMPT(page).fill('赛博朋克城市夜景，霓虹灯');
    const s = await submitState(page);

    expect(s.text).toContain('登录免费生成');
    expect(s.text).not.toContain('积分');
    expect(s.disabled).toBe(false);
    expect(s.opacity).toBe(1);

    // 点击后不得触发生成 —— 登录墙的意义就是把生成挡在门外
    const generateCalls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/generate')) generateCalls.push(r.url());
    });
    await page.locator('button.pk-primary-btn').first().click({ timeout: 10000 });
    await expect(page.locator('.login-modal')).toBeVisible({ timeout: 10000 });
    expect(generateCalls, '未登录点提交不应触发生成接口').toHaveLength(0);
  });
});

test.describe('自由创作 · 提交按钮登录态', () => {
  test('已登录 → 「立即生成」+「本次消耗 10 积分」, 空提示词置灰 / 有提示词可提交', async ({ page, request }) => {
    const { token, email } = await fetchToken(request);
    await gotoAsAuthed(page, token, email);

    // 登录态身份必须真的生效 (token 未被 401 清掉)
    await expect(page.locator('.app-guest-login')).toHaveCount(0);

    const empty = await submitState(page);
    expect(empty.text).toContain('立即生成');
    expect(empty.text).toContain('本次消耗 10 积分');
    expect(empty.disabled).toBe(true);
    expect(empty.opacity).toBeLessThan(1);
    expect(empty.cursor).toBe('not-allowed');

    await PROMPT(page).fill('赛博朋克城市夜景，霓虹灯');
    const filled = await submitState(page);
    expect(filled.text).toContain('立即生成');
    expect(filled.text).toContain('本次消耗 10 积分');
    expect(filled.disabled).toBe(false);
    expect(filled.opacity).toBe(1);
    expect(filled.cursor).toBe('pointer');
  });
});

/**
 * 防回归: guest 不得被动弹登录框。
 *
 * 曾经存在 P1 —— ToolHistoryPanel 挂载即拉 `GET /api/v1/tasks`, guest 收到 401 后
 * `lib/api.ts` 广播 `auth:required` → AuthProvider 立即弹登录框, 用户什么都没点就被拦下。
 * 影响面是全部 6 处工具页(ToolShell + 五个自建页共用该组件)。
 *
 * 2026-10-19 用户裁定"历史记录都不要", 组件整体删除 → 触发源消失, 缺陷随之修复。
 * 这条用例从"故意失败的活文档"转为**正向断言**: 登录框只能由用户点击按钮触发, 不得自动出现。
 * 若日后有人把任何"无 token 也发请求"的只读接口加回工具页, 这里会立刻转红。
 */
test.describe('防回归: guest 不被动弹登录', () => {
  test('未登录访问工具页不应自动弹登录框', async ({ page }) => {
    await gotoAsGuest(page);
    // 留足时间: 历史记录当初是首屏即发请求, 断言需覆盖同等窗口
    await page.waitForTimeout(2500);

    await expect(
      page.locator('.login-modal'),
      '未登录进页面即弹登录框 —— 检查是否有只读接口在无 token 时触发 auth:required',
    ).toBeHidden({ timeout: 5000 });
  });
});