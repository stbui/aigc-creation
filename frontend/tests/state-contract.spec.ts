import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * 全站状态契约 (loading / empty / error) —— 2026-10-20。
 *
 * 守住的不是"好不好看", 而是**状态语义是否说真话**。三条硬契约:
 *
 *   1. **加载失败不得渲染成空态**。
 *      此前作品页 / 素材库页: 失败只 `message.error` 弹一下, 随后照常渲染
 *      「还没有作品」/「素材库还是空的」—— 用户以为是自己没数据, 真相是接口没连上。
 *      谎报状态会让人以为数据丢了而反复重试。
 *
 *   2. **生成中不得渲染成空态**。
 *      此前 6 个工具页: 提交后 `setResult(null)`, 结果栏整块退回空态插画,
 *      文案还写着「提交任务后，生成结果将在此处展示」—— 用户明明点了生成,
 *      却看到"你还没提交"。慢模型下尤其刺眼, 用户会以为按钮没生效而重复点击。
 *
 *   3. **加载中必须有指示**。
 *      此前积分页/订单页用纯文本「正在加载…」, 慢网下与"空页面"难以区分。
 *
 * 断言用**网络拦截 + DOM 语义**, 不用截图比对 —— 截图会被无关视觉微调弄红,
 * 而「失败必须是失败态」「生成中必须是骨架」是硬契约, 不因调色而失效。
 *
 * 前置: 前端 dev server 与后端已运行 (baseURL + /api 代理可用)。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';
const API = process.env.E2E_API ?? 'http://localhost:4100';

const E2E_EMAIL = process.env.E2E_USER_EMAIL ?? '';
const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? '';

async function fetchToken(request: APIRequestContext): Promise<{ token: string; email: string }> {
  if (E2E_EMAIL && E2E_PASSWORD) {
    const res = await request.post(`${API}/api/v1/auth/login`, {
      data: { email: E2E_EMAIL, password: E2E_PASSWORD },
    });
    if (!res.ok()) throw new Error(`登录失败 ${res.status()}: ${await res.text()}`);
    return { token: (await res.json()).data.accessToken, email: E2E_EMAIL };
  }
  // 邮箱必须每次调用现生成 —— 模块级常量会被多个用例共享, 第二个用例注册会撞
  // "该邮箱已注册" (400)。
  const email = `e2e-state-${Date.now()}-${Math.floor(Math.random() * 1e6)}@local.dev`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await request.post(`${API}/api/v1/auth/register`, {
      data: { email, password: 'E2e@123456', name: 'e2e-state' },
    });
    const text = await res.text();
    if (res.ok()) return { token: JSON.parse(text).data.accessToken, email };
    const waitSeconds = Number(text.match(/请\s*(\d+)\s*秒后再试/)?.[1] ?? 0);
    if (res.status() !== 429 || attempt === 3) {
      throw new Error(`注册失败 ${res.status()}: ${text}`);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(waitSeconds, 1) * 1000 + 250));
  }
  throw new Error('注册失败: 限流重试次数耗尽');
}

/**
 * 以登录身份进入页面 (token 直接落 localStorage, 不走 UI 登录表单)
 *
 * ⚠ `waitUntil` 刻意用 'commit' 而非 'networkidle':
 *   'networkidle' 会等所有请求结束 —— 若测试给某接口注入了 3 秒延迟,
 *   这里会把延迟等完, 等到页面已渲染完再返回, 骨架屏窗口就没了。
 *   'commit' 只等导航提交, 后续断言自己控制观察时机。
 */
async function gotoAsAuthed(page: Page, path: string, token: string, email: string) {
  await page.goto(`${UI}${path}`);
  await page.evaluate(
    ([t, e]) => {
      localStorage.setItem('ecom_vision_token', t as string);
      localStorage.setItem('ecom_vision_email', e as string);
    },
    [token, email],
  );
  await page.reload({ waitUntil: 'commit' });
}

/**
 * 让指定接口返回 500。
 *
 * 用 route.fulfill 而非后端停服 —— 后端停服会连带影响能力清单, 页面根本进不去,
 * 测的就不是"列表加载失败"这条路径了。
 */
async function failEndpoint(page: Page, pattern: RegExp) {
  await page.route(pattern, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ code: 50000, message: '注入的失败', data: null }),
    }),
  );
}

/**
 * 让指定能力在页面内呈现为「云端模型可用」。
 *
 * 状态交接用例只关心提交后的 UI 状态，不应依赖本机是否真的配置了模型通道。
 * 注意这里只改测试响应，不会调用或绕过真实生成接口。
 */
async function mockRemoteCapability(page: Page, request: APIRequestContext, capability: string) {
  const res = await request.get(`${API}/api/v1/capabilities`);
  expect(res.ok(), `capabilities ${res.status()}`).toBeTruthy();
  const data = (await res.json()).data;
  const item = data.items.find((c: { id: string }) => c.id === capability);
  expect(item, `missing capability ${capability}`).toBeTruthy();
  item.runtime = {
    ...item.runtime,
    enabled: true,
    remoteAvailable: true,
    localQuality: 'none',
    effective: 'remote',
    reason: null,
  };
  await page.route('**/api/v1/capabilities', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, data, message: '' }),
    }),
  );
}

test.describe('状态契约 · 加载失败必须呈现失败态', () => {
  test('作品页: /tasks 500 → 失败态 + 重试按钮, 不得显示「还没有作品」', async ({ page, request }) => {
    const { token, email } = await fetchToken(request);
    await failEndpoint(page, /\/api\/v1\/tasks/);
    await gotoAsAuthed(page, '/works', token, email);

    const err = page.locator('.state-error');
    await expect(err, '加载失败必须渲染 .state-error 失败态').toBeVisible({ timeout: 10000 });
    await expect(err.locator('.state-error-title')).toContainText('加载失败');
    // 失败态必须给出重试出口
    await expect(err.locator('button.state-btn.is-primary')).toContainText('重试');

    // 核心回归点: 不得出现「还没有作品」这类谎报空态
    await expect(page.locator('.my-works-empty'), '失败态不得渲染空态文案').toHaveCount(0);
    await expect(page.getByText('还没有作品')).toHaveCount(0);
  });

  test('素材库页: /assets 500 → 失败态, 不得显示「素材库还是空的」', async ({ page, request }) => {
    const { token, email } = await fetchToken(request);
    await failEndpoint(page, /\/api\/v1\/assets/);
    await gotoAsAuthed(page, '/library', token, email);

    await expect(page.locator('.state-error')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.asset-library-empty'), '失败态不得渲染空态').toHaveCount(0);
    await expect(page.getByText('素材库还是空的')).toHaveCount(0);
  });

  test('订单页: /orders 500 → 失败态 + 重试, 不得显示「还没有订单」', async ({ page, request }) => {
    const { token, email } = await fetchToken(request);
    await failEndpoint(page, /\/api\/v1\/orders/);
    await gotoAsAuthed(page, '/orders', token, email);

    const err = page.locator('.state-error');
    await expect(err).toBeVisible({ timeout: 10000 });
    await expect(err.locator('button.state-btn.is-primary')).toContainText('重试');
    await expect(page.getByText('还没有订单')).toHaveCount(0);
  });

  test('工具历史: /tasks 500 → 失败态 + 重试, 不得显示「暂无局部重绘记录」', async ({ page, request }) => {
    const { token, email } = await fetchToken(request);
    let calls = 0;
    await page.route(/\/api\/v1\/tasks(?:\?.*)?$/, (route) => {
      calls += 1;
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 50000, message: '注入的历史加载失败', data: null }),
      });
    });
    await gotoAsAuthed(page, '/local-redraw', token, email);

    const pane = page.locator('.redraw-history-pane');
    await expect(pane.locator('.state-error')).toBeVisible({ timeout: 10000 });
    await expect(pane.getByText('暂无局部重绘记录')).toHaveCount(0);
    await pane.locator('button.state-btn.is-primary').click();
    await expect.poll(() => calls).toBeGreaterThanOrEqual(2);
    await expect(pane.locator('.state-error')).toBeVisible();
  });
});

test.describe('状态契约 · 加载中必须有指示', () => {
  test('作品页: /tasks 延迟 3s → 期间显示骨架屏', async ({ page, request }) => {
    const { token, email } = await fetchToken(request);
    // 延迟响应, 让骨架屏有可观察窗口
    await page.route(/\/api\/v1\/tasks/, async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    await gotoAsAuthed(page, '/works', token, email);

    // 骨架屏占住卡片网格形状, 不是转圈
    await expect(page.locator('.state-skeleton.is-card'), '加载中必须显示骨架屏').toBeVisible({
      timeout: 8000,
    });
    // 不得出现旧的转圈容器
    await expect(page.locator('.my-works-loading')).toHaveCount(0);
  });
});

test.describe('状态契约 · 生成中不得显示空态', () => {
  test('工具页: 提交后结果栏显示生成中骨架, 不显示「提交任务后…」空态', async ({ page, request }) => {
    const { token, email } = await fetchToken(request);
    // 2026-10-25 起所有图像能力都只由模型产出。本用例测的是提交后的状态交接，
    // 与环境里是否配了模型通道无关，故显式 mock 为 remote 后再进入页面。
    await mockRemoteCapability(page, request, 'matting');
    await gotoAsAuthed(page, '/background-remove', token, email);

    // 拦截 /generate 让它挂住, 使 "生成中" 状态可持续观察
    // ⚠ 正则不能写成 `(\?|$)` —— 实际 URL 是 /api/v1/generate (无 query),
    //   用 `$` 收尾在 Playwright 里匹配不到 (实测拦截失效, 空态被渲染出来)。
    let release: (() => void) | null = null;
    const held = new Promise<void>((r) => {
      release = r;
    });
    await page.route(/\/api\/v1\/generate/, async (route) => {
      await held;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, message: '', data: { taskId: 'state-test-task', status: 'pending' } }),
      });
    });

    // 造一张可提交的上传图 (1x1 PNG)
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    await page.setInputFiles('input[type="file"]', {
      name: 'state-test.png',
      mimeType: 'image/png',
      buffer: png,
    });
    // 必须等上传完成再点提交: `useToolTask.run` 开头有
    // `if (inputs.length < minInputs) return` —— 上传未完成时点击会被静默忽略,
    // 结果是永远进不了"生成中"状态 (实测症状: .pk-result-generating 数量为 0)。
    await expect(page.locator('.pk-thumb img'), '上传完成应出现缩略图').toBeVisible({ timeout: 15000 });
    await page.locator('button.pk-primary-btn').first().click({ force: true });

    // 生成中: 结果栏必须是骨架 + 进行中提示
    const generating = page.locator('.pk-result-generating');
    await expect(generating, '生成中必须显示 .pk-result-generating').toBeVisible({ timeout: 10000 });
    await expect(generating.locator('.state-skeleton')).toBeVisible();

    // 核心回归点: 空态插画与「提交任务后…」文案都不得出现
    await expect(page.locator('.pk-preview-placeholder'), '生成中不得显示空态插画').toHaveCount(0);
    await expect(page.getByText('提交任务后，生成结果将在此处展示')).toHaveCount(0);

    release?.();
  });
});
