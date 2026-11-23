import { expect, test, type Page } from '@playwright/test';

/**
 * 图片上传的运行时回归（真实 Chromium）。
 *
 * ## 前置
 *
 * - 前端 dev server 在跑（默认 `http://localhost:5100`，用 `ADMIN_UI` 覆盖）；
 * - 后端可用（页面要拉 `/api/v1/capabilities` 与上传限额）；
 * - **必须以访客身份运行**：默认 `playwright.config.ts` 不带 `storageState`。
 *   若带登录态，上传会真落库，本文件里「访客态停在请先登录」的断言不成立。
 *
 * 命令行见 `docs/testing.md` §3.5。会话契约见 `docs/responsive-layout.md` §6
 * （390px 无横向滚动）与 `docs/frontend-component-language.md` 的上传区条目。
 *
 * 选择器用组件公开的 `data-slot` 与 role/text，不追 Tailwind 类名。
 *
 * ## 范围
 *
 * 覆盖拖拽、粘贴、390px 窄屏三条不依赖后端写入的路径：
 *   - 拖拽高亮与落下事件确实接到上传区；
 *   - 不支持的文件在客户端被拦下（提示而不是发请求）；
 *   - 窄屏下上传区自身不产生横向滚动。
 *
 * 需要登录态 + 后端落库的路径（真实图片上传成功、素材库回填、手机扫码回传）
 * 在本文件里显式 skip，理由写在各条用例里 —— 不把未跑写成通过。
 */

/*
 * 强制访客态：`playwright.admin.config.ts` 会给 chromium 项目挂后台登录的
 * storageState，整份 `npm run e2e` 一起跑时本文件会被带上登录态，而这里的断言
 * 刻意验证访客行为。显式清空会话，让它与跑法无关。
 */
test.use({ storageState: { cookies: [], origins: [] } });

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';
/** 工具页上传区最密集的一条路由（单图参考图 + 多图商品图） */
const PAGE = '/viral-clone';
const AREA = '[data-slot="image-upload-area"]';

async function openUploadPage(page: Page) {
  await page.goto(`${UI}${PAGE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(AREA, { timeout: 30000 });
  await page
    .waitForFunction(() => (document.body.innerText ?? '').trim().length > 40, { timeout: 30000 })
    .catch(() => undefined);
  await page.waitForTimeout(400);
}

/** 用真实 DataTransfer 构造一次拖拽/粘贴，文件和事件都在页面里生成。 */
async function dispatchWithFile(
  page: Page,
  action: 'dragover' | 'drop' | 'paste',
  file: { name: string; type: string; body: string },
) {
  await page.evaluate(
    ({ action: kind, file: spec, selector }) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([spec.body], spec.name, { type: spec.type }));
      const target =
        kind === 'paste'
          ? window
          : document.querySelector(selector) ?? document.body;
      const event =
        kind === 'paste'
          ? new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dataTransfer })
          : new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer });
      target.dispatchEvent(event);
    },
    { action, file, selector: AREA },
  );
}

async function hasDragging(page: Page) {
  return page.evaluate(
    (selector) => document.querySelector(selector)?.getAttribute('data-dragging') === 'true',
    AREA,
  );
}

test.describe('图片上传运行时（T-033）', () => {
  test('拖拽悬停触发高亮，离开后清除', async ({ page }) => {
    await openUploadPage(page);
    const area = page.locator(AREA).first();

    await dispatchWithFile(page, 'dragover', { name: 'a.png', type: 'image/png', body: 'x' });
    await expect.poll(() => hasDragging(page)).toBe(true);

    await area.dispatchEvent('dragleave');
    await expect.poll(() => hasDragging(page)).toBe(false);
  });

  test('拖入不支持的文件：客户端拦下并提示，不发起上传', async ({ page }) => {
    await openUploadPage(page);
    const requests: string[] = [];
    page.on('request', (request) => {
      if (/\/assets?(\/|$)/.test(new URL(request.url()).pathname) && request.method() === 'POST') {
        requests.push(request.url());
      }
    });

    await dispatchWithFile(page, 'drop', { name: 'note.txt', type: 'text/plain', body: 'x' });

    await expect(page.getByText(/请选择图片文件|格式的图片|不支持/).first()).toBeVisible({
      timeout: 5000,
    });
    expect(requests, `不应发起上传请求，实际：${requests.join(', ')}`).toHaveLength(0);
  });

  test('粘贴图片进入上传通道（访客态停在「请先登录」）', async ({ page }) => {
    await openUploadPage(page);

    await dispatchWithFile(page, 'paste', { name: 'paste.png', type: 'image/png', body: 'x' });

    // `usePasteUpload` 只接剪贴板里的图片；贴文本应当放行给输入框，不抢事件。
    await expect(page.getByText(/请先登录|上传中|上传失败/).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test('粘贴纯文本不触发上传（不抢输入框的粘贴）', async ({ page }) => {
    await openUploadPage(page);
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/assets?(\/|$)/.test(new URL(request.url()).pathname)) {
        requests.push(request.url());
      }
    });

    await dispatchWithFile(page, 'paste', { name: 'note.txt', type: 'text/plain', body: 'hello' });
    await page.waitForTimeout(800);

    expect(requests, `粘贴文本不应上传，实际：${requests.join(', ')}`).toHaveLength(0);
    await expect(page.getByText(/请选择图片文件|请先登录/)).toHaveCount(0);
  });

  test('390px 窄屏：上传区无横向溢出，入口仍可点', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openUploadPage(page);

    const metrics = await page.evaluate((selector) => {
      const doc = document.documentElement;
      const area = document.querySelector<HTMLElement>(selector);
      return {
        docScroll: doc.scrollWidth,
        docClient: doc.clientWidth,
        areaScroll: area?.scrollWidth ?? null,
        areaClient: area?.clientWidth ?? null,
        areaWidth: area?.getBoundingClientRect().width ?? null,
      };
    }, AREA);

    expect(
      metrics.docScroll,
      `documentElement 横向溢出：${metrics.docScroll} > ${metrics.docClient}`,
    ).toBeLessThanOrEqual(metrics.docClient + 1);
    expect(
      metrics.areaScroll,
      `上传区横向溢出：${metrics.areaScroll} > ${metrics.areaClient}`,
    ).toBeLessThanOrEqual((metrics.areaClient ?? 0) + 1);
    expect(metrics.areaWidth ?? 0).toBeGreaterThan(0);

    // 上传入口在窄屏仍可见可点
    const opener = page.locator(`${AREA} button`).first();
    await expect(opener).toBeVisible();
  });

  test('真实图片落下后进入上传通道（访客态停在「请先登录」）', async ({ page }) => {
    await openUploadPage(page);

    await dispatchWithFile(page, 'drop', {
      name: 'probe.png',
      type: 'image/png',
      body: 'not-a-real-image',
    });

    // 访客态：文件已过格式校验、进入上传流程，被鉴权挡下 —— 说明拖拽到上传的链路通了。
    // 已登录态会先出现上传中遮罩，再落库；那条路径见文件末尾的 skip。
    await expect(page.getByText(/请先登录|上传中|上传失败/).first()).toBeVisible({
      timeout: 15000,
    });
  });

  test.skip('素材库回填：需要登录态 + 后端素材数据', () => {
    // 跳过原因：素材库弹窗需要有效会话与后端 /assets 数据；
    // 本机跑会写入共享开发库，且 CI 无固定素材，故不在运行时回归里覆盖。
  });

  test.skip('手机扫码回传：需要真实移动设备完成一次上传', () => {
    // 跳过原因：需要手机扫码并在移动端上传成功后服务端回传，
    // 无法在桌面 Chromium 里稳定复现。
  });
});
