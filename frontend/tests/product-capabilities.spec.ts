import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * 前台产品能力回归（2026-10-25）。
 *
 * 覆盖本次收口的四条真实契约:
 *   1. 运营下线的能力从顶导/侧栏/工作台/首页/站点地图一起消失；
 *   2. 仅「暂无通道」的能力保留入口，并在工作台标注「暂不可用」；
 *   3. 创意生图与自由创作共用 /free-creation，但入口携带能力上下文并提交 creative_image；
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
  // 多个用例共用同一测试实例时，注册接口的滑动窗口限流会正常触发。
  // 测试等待服务端给出的窗口，不绕过限流，也不把 429 误判成产品故障。
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await request.post(`${API}/api/v1/auth/register`, {
      data: { email, password: 'E2e@123456', name: 'e2e-caps' },
    });
    const text = await res.text();
    if (res.ok()) return { token: JSON.parse(text).data.accessToken, email };
    const waitSeconds = Number(text.match(/请\s*(\d+)\s*秒后再试/)?.[1] ?? 0);
    if (res.status() !== 429 || attempt === 3) {
      expect(res.ok(), `register ${res.status()}: ${text}`).toBeTruthy();
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(waitSeconds, 1) * 1000 + 250));
  }
  throw new Error('unreachable');
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
    await expect(
      page.locator('a.sitemap-item[href="/free-creation?capability=creative_image"]'),
    ).toBeVisible();
  });

  test('创意生图入口携带能力上下文，提交 capability=creative_image', async ({ page, request }) => {
    const { token, email } = await register(request);
    const caps = await fetchCaps(request);
    // 本机测试环境没有真实模型通道；该用例验证的是入口上下文与请求映射，
    // 显式注入可用运行态，避免把「无通道时禁用提交」的正确保护当成回归。
    patchRuntime(caps, 'creative_image', {
      enabled: true,
      remoteAvailable: true,
      localQuality: 'none',
      effective: 'remote',
      reason: null,
    });
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
    await expect(page).toHaveURL(/\/free-creation\?capability=creative_image$/);

    await page.locator('input[type=file]').setInputFiles({ name: 'e2e.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.fc-thumb img[alt="e2e.png"]')).toBeVisible();
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

    // 访客：能力不可用不应成为第一道墙；先让访客完成本页必填校验，
    // 再通过上传动作触发登录。局部重绘要求涂抹区域与描述，空表单本就不能提交。
    await page.goto(`${UI}/local-redraw`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('button.pk-primary-btn').first()).toBeDisabled();
    await page.locator('input[type=file]').setInputFiles({ name: 'guest.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.locator('.login-modal')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('工具上传约束', () => {
  test('GIF 与超过 10MB 的文件在选择阶段被拒，不发起上传', async ({ page }) => {
    let uploadRequests = 0;
    await page.route('**/api/v1/assets/upload', (route) => {
      uploadRequests += 1;
      return route.fulfill({ status: 500, body: 'must not be called' });
    });

    await page.goto(`${UI}/background-remove`);
    const input = page.locator('input[type=file]');
    await input.setInputFiles({ name: 'animated.gif', mimeType: 'image/gif', buffer: Buffer.from('GIF89a') });
    await expect(page.locator('.ant-message')).toContainText(
      '请选择图片文件（PNG / JPG / WebP）',
    );

    await input.setInputFiles({
      name: 'oversize.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
    });
    await expect(page.locator('.ant-message')).toContainText('单张不超过 10MB');
    expect(uploadRequests).toBe(0);
  });
});

test.describe('失败任务重试', () => {
  test('沿用原任务的 capability / inputAssetIds / params，并显示进度', async ({ page, request }) => {
    const { token, email } = await register(request);
    const caps = await fetchCaps(request);
    // 重试确认框只在能力可提交时出现；测试环境无真实模型通道，显式注入可用态。
    patchRuntime(caps, 'creative_image', {
      enabled: true,
      remoteAvailable: true,
      localQuality: 'none',
      effective: 'remote',
      reason: null,
    });
    await mockCaps(page, caps);
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
    expect(posted).toEqual(
      expect.objectContaining({
        projectId: 'project-e2e',
        capability: 'creative_image',
        inputAssetIds: ['asset-original'],
        params: { prompt: '原任务提示词', ratio: '4:3' },
      }),
    );
    // 重试同样必须带幂等键：短时间重复点击不能创建多个任务或重复扣费。
    expect(posted.idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
  });
});

/**
 * 局部重绘的交互回归 (2026-10-25)。
 *
 * 画布是手写 PointerEvent + Canvas，单测覆盖不到「坐标换算、区域上限、
 * 参考图上传期间误提交」这类真实交互，故用浏览器跑一遍最短闭环：
 *   上传底图 → 涂抹 4 次（第 4 次应被拒）→ 填写描述 → 上传参考图
 *   → 上传中提交必须禁用 → 放行后提交 payload 带遮罩与逐标注参考图。
 */
const REDRAW_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAPAAAACgCAIAAAC9uXYyAAABxklEQVR4nO3SQQ3AIADAwDHVyEETijBBQtLcKeijY679QcX/OgBuMjQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUg4r2AMqWugFPwAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('局部重绘画布', () => {
  test('限制 3 个标注，参考图上传中禁用提交，提交带遮罩与逐标注参考图', async ({ page, request }) => {
    const { token, email } = await register(request);
    const caps = await fetchCaps(request);
    patchRuntime(caps, 'local_redraw', {
      enabled: true,
      remoteAvailable: true,
      localQuality: 'none',
      effective: 'remote',
      reason: null,
    });
    await mockCaps(page, caps);

    await page.route('**/api/v1/projects', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: [{ id: 'project-redraw-e2e', name: '测试项目' }], message: '' }),
      }),
    );
    await page.route(/\/api\/v1\/tasks$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: [], message: '' }),
      }),
    );
    await page.route('**/uploads/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: REDRAW_PNG }),
    );

    let finishReferenceUpload: (() => Promise<void>) | null = null;
    await page.route('**/api/v1/assets/upload', async (route) => {
      const multipart = route.request().postDataBuffer()?.toString('latin1') ?? '';
      const asset = (id: string, filename: string) => ({
        code: 0,
        data: {
          id,
          projectId: 'project-redraw-e2e',
          ownerId: 'u1',
          kind: 'original',
          sourceUrl: `/uploads/original/${filename}`,
          signedUrl: null,
          format: 'image/png',
          sizeBytes: REDRAW_PNG.length,
          createdAt: new Date().toISOString(),
        },
        message: '',
      });

      if (multipart.includes('reference.png')) {
        await new Promise<void>((resolve) => {
          finishReferenceUpload = async () => {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify(asset('asset-reference', 'reference.png')),
            });
            resolve();
          };
        });
        return;
      }
      const isMask = multipart.includes('mask-');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(
          isMask ? asset('asset-mask', 'mask.png') : asset('asset-original', 'photo.png'),
        ),
      });
    });

    let posted: any = null;
    await page.route('**/api/v1/generate', (route) => {
      posted = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 0, data: { taskId: 'task-redraw-e2e' }, message: '' }),
      });
    });
    await page.route('**/api/v1/tasks/task-redraw-e2e', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            id: 'task-redraw-e2e',
            projectId: 'project-redraw-e2e',
            capability: 'local_redraw',
            status: 'succeeded',
            inputAssetIds: ['asset-original'],
            params: {},
            outputAsset: {
              id: 'asset-result',
              sourceUrl: '/uploads/generated/result.png',
              signedUrl: null,
              width: 240,
              height: 160,
            },
          },
          message: '',
        }),
      }),
    );

    await authed(page, '/local-redraw', token, email);
    await page.locator('input[type=file]').first().setInputFiles({
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: REDRAW_PNG,
    });

    const canvas = page.locator('.redraw-mask-overlay');
    await expect(canvas).toBeVisible();
    await page.waitForFunction(() => {
      const el = document.querySelector('.redraw-mask-overlay') as HTMLCanvasElement | null;
      return Boolean(el && el.width === 240 && el.height === 160);
    });
    await page.locator('.redraw-tool-btn', { hasText: '涂抹' }).click();

    const draw = async (y: number) => {
      const box = await canvas.boundingBox();
      expect(box).not.toBeNull();
      await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * y);
      await page.mouse.down();
      await page.mouse.move(box!.x + box!.width * 0.55, box!.y + box!.height * y, { steps: 5 });
      await page.mouse.up();
    };

    for (const y of [0.25, 0.4, 0.55, 0.7]) await draw(y);
    // 第 4 笔必须被拒绝，否则遮罩里会出现一条没有描述的区域。
    await expect(page.locator('.redraw-prompt')).toHaveCount(3);

    await page.locator('textarea').first().fill('把这里改成哑光材质');
    const submit = page.locator('button.pk-primary-btn').first();
    await expect(submit).toBeEnabled();

    await page.locator('.redraw-prompt-tools input[type=file]').first().setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: REDRAW_PNG,
    });
    await expect(page.getByText('上传中…')).toBeVisible();
    await expect(submit).toBeDisabled();

    await expect.poll(() => Boolean(finishReferenceUpload)).toBe(true);
    await finishReferenceUpload!();
    await expect(page.locator('.reference-upload.has-image img')).toBeVisible();
    await expect(submit).toBeEnabled();

    // 参考站仅在非原比例时提交 imageRatio；选 4:3 后随任务参数透传。
    await page.getByRole('button', { name: /高级设置/ }).click();
    await page.locator('.pk-ratio-option', { hasText: '4:3' }).click();

    await submit.click();
    await expect.poll(() => posted).not.toBeNull();
    const annotations = JSON.parse(posted.params.annotations);
    expect(annotations).toEqual([
      {
        annotationId: '1',
        label: '标注1',
        instruction: '把这里改成哑光材质',
        referenceAssetId: 'asset-reference',
      },
    ]);
    expect(posted.params.modelGuideAssetId).toBe('asset-mask');
    expect(posted.params.maskAssetId).toBe('asset-mask');
    expect(posted.params.prompt).toBe('标注1：把这里改成哑光材质');
    expect(posted.params.imageRatio).toBe('4:3');
    expect(posted.params.strength).toBe(0.5);
    expect(posted.params.outputCount).toBe(1);
    expect(posted.inputAssetIds).toEqual(['asset-original']);
    await expect(page.locator('.pk-result-body')).toBeVisible({ timeout: 15000 });
  });
});
