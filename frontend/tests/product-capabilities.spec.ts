import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * 前台产品能力回归（2026-10-25）。
 *
 * 覆盖本次收口的四条真实契约:
 *   1. 运营下线的能力从顶导/侧栏/工作台/首页/站点地图一起消失；
 *   2. 仅「暂无通道」的能力保留入口，并在工作台标注「暂不可用」；
 *   3. 创意生图入口落到 /tools/creative_image，提交的是 creative_image 而非 free_create；
 *   4. 我的作品失败任务重试沿用原任务的能力、输入素材与参数；
 *   5. ToolShell 页面只拦截已登录用户的不可用提交，访客仍能触发登录流程。
 *
 * 全部通过 route 拦截构造运行态与生成响应，不调用真实模型。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';
const API = process.env.E2E_API ?? 'http://localhost:4100';

type Caps = {
  groups: Array<{ id: string; name: string; desc: string }>;
  items: Array<Record<string, any>>;
  workbenchIds: string[];
};

async function fetchCaps(request: APIRequestContext): Promise<Caps> {
  const res = await request.get(`${API}/api/v1/capabilities`);
  expect(res.ok(), `capabilities ${res.status()}`).toBeTruthy();
  return (await res.json()).data as Caps;
}

function patchRuntime(caps: Caps, id: string, patch: Record<string, unknown>) {
  const item = caps.items.find((c) => c.id === id);
  expect(item, `missing capability ${id}`).toBeTruthy();
  item!.runtime = { ...item!.runtime, ...patch };
}

async function mockCaps(page: Page, caps: Caps) {
  await page.route('**/api/v1/capabilities', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, data: caps, message: '' }),
    }),
  );
}

async function register(request: APIRequestContext): Promise<{ token: string; email: string }> {
  const email = `e2e-caps-${Date.now()}-${Math.floor(Math.random() * 1e6)}@local.dev`;
  const res = await request.post(`${API}/api/v1/auth/register`, {
    data: { email, password: 'E2e@123456', name: 'e2e-caps' },
  });
  expect(res.ok(), `register ${res.status()}: ${await res.text()}`).toBeTruthy();
  return { token: (await res.json()).data.accessToken, email };
}

async function authed(page: Page, path: string, token: string, email: string) {
  await page.goto(`${UI}${path}`);
  await page.evaluate(
    ([t, e]) => {
      localStorage.setItem('ecom_vision_token', t as string);
      localStorage.setItem('ecom_vision_email', e as string);
    },
    [token, email],
  );
  await page.reload();
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7wAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('能力可见性与运行态', () => {
  test('下线的能力全站隐藏；暂无通道的能力保留入口并标注', async ({ page, request }) => {
    const caps = await fetchCaps(request);
    patchRuntime(caps, 'matting', {
      enabled: false,
      effective: 'disabled',
      reason: '运营下线测试',
    });
    patchRuntime(caps, 'creative_image', {
      enabled: true,
      remoteAvailable: false,
      localQuality: 'none',
      effective: 'unavailable',
      reason: '模型通道维护中，请稍后再试',
    });
    await mockCaps(page, caps);

    // 首页：下线条目消失（工具入口 + 案例页签 + 顶导共用同一份能力清单）
    await page.goto(`${UI}/`);
    await expect(page.getByText('一键抠图', { exact: true })).toHaveCount(0);
    await expect(page.getByText('创意生图', { exact: true }).first()).toBeVisible();

    // 工作台：下线卡片消失，不可用卡片保留并给出标注
    await page.goto(`${UI}/workbench`);
    const cards = page.locator('.wb-card');
    await expect(cards.filter({ hasText: '一键抠图' })).toHaveCount(0);
    const creative = cards.filter({ hasText: '创意生图' });
    await expect(creative).toBeVisible();
    await expect(creative.getByText('暂不可用')).toBeVisible();

    // 侧栏：与顶导同一口径
    await expect(page.locator('.side-menu-label', { hasText: '一键抠图' })).toHaveCount(0);
    await expect(page.locator('.side-menu-label', { hasText: '创意生图' })).toBeVisible();

    // 站点地图：同样不再列出下线能力
    await page.goto(`${UI}/sitemap.html`);
    await expect(page.locator('a.sitemap-item[href="/background-remove"]')).toHaveCount(0);
    await expect(page.locator('a.sitemap-item[href="/tools/creative_image"]')).toBeVisible();
  });

  test('创意生图入口落到专用路由，提交 capability=creative_image', async ({ page, request }) => {
    const { token, email } = await register(request);
    const caps = await fetchCaps(request);
    await mockCaps(page, caps);

    let posted: any = null;
    await page.route('**/api/v1/generate', async (route) => {
      posted = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: { taskId: 'task-creative-e2e' }, message: '' }),
      });
    });
    await page.route('**/api/v1/tasks/task-creative-e2e', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            id: 'task-creative-e2e',
            projectId: 'p1',
            capability: 'creative_image',
            status: 'succeeded',
            inputAssetIds: ['asset-1'],
            params: {},
            outputAsset: null,
          },
          message: '',
        }),
      }),
    );
    await page.route('**/api/v1/assets/upload', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            id: 'asset-1',
            projectId: 'p1',
            ownerId: 'u1',
            kind: 'original',
            sourceUrl: '/uploads/original/e2e.png',
            signedUrl: null,
            format: 'image/png',
            sizeBytes: 68,
            createdAt: new Date().toISOString(),
          },
          message: '',
        }),
      }),
    );

    await authed(page, '/workbench', token, email);
    await page.locator('.wb-card').filter({ hasText: '创意生图' }).click();
    await expect(page).toHaveURL(/\/tools\/creative_image$/);

    await page.locator('input[type=file]').setInputFiles({ name: 'e2e.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.ant-upload-list-item-name', { hasText: 'e2e.png' })).toBeVisible();
    await page.locator('textarea').first().fill('清晨窗边的木质桌面');
    await page.getByRole('button', { name: /立即生成/ }).click();

    await expect.poll(() => posted?.capability).toBe('creative_image');
    expect(posted.inputAssetIds).toEqual(['asset-1']);
    expect(posted.params.prompt).toBe('清晨窗边的木质桌面');
  });

  test('ToolShell：不可用时已登录用户被拦截，访客仍能触发登录', async ({ page, request }) => {
    const { token, email } = await register(request);
    const caps = await fetchCaps(request);
    patchRuntime(caps, 'local_redraw', {
      enabled: true,
      remoteAvailable: false,
      localQuality: 'none',
      effective: 'unavailable',
      reason: '图像编辑通道维护中',
    });
    await mockCaps(page, caps);

    await authed(page, '/local-redraw', token, email);
    const btn = page.locator('button.pk-primary-btn').first();
    await expect(page.locator('.tool-submit-notice-error')).toContainText('图像编辑通道维护中');
    await expect(btn).toBeDisabled();

    // 访客：说明仍展示，但按钮不被能力状态置灰；上传动作会唤起登录
    await page.goto(`${UI}/local-redraw`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('button.pk-primary-btn').first()).toBeEnabled();
    await page.locator('input[type=file]').setInputFiles({ name: 'guest.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.login-modal')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('失败任务重试', () => {
  test('沿用原任务的 capability / inputAssetIds / params，并显示进度', async ({ page, request }) => {
    const { token, email } = await register(request);
    const failed = {
      id: 'task-failed-e2e',
      projectId: 'project-e2e',
      capability: 'creative_image',
      status: 'failed',
      inputAssetIds: ['asset-original'],
      params: { prompt: '原任务提示词', ratio: '4:3' },
      errorCode: '42204',
      creditCost: 10,
      createdAt: new Date().toISOString(),
    };

    await page.route(/\/api\/v1\/tasks$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: [failed], message: '' }),
      }),
    );
    let posted: any = null;
    await page.route('**/api/v1/generate', async (route) => {
      posted = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: { taskId: 'task-retry-e2e' }, message: '' }),
      });
    });
    await page.route('**/api/v1/tasks/task-retry-e2e', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            id: 'task-retry-e2e',
            projectId: 'project-e2e',
            capability: 'creative_image',
            status: 'succeeded',
            inputAssetIds: ['asset-original'],
            params: failed.params,
            outputAsset: null,
          },
          message: '',
        }),
      }),
    );

    await authed(page, '/works', token, email);
    await expect(page.getByText('生成失败')).toBeVisible();
    await page.getByRole('button', { name: '重试' }).click();
    const dialog = page.locator('.ant-modal-confirm');
    await expect(dialog).toContainText('本次将消耗 10 积分');
    await dialog.getByRole('button', { name: '重新生成' }).click();

    await expect.poll(() => posted).not.toBeNull();
    expect(posted).toEqual({
      projectId: 'project-e2e',
      capability: 'creative_image',
      inputAssetIds: ['asset-original'],
      params: { prompt: '原任务提示词', ratio: '4:3' },
    });
  });
});
