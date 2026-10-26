import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * 8 个图片工具页的参数映射与成功结果烟测（2026-10-25）。
 *
 * 只拦截网络，不依赖真实模型：上传、提交、轮询均按后端公开契约构造。
 * 重点守住参考站字段（selectedColor / resolution / maskAssetId /
 * templateCode / targetLanguage / placement* / targetColor / azimuthDeg）
 * 确实进入 /generate 的 params，并让每个页面都能走到结果态。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';
const API = process.env.E2E_API ?? 'http://localhost:4100';
const TASK_ID = 'task-params-e2e';

type Caps = {
  items: Array<Record<string, any>>;
  [key: string]: unknown;
};

const SOURCE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAPAAAACgCAIAAAC9uXYyAAABxklEQVR4nO3SQQ3AIADAwDHVyEETijBBQtLcKeijY679QcX/OgBuMjQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUgxNiqFJMTQphibF0KQYmhRDk2JoUg4r2AMqWugFPwAAAABJRU5ErkJggg==',
  'base64',
);

async function register(request: APIRequestContext): Promise<{ token: string; email: string }> {
  const email = `e2e-params-${Date.now()}-${Math.floor(Math.random() * 1e6)}@local.dev`;
  // 连续用例会触发注册限流。按服务端 Retry 窗口等待，避免把正常保护当成回归。
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await request.post(`${API}/api/v1/auth/register`, {
      data: { email, password: 'E2e@123456', name: 'e2e-params' },
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

async function setup(page: Page, request: APIRequestContext, capability: string) {
  const { token, email } = await register(request);
  const capsRes = await request.get(`${API}/api/v1/capabilities`);
  expect(capsRes.ok()).toBeTruthy();
  const caps = (await capsRes.json()).data as Caps;
  const item = caps.items.find((entry) => entry.id === capability);
  expect(item, `missing capability ${capability}`).toBeTruthy();
  item!.runtime = {
    ...item!.runtime,
    enabled: true,
    effective: 'remote',
    remoteAvailable: true,
    reason: null,
  };

  await page.route('**/api/v1/capabilities', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, data: caps, message: '' }),
    }),
  );
  await page.route('**/api/v1/projects', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, data: [{ id: 'project-e2e', name: '参数测试' }], message: '' }),
    }),
  );
  await page.route(/\/api\/v1\/tasks(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, data: [], message: '' }),
    }),
  );
  await page.route('**/uploads/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: SOURCE_PNG }),
  );
  await page.route('**/api/v1/assets/upload', async (route) => {
    const multipart = route.request().postDataBuffer()?.toString('latin1') ?? '';
    const isMask = /watermark-mask-|mask-/.test(multipart);
    const id = isMask ? 'asset-mask' : 'asset-original';
    const filename = isMask ? 'mask.png' : 'photo.png';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: {
          id,
          projectId: 'project-e2e',
          ownerId: 'u1',
          kind: 'original',
          sourceUrl: `/uploads/original/${filename}`,
          signedUrl: null,
          format: 'image/png',
          sizeBytes: SOURCE_PNG.length,
          createdAt: new Date().toISOString(),
        },
        message: '',
      }),
    });
  });

  let posted: any = null;
  await page.route('**/api/v1/generate', (route) => {
    posted = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ code: 0, data: { taskId: TASK_ID }, message: '' }),
    });
  });
  await page.route(`**/api/v1/tasks/${TASK_ID}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        data: {
          id: TASK_ID,
          projectId: 'project-e2e',
          capability,
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

  return { token, email, posted: () => posted };
}

async function uploadAndWait(page: Page) {
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: SOURCE_PNG,
  });
  await expect(page.locator('.pk-thumb img')).toBeVisible({ timeout: 15000 });
}

async function chooseRatio(page: Page, ratio: string) {
  await page.getByRole('button', { name: /高级设置/ }).click();
  await page.locator('.pk-ratio-option', { hasText: ratio }).click();
  await page.getByRole('button', { name: /高级设置/ }).click();
}

async function chooseResolution(page: Page, resolution: string) {
  await page.getByRole('button', { name: /高级设置/ }).click();
  await page.locator('.pk-resolution-option', { hasText: resolution }).click();
  await page.getByRole('button', { name: /高级设置/ }).click();
}

async function setRange(locator: ReturnType<Page['locator']>, value: number) {
  await locator.evaluate((element, next) => {
    const input = element as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setValue?.call(input, String(next));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

async function waitForPosted(page: Page, getPosted: () => any) {
  await page.locator('button.pk-primary-btn').first().click();
  await expect.poll(getPosted, { timeout: 15000 }).not.toBeNull();
  return getPosted();
}

test.describe('8 个工具页参数与结果态', () => {
  test('抠图：selectedColor/customColor/customAlpha/ratio/resolution', async ({ page, request }) => {
    const env = await setup(page, request, 'matting');
    await authed(page, '/background-remove', env.token, env.email);
    await expect(page.locator('.pk-settings-chip').first()).toHaveText('比例 原比例');
    await expect(page.locator('.pk-primary-credit')).toHaveText('限时免费');
    await uploadAndWait(page);

    await page.getByRole('button', { name: '自定义颜色' }).click();
    await page.locator('.color-studio-hex input').fill('#12');
    await expect(page.locator('button.pk-primary-btn').first()).toBeDisabled();
    await expect(page.locator('.color-studio-hex-error')).toContainText('有效的 HEX');
    await page.locator('.color-studio-hex input').fill('#22C55E');
    await setRange(page.locator('.color-studio-slider input[type=range]').last(), 72);
    await chooseRatio(page, '4:3');

    const posted = await waitForPosted(page, env.posted);
    expect(posted.capability).toBe('matting');
    expect(posted.params).toMatchObject({
      selectedColor: 'custom',
      customColor: '#22C55E',
      customAlpha: 72,
      ratio: '4:3',
      resolution: '1k',
    });
    await expect(page.locator('.matting-result-editor')).toBeVisible({ timeout: 15000 });
  });

  test('去水印：MANUAL 遮罩与 PNG 输出', async ({ page, request }) => {
    const env = await setup(page, request, 'remove_watermark');
    await authed(page, '/watermark-remove', env.token, env.email);
    await uploadAndWait(page);

    const canvas = page.locator('.redraw-mask-overlay, .mask-canvas-overlay').first();
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.8, { steps: 6 });
    await page.mouse.up();

    const posted = await waitForPosted(page, env.posted);
    expect(posted.params).toMatchObject({
      maskAssetId: 'asset-mask',
      detectionMode: 'MANUAL',
      outputFormat: 'PNG',
    });
    await expect(page.locator('.pk-result-card-detail')).toBeVisible({ timeout: 15000 });
  });

  test('产品精修：模板码、补充要求与参考比例', async ({ page, request }) => {
    const env = await setup(page, request, 'enhance');
    await authed(page, '/product-retouch', env.token, env.email);
    await uploadAndWait(page);

    await page.getByRole('radio', { name: '质感增强' }).click();
    await page.locator('textarea').first().fill('提升皮革纹理并保留金属高光');
    await chooseRatio(page, '4:3');

    const posted = await waitForPosted(page, env.posted);
    expect(posted.params).toMatchObject({
      templateCode: 'IT_PR_TEXTURE',
      additionalRequirement: '提升皮革纹理并保留金属高光',
      imageRatio: '4:3',
      ratio: '4:3',
    });
    await expect(page.locator('.pk-result-body')).toBeVisible({ timeout: 15000 });
  });

  test('图片翻译：目标语言、主体保护，且不发送 ratio', async ({ page, request }) => {
    const env = await setup(page, request, 'image_translate');
    await authed(page, '/image-translate', env.token, env.email);
    await uploadAndWait(page);

    await page.locator('.image-translate-language-field select').selectOption('ja-JP');
    await page.getByRole('switch').click();
    await chooseResolution(page, '2K');

    const posted = await waitForPosted(page, env.posted);
    expect(posted.params).toMatchObject({
      targetLang: 'ja-JP',
      targetLanguage: 'ja-JP',
      protectSubject: false,
      size: '2k',
    });
    expect(posted.params).not.toHaveProperty('ratio');
    await expect(page.locator('.pk-result-body')).toBeVisible({ timeout: 15000 });
  });

  test('智能扩图：按原图画布计算 placement 而非直接复制占比', async ({ page, request }) => {
    const env = await setup(page, request, 'expand');
    await authed(page, '/image-expand', env.token, env.email);
    await uploadAndWait(page);

    await expect(page.locator('.smart-expand-source-preview')).toBeVisible();
    await expect(page.locator('.smart-expand-source-preview img')).toBeVisible();

    await page.getByRole('textbox', { name: '自定义占比' }).fill('0');
    await expect(page.locator('button.pk-primary-btn').first()).toBeDisabled();
    await expect(page.locator('.smart-expand-field-error')).toContainText('1-100');
    await page.getByRole('textbox', { name: '自定义占比' }).fill('101');
    await expect(page.locator('button.pk-primary-btn').first()).toBeDisabled();
    await page.getByRole('textbox', { name: '自定义占比' }).fill('35');
    await page.getByRole('textbox', { name: '自定义占比' }).blur();
    await expect(page.locator('.smart-expand-preview-caption')).toContainText('原图 35%');
    await page.getByRole('radio', { name: '100%' }).click();
    await expect(page.locator('.smart-expand-source-preview img')).toHaveAttribute('style', /width: 100%/);
    await expect(page.locator('button.pk-primary-btn').first()).toBeEnabled();
    await page.getByRole('textbox', { name: '自定义占比' }).fill('60');
    await page.getByRole('radio', { name: '原图右下' }).click();
    await chooseRatio(page, '4:3');
    await expect(page.locator('.smart-expand-source-preview')).toHaveCSS('aspect-ratio', '4 / 3');
    await expect(page.locator('.smart-expand-source-preview img')).toHaveAttribute(
      'style',
      /width: 60%; height: 53\.3333%; left: 40%; top: 46\.6667%/,
    );

    const posted = await waitForPosted(page, env.posted);
    expect(posted.params).toMatchObject({
      occupy: 60,
      position: 'bottom-right',
      targetImageRatio: '4:3',
      ratio: '4:3',
      placementX: 0.4,
      placementY: 0.466667,
      placementWidth: 0.6,
      placementHeight: 0.533333,
    });
    await expect(page.locator('.pk-result-body')).toBeVisible({ timeout: 15000 });
  });

  test('商品换色：提交解析后的 targetColor 并兼容 customColor', async ({ page, request }) => {
    const env = await setup(page, request, 'recolor');
    await authed(page, '/product-recolor', env.token, env.email);
    await uploadAndWait(page);

    await page.getByRole('button', { name: '自定义颜色' }).click();
    await page.locator('.color-studio-hex input').fill('#12345');
    await expect(page.locator('button.pk-primary-btn').first()).toBeDisabled();
    await expect(page.locator('.color-studio-hex-error')).toBeVisible();
    await page.locator('.color-studio-hex input').fill('#7B2FF7');

    const posted = await waitForPosted(page, env.posted);
    expect(posted.params).toMatchObject({
      targetColor: '#7B2FF7',
      customColor: '#7B2FF7',
    });
    await expect(page.locator('.pk-result-body')).toBeVisible({ timeout: 15000 });
  });

  test('旋转角度：拖拽预览有效并提交参考站角度字段', async ({ page, request }) => {
    const env = await setup(page, request, 'rotate');
    await authed(page, '/rotate-angle', env.token, env.email);
    await uploadAndWait(page);

    const preview = page.locator('.rotate-angle-preview');
    const before = await page.locator('.rotate-angle-range b').first().textContent();
    await preview.scrollIntoViewIfNeeded();
    const box = await preview.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 55, box!.y + box!.height / 2 - 18, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('.rotate-angle-range b').first()).not.toHaveText(before ?? '');

    const sliders = page.locator('.rotate-angle-range input[type=range]');
    await setRange(sliders.nth(0), 35);
    await setRange(sliders.nth(1), 20);
    await setRange(sliders.nth(2), 1.1);
    await chooseRatio(page, '16:9');

    const posted = await waitForPosted(page, env.posted);
    expect(posted.params).toMatchObject({
      azimuthDeg: -35,
      elevationDeg: 20,
      zoomFactor: 1.1,
      yaw: 35,
      pitch: 20,
      zoom: 1.1,
      imageRatio: '16:9',
    });
    await expect(page.locator('.pk-result-body')).toBeVisible({ timeout: 15000 });
  });

  test('任务失败：展示失败结果，保留重新生成入口', async ({ page, request }) => {
    const env = await setup(page, request, 'matting');
    await page.unroute(`**/api/v1/tasks/${TASK_ID}`);
    await page.route(`**/api/v1/tasks/${TASK_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            id: TASK_ID,
            projectId: 'project-e2e',
            capability: 'matting',
            status: 'failed',
            inputAssetIds: ['asset-original'],
            params: {},
            outputAsset: null,
            errorCode: '42204',
          },
          message: '',
        }),
      }),
    );
    await authed(page, '/background-remove', env.token, env.email);
    await uploadAndWait(page);

    await waitForPosted(page, env.posted);
    await expect(page.locator('.pk-result-failed')).toContainText('生成失败', { timeout: 15000 });
    await expect(page.getByRole('button', { name: /重新生成/ })).toBeVisible();
  });

  test('去水印失败后可回到标注画布重新调整遮罩', async ({ page, request }) => {
    const env = await setup(page, request, 'remove_watermark');
    await page.unroute(`**/api/v1/tasks/${TASK_ID}`);
    await page.route(`**/api/v1/tasks/${TASK_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: {
            id: TASK_ID,
            projectId: 'project-e2e',
            capability: 'remove_watermark',
            status: 'failed',
            inputAssetIds: ['asset-original'],
            params: {},
            outputAsset: null,
            errorCode: '42201',
          },
          message: '',
        }),
      }),
    );
    await authed(page, '/watermark-remove', env.token, env.email);
    await uploadAndWait(page);

    const canvas = page.locator('.redraw-mask-overlay, .mask-canvas-overlay').first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.65, box!.y + box!.height * 0.75, { steps: 6 });
    await page.mouse.up();

    await waitForPosted(page, env.posted);
    await expect(page.locator('.pk-result-failed')).toContainText('生成失败', { timeout: 15000 });
    await page.getByRole('button', { name: '重新标注' }).click();
    await expect(canvas).toBeVisible();
    await expect(page.locator('button.pk-primary-btn').first()).toBeDisabled();
  });

  test('历史结果：支持灯箱预览、复用为当前输入，并清理旧结果态', async ({ page, request }) => {
    const env = await setup(page, request, 'enhance');
    await page.unroute(/\/api\/v1\/tasks(?:\?.*)?$/);
    await page.route(/\/api\/v1\/tasks(?:\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: [
            {
              id: 'task-history-e2e',
              projectId: 'project-e2e',
              capability: 'enhance',
              status: 'succeeded',
              inputAssetIds: ['asset-old'],
              params: {},
              createdAt: '2026-10-25T12:00:00.000Z',
              outputAsset: {
                id: 'asset-history',
                sourceUrl: '/uploads/generated/history.png',
                signedUrl: null,
                width: 240,
                height: 160,
                format: 'image/png',
              },
            },
          ],
          message: '',
        }),
      }),
    );
    await authed(page, '/product-retouch', env.token, env.email);

    const pane = page.locator('.redraw-history-pane');
    await expect(pane.locator('.tool-history-card')).toHaveCount(1);
    await expect(pane.locator('.tool-history-meta-actions')).toBeVisible();

    await uploadAndWait(page);
    await waitForPosted(page, env.posted);
    await expect(page.locator('.pk-result-body')).toBeVisible({ timeout: 15000 });

    await pane.getByRole('button', { name: '预览历史结果' }).click();
    await expect(page.locator('.img-viewer')).toBeVisible();
    await page.locator('.img-viewer-close').click();

    await pane.getByRole('button', { name: '使用历史结果继续创作' }).click();
    await expect(page.locator('.pk-thumb img')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('已把历史结果加入上传位')).toBeVisible();
    await expect(page.locator('.pk-result-body')).toHaveCount(0);
  });
});

test.describe('移动端布局烟测', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('8 个工具页均保持可操作且无横向溢出', async ({ page, request }) => {
    const env = await setup(page, request, 'matting');
    const routes = [
      '/local-redraw',
      '/background-remove',
      '/watermark-remove',
      '/product-retouch',
      '/image-translate',
      '/image-expand',
      '/product-recolor',
      '/rotate-angle',
    ];
    await authed(page, routes[0], env.token, env.email);

    for (const route of routes) {
      await page.goto(`${UI}${route}`);
      await expect(page.locator('.pk-input-pane')).toBeVisible();
      await expect(page.locator('button.pk-primary-btn').first()).toBeVisible();
      await expect(page.locator('button.pk-primary-btn').first()).toBeDisabled();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${route} 横向溢出 ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });

  test('局部重绘移动历史抽屉位于共享上下文内，可预览并复用', async ({ page, request }) => {
    const env = await setup(page, request, 'local_redraw');
    await page.unroute(/\/api\/v1\/tasks(?:\?.*)?$/);
    await page.route(/\/api\/v1\/tasks(?:\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: [
            {
              id: 'task-redraw-history',
              projectId: 'project-e2e',
              capability: 'local_redraw',
              status: 'succeeded',
              createdAt: '2026-10-25T12:00:00.000Z',
              outputAsset: {
                id: 'asset-redraw-history',
                sourceUrl: '/uploads/generated/redraw-history.png',
                signedUrl: null,
                width: 240,
                height: 160,
                format: 'image/png',
              },
            },
          ],
          message: '',
        }),
      }),
    );
    await authed(page, '/local-redraw', env.token, env.email);

    await page.locator('.redraw-history-float-toggle').click();
    const drawer = page.locator('.ant-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: '使用历史结果继续创作' })).toBeVisible();
    await drawer.getByRole('button', { name: '使用历史结果继续创作' }).click();
    await expect(page.locator('.pk-thumb img')).toBeVisible({ timeout: 15000 });
  });
});
