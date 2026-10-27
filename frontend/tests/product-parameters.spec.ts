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
      body: JSON.stringify(succeededTask(capability)),
    }),
  );

  return { token, email, posted: () => posted };
}

function succeededTask(capability: string) {
  return {
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
  };
}

async function uploadAndWait(page: Page) {
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'photo.png',
    mimeType: 'image/png',
    buffer: SOURCE_PNG,
  });
  // 修图系多数页面使用参考站 source-row 自绘预览，其余工具仍是 pk-thumb。
  await expect(
    page
      .locator(
        '.pk-thumb img, .local-source-preview img, .background-source-preview img, .smart-expand-source-thumb img, .product-retouch-source-preview img',
      )
      .first(),
  ).toBeVisible({ timeout: 15000 });
}

async function chooseRatio(page: Page, ratio: string) {
  await page.locator('.pk-settings-summary').click();
  await page.locator('.pk-ratio-option', { hasText: ratio }).click();
  await page.locator('.pk-settings-summary').click();
}

async function chooseResolution(page: Page, resolution: string) {
  await page.locator('.pk-settings-summary').click();
  await page.locator('.pk-resolution-option', { hasText: resolution }).click();
  await page.locator('.pk-settings-summary').click();
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

type Size = [number, number];

const PRODUCT_SOURCE_DESKTOP: Record<string, Size> = {
  uploadCard: [428, 226],
  row: [396, 160],
  thumb: [160, 160],
  thumbImage: [158, 158],
  reupload: [88, 40],
  resultPane: [572, 788],
  resultCard: [572, 680],
  resultImage: [572, 680],
  badge: [42, 26],
};

const PRODUCT_SOURCE_MOBILE: Record<string, Size> = {
  uploadCard: [370, 220],
  row: [342, 160],
  thumb: [160, 160],
  thumbImage: [158, 158],
  reupload: [88, 40],
  resultPane: [370, 720],
  resultCard: [370, 672],
  resultImage: [370, 672],
  badge: [42, 26],
};

const PRODUCT_SOURCE_ROTATE_MOBILE: Record<string, Size> = {
  ...PRODUCT_SOURCE_MOBILE,
  uploadCard: [370, 226],
  row: [338, 160],
  reupload: [90, 40],
  resultPane: [370, 402],
  resultCard: [334, 223],
  resultImage: [334, 223],
};

async function readProductSourceLayout(page: Page) {
  return page.evaluate(() => {
    const size = (selector: string): [number, number] | null => {
      const box = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      return box ? [Math.round(box.width), Math.round(box.height)] : null;
    };
    const card = document.querySelector<HTMLElement>('.product-retouch-result-card');
    const sourceImage = document.querySelector<HTMLImageElement>('.product-retouch-result-preview img');
    return {
      uploadCard: size('.pk-workspace.product-retouch-page .pk-config-card'),
      row: size('.pk-workspace.product-retouch-page .source-row'),
      thumb: size('.product-retouch-source-preview'),
      thumbImage: size('.product-retouch-source-preview img'),
      reupload: size('.source-row > div > button'),
      resultPane: size('.pk-result-pane'),
      resultCard: size('.product-retouch-result-card'),
      resultImage: size('.product-retouch-result-preview img'),
      badge: size('.product-retouch-result-mode'),
      aspect: card ? Number(getComputedStyle(card).getPropertyValue('--result-card-aspect')) : null,
      imageAspect: sourceImage ? sourceImage.naturalWidth / sourceImage.naturalHeight : null,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function expectProductSourceLayout(page: Page, expected: Record<string, Size>) {
  await expect(page.locator('.product-retouch-source-preview img')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.product-retouch-result-preview img')).toBeVisible({ timeout: 15000 });
  await expect
    .poll(async () => {
      const layout = await readProductSourceLayout(page);
      return layout.aspect !== null && layout.imageAspect !== null
        ? Math.abs(layout.aspect - layout.imageAspect) < 0.001
        : false;
    })
    .toBe(true);

  const layout = await readProductSourceLayout(page);
  expect(layout).toMatchObject(expected);
  expect(layout.imageAspect).not.toBeNull();
  expect(layout.aspect).toBeCloseTo(layout.imageAspect!, 3);
  expect(layout.overflow).toBe(0);
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
    await expect(page.locator('.pk-input-pane')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.pk-settings-chip').first()).toHaveText('比例 原比例');
    await expect(page.locator('.pk-primary-credit')).toHaveText('限时免费');
    await uploadAndWait(page);
    await expect(page.locator('.background-source-row')).toBeVisible();
    await expect(page.locator('.background-source-preview img')).toBeVisible();
    await expect(page.getByRole('button', { name: '重新上传' })).toBeVisible();
    const uploadPreview = await page.evaluate(() => {
      const thumb = document.querySelector<HTMLElement>('.background-source-preview');
      const preview = document.querySelector<HTMLElement>('.background-remove-source-preview');
      const img = preview?.querySelector<HTMLImageElement>('img');
      const thumbRect = thumb?.getBoundingClientRect();
      const previewRect = preview?.getBoundingClientRect();
      return {
        thumb: thumbRect ? [Math.round(thumbRect.width), Math.round(thumbRect.height)] : null,
        previewRatio: previewRect ? +(previewRect.width / previewRect.height).toFixed(3) : null,
        imageRatio: img ? +(img.naturalWidth / img.naturalHeight).toFixed(3) : null,
        previewBackground: preview ? getComputedStyle(preview).backgroundImage : null,
      };
    });
    expect(uploadPreview.thumb).toEqual([160, 160]);
    expect(uploadPreview.previewRatio).toBe(uploadPreview.imageRatio);
    expect(uploadPreview.previewBackground).toContain('linear-gradient');

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
    await expect(page.locator('.local-redraw-stage')).toBeVisible();
    await expect(page.locator('.redraw-toolbar')).toHaveCount(1);
    await expect(page.locator('.redraw-toolbar input[type=range]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '抓手' })).toBeVisible();
    const rectTool = page.getByRole('button', { name: '框选' });
    await expect(rectTool).toHaveAttribute('aria-pressed', 'true');

    const stageMetrics = await page.locator('.local-redraw-stage').evaluate((stage) => {
      const canvas = stage.querySelector<HTMLElement>('.redraw-canvas');
      const toolbar = stage.querySelector<HTMLElement>('.redraw-toolbar');
      const footer = stage.querySelector<HTMLElement>('.redraw-canvas-footer');
      const canvasRect = canvas?.getBoundingClientRect();
      const toolbarRect = toolbar?.getBoundingClientRect();
      const footerRect = footer?.getBoundingClientRect();
      return {
        canvas: canvasRect ? [Math.round(canvasRect.width), Math.round(canvasRect.height)] : null,
        toolbar: toolbarRect ? [Math.round(toolbarRect.width), Math.round(toolbarRect.height)] : null,
        footer: footerRect ? [Math.round(footerRect.width), Math.round(footerRect.height)] : null,
      };
    });
    expect(stageMetrics.canvas?.[0]).toBe(stageMetrics.canvas?.[1]);
    expect(stageMetrics.toolbar).toEqual([210, 40]);
    expect(stageMetrics.footer).toEqual([317, 40]);

    const canvas = page.locator('.redraw-image-frame');
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.2, box!.y + box!.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.75, { steps: 6 });
    await page.mouse.up();

    const mark = page.locator('.mask-mark.rect').first();
    await expect(mark).toBeVisible();
    await expect(mark).toHaveClass(/is-selected/);
    await expect(mark.locator('.mask-mark-index')).toHaveText('1');
    await expect(mark.locator('.resize-handle')).toHaveCount(4);
    await expect(mark.locator('.resize-handle.n')).toBeVisible();
    await expect(mark.locator('.resize-handle.e')).toBeVisible();
    await expect(mark.locator('.resize-handle.s')).toBeVisible();
    await expect(mark.locator('.resize-handle.w')).toBeVisible();
    await expect(page.locator('.annotation-mark-preview')).toHaveCount(1);
    await expect(page.locator('.redraw-shortcut-hint')).toHaveText(
      '快捷键：H 抓手 · Ctrl+Z 撤回 · Ctrl+Shift+Z 恢复 · +/- 缩放',
    );

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
    await page.setViewportSize({ width: 1440, height: 900 });
    await authed(page, '/product-retouch', env.token, env.email);
    await uploadAndWait(page);
    await expectProductSourceLayout(page, PRODUCT_SOURCE_DESKTOP);

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
    await page.setViewportSize({ width: 1440, height: 900 });
    await authed(page, '/image-translate', env.token, env.email);
    await uploadAndWait(page);
    await expectProductSourceLayout(page, PRODUCT_SOURCE_DESKTOP);

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
    await page.setViewportSize({ width: 1440, height: 900 });
    await authed(page, '/image-expand', env.token, env.email);
    await uploadAndWait(page);

    await expect(page.locator('.smart-expand-source-row')).toBeVisible();
    await expect(page.locator('.smart-expand-source-preview')).toBeVisible();
    await expect(page.locator('.smart-expand-source-preview img')).toBeVisible();
    await expect(page.locator('.smart-expand-preview-caption')).toHaveCount(0);
    await expect(page.locator('.smart-expand-source-preview')).toHaveCSS('aspect-ratio', '240 / 160');
    await expect(page.locator('.smart-expand-source-preview img')).toHaveAttribute(
      'style',
      /width: 80%; height: 80%; left: 10%; top: 10%/,
    );

    const uploadMetrics = await page.evaluate(() => {
      const rect = (selector: string) => {
        const box = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
        return box ? [Math.round(box.width), Math.round(box.height)] : null;
      };
      return {
        card: rect('.smart-expand-page .pk-config-card'),
        row: rect('.smart-expand-source-row'),
        thumb: rect('.smart-expand-source-thumb'),
        reupload: rect('.smart-expand-source-reupload'),
        preview: rect('.smart-expand-source-preview'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(uploadMetrics).toEqual({
      card: [428, 226],
      row: [396, 160],
      thumb: [160, 160],
      reupload: [88, 40],
      preview: [524, 680],
      overflow: 0,
    });

    await page.getByRole('textbox', { name: '自定义占比' }).fill('0');
    await expect(page.locator('button.pk-primary-btn').first()).toBeDisabled();
    await expect(page.locator('.smart-expand-field-error')).toContainText('1-99');
    await page.getByRole('textbox', { name: '自定义占比' }).fill('100');
    await expect(page.locator('button.pk-primary-btn').first()).toBeDisabled();
    await page.getByRole('textbox', { name: '自定义占比' }).fill('35');
    await page.getByRole('textbox', { name: '自定义占比' }).blur();
    await expect(page.locator('.smart-expand-source-preview img')).toHaveAttribute('style', /width: 35%/);
    await page.getByRole('radio', { name: '100%' }).click();
    await expect(page.locator('.smart-expand-source-preview img')).toHaveAttribute('style', /width: 100%/);
    await expect(page.locator('button.pk-primary-btn').first()).toBeEnabled();
    await page.getByRole('textbox', { name: '自定义占比' }).fill('60');
    await page.getByRole('radio', { name: '原图右下' }).click();
    await chooseRatio(page, '4:3');
    await expect(page.locator('.smart-expand-source-preview')).toHaveCSS('aspect-ratio', '1152 / 864');
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
    await page.setViewportSize({ width: 1440, height: 900 });
    await authed(page, '/product-recolor', env.token, env.email);
    await uploadAndWait(page);
    await expectProductSourceLayout(page, PRODUCT_SOURCE_DESKTOP);

    await page.getByRole('button', { name: '自定义颜色' }).click();
    await page.locator('.color-studio-hex input').fill('#12345');
    await expect(page.locator('button.pk-primary-btn').first()).toBeDisabled();
    await expect(page.locator('.color-studio-hex-error')).toBeVisible();
    await page.locator('.color-studio-hex input').fill('#7B2FF7');

    // 任务响应延迟，先检查生成态是否真的有可见骨架，而不是整块白板。
    await page.unroute(`**/api/v1/tasks/${TASK_ID}`);
    await page.route(`**/api/v1/tasks/${TASK_ID}`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(succeededTask('recolor')),
      });
    });

    const posted = await waitForPosted(page, env.posted);
    expect(posted.params).toMatchObject({
      targetColor: '#7B2FF7',
      customColor: '#7B2FF7',
    });

    await expect(page.locator('.product-recolor-result')).toBeVisible();
    const generating = await page.evaluate(() => {
      const box = (selector: string) => {
        const rect = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
        return rect ? { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
      };
      return {
        pane: box('.product-recolor-page .pk-result-pane'),
        card: box('.product-recolor-page .product-recolor-generating-card'),
        tip: box('.product-recolor-page .state-loading-tip'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(generating.card).not.toBeNull();
    expect(generating.card!.width).toBeGreaterThan(400);
    expect(generating.card!.height).toBeGreaterThan(200);
    expect(generating.tip!.top).toBeLessThanOrEqual(generating.pane!.bottom);
    expect(generating.overflow).toBe(0);

    await expect(page.locator('.product-recolor-result .product-retouch-result-card')).toBeVisible({
      timeout: 15000,
    });
    const desktopResult = await page.evaluate(() => {
      const box = (selector: string) => {
        const rect = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
        return rect ? { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
      };
      return {
        pane: box('.product-recolor-page .pk-result-pane'),
        card: box('.product-recolor-page .product-recolor-result .product-retouch-result-card'),
        badge: box('.product-recolor-page .product-recolor-result .product-retouch-result-mode'),
        download: box('.product-recolor-page .product-recolor-result .product-retouch-download'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(desktopResult.card!.width).toBeGreaterThan(500);
    expect(desktopResult.card!.bottom).toBeLessThanOrEqual(desktopResult.pane!.bottom + 1);
    expect(desktopResult.badge!.width).toBeGreaterThan(40);
    expect(desktopResult.download!.width).toBeGreaterThan(40);
    expect(desktopResult.overflow).toBe(0);

    // 窄屏成功后结果栏按参考站 360px 下限收高，结果卡不产生横向溢出。
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileResult = await page.evaluate(() => {
      const box = (selector: string) => {
        const rect = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
        return rect ? { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
      };
      return {
        pane: box('.product-recolor-page .pk-result-pane'),
        card: box('.product-recolor-page .product-recolor-result .product-retouch-result-card'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(mobileResult.pane!.height).toBeLessThan(600);
    expect(mobileResult.card!.width).toBeGreaterThan(320);
    expect(mobileResult.overflow).toBe(0);

    // 再次提交仍经过同一延迟路由，验证移动端生成中也不会撑出 720px 白板。
    await page.locator('button.pk-primary-btn').first().click();
    await expect(page.locator('.product-recolor-generating-card')).toBeVisible();
    const mobileGenerating = await page.evaluate(() => {
      const box = (selector: string) => {
        const rect = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
        return rect ? { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null;
      };
      return {
        pane: box('.product-recolor-page .pk-result-pane'),
        card: box('.product-recolor-page .product-recolor-generating-card'),
        tip: box('.product-recolor-page .state-loading-tip'),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(mobileGenerating.pane!.height).toBeLessThan(500);
    expect(mobileGenerating.card!.width).toBeGreaterThan(300);
    expect(mobileGenerating.tip!.top).toBeLessThanOrEqual(mobileGenerating.pane!.bottom);
    expect(mobileGenerating.overflow).toBe(0);
    await expect(page.locator('.product-recolor-result .product-retouch-result-card')).toBeVisible({
      timeout: 15000,
    });
  });

  test('商品换色：已有一张图时仍可从素材库再次导入并替换', async ({ page, request }) => {
    const env = await setup(page, request, 'recolor');
    await page.setViewportSize({ width: 1440, height: 900 });
    const libraryItems = ['library-one.png', 'library-two.png'].map((filename, index) => ({
      id: `asset-library-${index + 1}`,
      projectId: 'project-e2e',
      ownerId: 'u1',
      kind: 'original',
      sourceUrl: `/uploads/library/${filename}`,
      signedUrl: null,
      width: 240,
      height: 160,
      format: 'image/png',
      sizeBytes: SOURCE_PNG.length,
      createdAt: new Date().toISOString(),
    }));
    await page.route(/\/api\/v1\/assets(?:\?.*)?$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 0,
          data: { items: libraryItems, total: libraryItems.length, limit: 120, offset: 0 },
          message: '',
        }),
      }),
    );

    await authed(page, '/product-recolor', env.token, env.email);
    await page.getByRole('button', { name: '从素材库导入' }).click();
    await expect(page.locator('.alp-card')).toHaveCount(2);
    await page.locator('.alp-card').nth(0).click();
    await page.getByRole('button', { name: '使用此素材' }).click();
    await expect(page.locator('.product-retouch-source-preview img')).toHaveAttribute(
      'src',
      /library-one\.png/,
    );

    // 单图替换不是「剩余 0 个图片位」：再次打开必须仍可选 1 张。
    await page.getByRole('button', { name: '从素材库导入' }).click();
    await expect(page.locator('.alp-footer-info')).toContainText('最多选择 1 张');
    await expect(page.locator('.alp-card')).toHaveCount(2);
    await page.locator('.alp-card').nth(1).click();
    await page.getByRole('button', { name: '使用此素材' }).click();
    await expect(page.locator('.product-retouch-source-preview img')).toHaveAttribute(
      'src',
      /library-two\.png/,
    );
  });

  test('旋转角度：拖拽预览有效并提交参考站角度字段', async ({ page, request }) => {
    const env = await setup(page, request, 'rotate');
    await page.setViewportSize({ width: 1440, height: 900 });
    await authed(page, '/rotate-angle', env.token, env.email);
    await uploadAndWait(page);
    await expectProductSourceLayout(page, PRODUCT_SOURCE_DESKTOP);

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

    const canvas = page.locator('.redraw-image-frame');
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
    await expect(page.locator('.mask-mark.rect')).toHaveCount(0);
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
    await expect(page.locator('.product-retouch-source-preview img')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('已把历史结果加入上传位')).toBeVisible();
    await expect(page.locator('.pk-result-body')).toHaveCount(0);
  });
});

test.describe('色板复刻', () => {
  test('白色/透明底独立可见，选中渲染 15px 勾，自定义色切换为当前色', async ({ page, request }) => {
    const env = await setup(page, request, 'matting');
    await page.setViewportSize({ width: 1440, height: 900 });
    await authed(page, '/background-remove', env.token, env.email);

    const root = page.locator('.background-color-options');
    await expect(root).toBeVisible();
    await expect(root.locator('.background-color-option')).toHaveCount(7);

    const metrics = await root.evaluate((el) => {
      const options = [...el.querySelectorAll<HTMLElement>('.background-color-option')];
      const active = el.querySelector<HTMLElement>('.background-color-option.active');
      const white = el.querySelector<HTMLElement>('.background-color-option.white');
      const check = active?.querySelector('svg');
      const custom = el.querySelector<HTMLElement>('.custom-trigger');
      return {
        columnGap: getComputedStyle(el).columnGap,
        sizes: options.map((node) => {
          const r = node.getBoundingClientRect();
          return [Math.round(r.width), Math.round(r.height)];
        }),
        activeSvg: check
          ? {
              width: Math.round(check.getBoundingClientRect().width),
              height: Math.round(check.getBoundingClientRect().height),
              color: getComputedStyle(check).color,
              background: getComputedStyle(check).backgroundColor,
            }
          : null,
        white: white
          ? {
              border: getComputedStyle(white).border,
              background: getComputedStyle(white).backgroundColor,
            }
          : null,
        custom: custom
          ? {
              backgroundImage: getComputedStyle(custom).backgroundImage,
              imageDisplay: custom.querySelector('img') ? getComputedStyle(custom.querySelector('img')!).display : null,
            }
          : null,
      };
    });

    expect(metrics.columnGap).toBe('16px');
    expect(metrics.sizes).toEqual(Array.from({ length: 7 }, () => [40, 40]));
    expect(metrics.activeSvg).toEqual({
      width: 15,
      height: 15,
      color: 'rgb(255, 255, 255)',
      background: 'rgb(85, 70, 216)',
    });
    expect(metrics.white).toEqual({ border: '1px solid rgb(223, 227, 235)', background: 'rgb(255, 255, 255)' });
    expect(metrics.custom?.backgroundImage).toContain('/static/color.svg');
    expect(metrics.custom?.imageDisplay).toBe('block');

    await page.getByRole('button', { name: '白色' }).click();
    const activeWhite = await page.locator('.background-color-option.white.active').evaluate((el) => {
      const svg = el.querySelector('svg');
      return svg
        ? { color: getComputedStyle(svg).color, background: getComputedStyle(svg).backgroundColor }
        : null;
    });
    expect(activeWhite).toEqual({ color: 'rgb(255, 255, 255)', background: 'rgb(85, 70, 216)' });

    const custom = page.locator('.custom-trigger');
    await custom.click();
    await expect(custom).toHaveClass(/custom-selected/);
    const selected = await custom.evaluate((el) => {
      const svg = el.querySelector('svg');
      const img = el.querySelector('img');
      return {
        background: getComputedStyle(el).backgroundColor,
        imageDisplay: img ? getComputedStyle(img).display : null,
        check: svg
          ? {
              width: Math.round(svg.getBoundingClientRect().width),
              color: getComputedStyle(svg).color,
              background: getComputedStyle(svg).backgroundColor,
            }
          : null,
      };
    });
    expect(selected).toEqual({
      background: 'rgb(85, 70, 216)',
      imageDisplay: 'none',
      check: { width: 15, color: 'rgb(85, 70, 216)', background: 'rgb(255, 255, 255)' },
    });
  });
});

test.describe('移动端布局烟测', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('8 个工具页均保持可操作且无横向溢出，去水印画布可框选', async ({ page, request }) => {
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
      await expect(page.locator('.pk-input-pane')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('button.pk-primary-btn').first()).toBeVisible();
      await expect(page.locator('button.pk-primary-btn').first()).toBeDisabled();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${route} 横向溢出 ${overflow}px`).toBeLessThanOrEqual(1);
    }

    await page.goto(`${UI}/watermark-remove`);
    await uploadAndWait(page);
    await page.locator('.local-redraw-stage').scrollIntoViewIfNeeded();
    const frame = page.locator('.redraw-image-frame');
    await expect(frame).toBeVisible({ timeout: 15000 });
    const frameBox = await frame.boundingBox();
    expect(frameBox).not.toBeNull();
    await page.mouse.move(frameBox!.x + frameBox!.width * 0.25, frameBox!.y + frameBox!.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(frameBox!.x + frameBox!.width * 0.7, frameBox!.y + frameBox!.height * 0.7, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.mask-mark.rect')).toBeVisible();

    const metrics = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>('.redraw-canvas');
      const toolbar = document.querySelector<HTMLElement>('.redraw-toolbar');
      const footer = document.querySelector<HTMLElement>('.redraw-canvas-footer');
      const canvasRect = canvas?.getBoundingClientRect();
      const toolbarRect = toolbar?.getBoundingClientRect();
      const footerRect = footer?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        canvas: canvasRect ? [Math.round(canvasRect.width), Math.round(canvasRect.height)] : null,
        toolbar: toolbarRect ? { x: Math.round(toolbarRect.x), size: [Math.round(toolbarRect.width), Math.round(toolbarRect.height)] } : null,
        footer: footerRect ? [Math.round(footerRect.width), Math.round(footerRect.height)] : null,
      };
    });
    expect(metrics.overflow).toBeLessThanOrEqual(1);
    expect(metrics.canvas?.[0]).toBe(metrics.canvas?.[1]);
    expect(metrics.toolbar).toEqual({ x: 78, size: [210, 40] });
    expect(metrics.footer).toEqual([256, 40]);

    await page.goto(`${UI}/background-remove`);
    await uploadAndWait(page);
    await expect(page.locator('.background-source-row')).toBeVisible();
    const mattingUpload = await page.evaluate(() => {
      const thumb = document.querySelector<HTMLElement>('.background-source-preview');
      const reupload = document.querySelector<HTMLElement>('.background-source-reupload');
      const preview = document.querySelector<HTMLElement>('.background-remove-source-preview');
      const img = preview?.querySelector<HTMLImageElement>('img');
      const thumbRect = thumb?.getBoundingClientRect();
      const reuploadRect = reupload?.getBoundingClientRect();
      const previewRect = preview?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        thumb: thumbRect ? [Math.round(thumbRect.width), Math.round(thumbRect.height)] : null,
        reupload: reuploadRect ? [Math.round(reuploadRect.width), Math.round(reuploadRect.height)] : null,
        previewRatio: previewRect ? +(previewRect.width / previewRect.height).toFixed(3) : null,
        imageRatio: img ? +(img.naturalWidth / img.naturalHeight).toFixed(3) : null,
      };
    });
    expect(mattingUpload.overflow).toBeLessThanOrEqual(1);
    expect(mattingUpload.thumb).toEqual([160, 160]);
    expect(mattingUpload.reupload).toEqual([88, 40]);
    expect(mattingUpload.previewRatio).toBe(mattingUpload.imageRatio);

    await page.goto(`${UI}/image-expand`);
    await uploadAndWait(page);
    await expect(page.locator('.smart-expand-source-row')).toBeVisible();
    const expandUpload = await page.evaluate(() => {
      const rect = (selector: string) => {
        const box = document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
        return box ? [Math.round(box.width), Math.round(box.height)] : null;
      };
      const cards = [...document.querySelectorAll<HTMLElement>('.smart-expand-page .smart-expand-card')].map(
        (card) => {
          const box = card.getBoundingClientRect();
          return [Math.round(box.width), Math.round(box.height)];
        },
      );
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        uploadCard: rect('.smart-expand-page .pk-config-card'),
        row: rect('.smart-expand-source-row'),
        thumb: rect('.smart-expand-source-thumb'),
        reupload: rect('.smart-expand-source-reupload'),
        scaleCard: cards[0] ?? null,
        positionCard: cards[1] ?? null,
        preview: rect('.smart-expand-source-preview'),
      };
    });
    expect(expandUpload).toEqual({
      overflow: 0,
      uploadCard: [370, 220],
      row: [342, 160],
      thumb: [160, 160],
      reupload: [88, 40],
      scaleCard: [370, 100],
      positionCard: [370, 164],
      preview: [322, 672],
    });

    for (const [route, expected] of [
      ['/image-translate', PRODUCT_SOURCE_MOBILE],
      ['/product-retouch', PRODUCT_SOURCE_MOBILE],
      ['/product-recolor', PRODUCT_SOURCE_MOBILE],
      ['/rotate-angle', PRODUCT_SOURCE_ROTATE_MOBILE],
    ] as const) {
      await page.goto(`${UI}${route}`);
      await uploadAndWait(page);
      await expectProductSourceLayout(page, expected);
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
    // 局部重绘的上传位是页面自绘的「160×160 预览 + 重新编辑/重新上传」
    // (参考站 source-row 结构)，不是默认 pk-thumb 缩略图网格。
    await expect(page.locator('.local-source-preview img')).toBeVisible({ timeout: 15000 });
  });
});
