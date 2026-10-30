import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * 工作台 / 我的作品 / 素材库复原回归。
 *
 * 这一组用例守的是三页的**公开入口与游客语义**：
 *   - 工作台固定 12 卡，顺序与参考站一致，游客不请求统计接口；
 *   - 我的作品游客直接看到筛选器与空态，不出现登录墙；
 *   - 素材库 `/asset-library` 与 `/library` 都能直达，游客不请求私有素材接口；
 *   - 390 下三页无横向溢出。
 *
 * 断言基于 DOM 语义与网络请求，不做截图比对，避免字体/抗锯齿差异造成误报。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';
const API = process.env.E2E_API ?? 'http://localhost:4100';

const WORKBENCH_TITLES = [
  '商品主图',
  '商品详情图',
  '爆款复刻',
  '创意生图',
  '局部重绘',
  '智能扩图',
  '一键抠图',
  '去除水印',
  '图片翻译',
  '产品精修',
  '商品换色',
  '旋转角度',
];

const GUEST_PROMO_DISMISS_KEY = 'ecom-guest-promo-dismissed-v1';

function trackApi(page: Page, path: string) {
  let count = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === path) count += 1;
  });
  return () => count;
}

/** 让非营销弹层用例跳过游客福利，避免遮罩挡住后续点击。 */
async function skipGuestPromo(page: Page) {
  await page.addInitScript(
    ([key]) => localStorage.setItem(key as string, '1'),
    [GUEST_PROMO_DISMISS_KEY],
  );
}

async function mockPopup(
  page: Page,
  campaign: null | {
    title: string;
    body: string;
    ctaText: string;
    ctaUrl: string;
    durationMs: number;
  },
) {
  const serverNow = Date.now();
  await page.route('**/api/v1/marketing/popup', async (route) => {
    const data = campaign
      ? {
          id: 'e2e-popup',
          title: campaign.title,
          body: campaign.body,
          ctaText: campaign.ctaText,
          ctaUrl: campaign.ctaUrl,
          startAt: new Date(serverNow - 60_000).toISOString(),
          endAt: new Date(serverNow + campaign.durationMs).toISOString(),
          serverNow: new Date(serverNow).toISOString(),
        }
      : null;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ code: 0, data, message: '' }),
    });
  });
}

async function gotoAsAuthed(page: Page, path: string, token: string, email: string) {
  await page.goto(`${UI}${path}`);
  await page.evaluate(
    ([t, e]) => {
      localStorage.setItem('ecom_vision_token', t as string);
      localStorage.setItem('ecom_vision_email', e as string);
    },
    [token, email],
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
}

async function registerUser(request: APIRequestContext) {
  const email = `workspace-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@local.dev`;
  const res = await request.post(`${API}/api/v1/auth/register`, {
    data: { email, password: 'E2e@123456', name: '工作台回归' },
  });
  expect(res.ok(), `注册测试账号失败: ${res.status()} ${await res.text()}`).toBeTruthy();
  return { email, token: (await res.json()).data.accessToken as string };
}

test.describe('工作台复原', () => {
  test('游客态固定 12 卡、顺序正确、不请求统计接口，卡片可进入工具页', async ({ page }) => {
    await skipGuestPromo(page);
    const statsRequests = trackApi(page, '/api/v1/stats/overview');
    await page.goto(`${UI}/workbench`);

    const cards = page.locator('.wb-tool-card');
    await expect(cards).toHaveCount(12);
    const titles = await page.locator('.wb-tool-title strong').allTextContents();
    expect(titles).toEqual(WORKBENCH_TITLES);
    await expect(page.locator('.wb-login-prompt')).toHaveCount(3);
    await expect(page.locator('.wb-login-prompt button').first()).toContainText('登录查看');

    await page.waitForTimeout(500);
    expect(statsRequests(), '游客不得请求私有统计接口').toBe(0);

    await cards.first().click();
    await expect(page).toHaveURL(/\/product-kit$/);
  });

  test('登录态加载真实账号面板与 6 格数据看板', async ({ page, request }) => {
    const { token, email } = await registerUser(request);
    await gotoAsAuthed(page, '/workbench', token, email);

    await expect(page.locator('.wb-login-prompt')).toHaveCount(0);
    await expect(page.locator('.wb-account-metrics')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.wb-dashboard-stats > div')).toHaveCount(6);
  });
});

test.describe('我的作品复原', () => {
  test('游客态直接显示筛选器与空态，不请求任务接口', async ({ page }) => {
    await skipGuestPromo(page);
    const taskRequests = trackApi(page, '/api/v1/tasks');
    await page.goto(`${UI}/works`);

    await expect(page.locator('.my-works-intro h1')).toHaveText('我的作品');
    await expect(page.locator('.my-works-toolbar')).toBeVisible();
    await expect(page.locator('.my-works-filter-trigger')).toHaveCount(4);
    await expect(page.locator('.my-works-empty')).toBeVisible();
    await expect(page.locator('.my-works-empty svg')).toHaveCount(1);
    await expect(page.locator('.my-works-empty h2')).toHaveText('还没有作品');

    await page.waitForTimeout(500);
    expect(taskRequests(), '游客不得请求私有作品接口').toBe(0);

    await page.getByRole('tab', { name: '视频作品' }).click();
    await expect(page.locator('.my-works-empty h2')).toHaveText('还没有视频作品');

    await page.locator('.my-works-filter-trigger').first().click();
    await expect(page.locator('.my-works-business-popover')).toBeVisible();
  });

  test('登录态空账号显示真实空态，不出现 401 文案', async ({ page, request }) => {
    const { token, email } = await registerUser(request);
    await gotoAsAuthed(page, '/works', token, email);

    await expect(page.locator('.my-works-empty')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('作品列表加载失败')).toHaveCount(0);
  });
});

test.describe('素材库复原', () => {
  for (const path of ['/asset-library', '/library'] as const) {
    test(`游客态 ${path} 直达、显示官方空态、隐藏私有操作区`, async ({ page }) => {
      await skipGuestPromo(page);
      const assetRequests = trackApi(page, '/api/v1/assets');
      await page.goto(`${UI}${path}`);

      await expect(page.locator('.asset-library-title')).toHaveText('素材库');
      await expect(page.locator('.asset-library-state-empty')).toBeVisible();
      await expect(page.locator('.asset-library-state-empty img')).toHaveAttribute(
        'src',
        '/asset-library/empty.svg',
      );
      await expect(page.locator('.asset-library-header-actions')).toHaveCount(0);
      await expect(page.locator('.asset-library-groups-panel')).toHaveCount(0);
      await expect(
        page.locator('.workspace-side-menu-btn.active').filter({ hasText: '素材库' }),
      ).toHaveCount(1);

      await page.waitForTimeout(500);
      expect(assetRequests(), '游客不得请求私有素材接口').toBe(0);
    });
  }
});

test.describe('三页移动端复原', () => {
  test('390 下无横向溢出，工作台 2 列，页面间距与参考站一致', async ({ page }) => {
    await skipGuestPromo(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const routes = [
      ['/workbench', '.workbench-content'],
      ['/works', '.my-works-page'],
      ['/library', '.asset-library-page'],
    ] as const;

    for (const [path, ready] of routes) {
      await page.goto(`${UI}${path}`);
      await expect(page.locator(ready)).toBeVisible({ timeout: 10000 });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow, `${path} 不应出现横向溢出`).toBe(false);
    }

    await page.goto(`${UI}/workbench`);
    await expect(page.locator('.wb-tool-card')).toHaveCount(12);
    const columns = await page.locator('.wb-tool-grid').evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns.split(' ').length,
    );
    expect(columns).toBe(2);

    // 参考站 390：数据面板 252 高（220 登录引导 + 上下各 16 padding），不再沿用桌面 min-height 268。
    const panelHeights = await page.locator('.wb-panel.wb-account, .wb-panel.wb-recent, .wb-panel.wb-dashboard').evaluateAll(
      (elements) => elements.map((element) => element.getBoundingClientRect().height),
    );
    expect(panelHeights).toEqual([252, 252, 252]);

    await page.goto(`${UI}/works`);
    await expect(page.locator('.my-works-page')).toBeVisible({ timeout: 10000 });
    const worksLayout = await page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return { x: box.x, width: box.width, height: box.height };
      };
      return {
        page: rect('.my-works-page'),
        title: rect('.my-works-intro h1'),
        toolbar: rect('.my-works-toolbar'),
        trigger: rect('.my-works-filter-trigger'),
        download: rect('.my-works-download'),
      };
    });
    expect(worksLayout.page?.height).toBe(780);
    expect(worksLayout.title?.x).toBe(16);
    expect(worksLayout.title?.height).toBe(35);
    expect(worksLayout.toolbar?.width).toBe(358);
    expect(worksLayout.trigger?.width).toBe(159);
    expect(worksLayout.download?.width).toBe(328);
  });
});

test.describe('游客新人福利弹层', () => {
  test('复制参考站 500×427 构图，展示 DB 活动倒计时与真实权益', async ({ page }) => {
    await mockPopup(page, {
      title: '新人首单立减',
      body: '限时活动, 数量有限',
      ctaText: '去使用',
      ctaUrl: '/packages',
      durationMs: 2 * 60 * 60 * 1000,
    });
    await page.goto(`${UI}/workbench`);

    const overlay = page.locator('.guest-promo-overlay');
    await expect(overlay).toBeVisible({ timeout: 9000 });
    await expect(page.locator('.guest-promo-title')).toHaveText('新人首单立减');
    await expect(page.locator('.guest-promo-countdown')).toContainText('后活动结束');
    await expect(page.locator('.guest-promo-countdown span')).toHaveCount(3);
    await expect(page.locator('.guest-promo-benefits li')).toHaveText([
      '一键抠图免费',
      '一键去水印免费',
      '作品云端保存',
      '素材统一管理',
    ]);
    await expect(page.locator('.guest-promo-claim')).toHaveText('去使用');

    const bodyText = await page.locator('.guest-promo-dialog').innerText();
    expect(bodyText).not.toContain('100积分');
    expect(bodyText).not.toContain('送50次');
    expect(bodyText).not.toContain('立即领取');

    await page.waitForTimeout(300);
    const box = await page.locator('.guest-promo-dialog').boundingBox();
    expect(box?.width).toBeCloseTo(500, 0);
    expect(box?.height).toBeCloseTo(427, 0);
  });

  test('关闭后持久化，刷新不再出现', async ({ page }) => {
    await mockPopup(page, null);
    await page.goto(`${UI}/workbench`);

    const overlay = page.locator('.guest-promo-overlay');
    await expect(overlay).toBeVisible({ timeout: 9000 });
    await page.getByRole('button', { name: '关闭新人福利' }).click();
    await expect(overlay).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), GUEST_PROMO_DISMISS_KEY)).toBe(
      '1',
    );

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);
    await expect(page.locator('.guest-promo-overlay')).toHaveCount(0);
  });

  test('登录用户不出现游客福利', async ({ page, request }) => {
    const { token, email } = await registerUser(request);
    await gotoAsAuthed(page, '/workbench', token, email);
    await page.waitForTimeout(1600);
    await expect(page.locator('.guest-promo-overlay')).toHaveCount(0);
  });

  test('无 DB 活动时使用真实免费能力入口，390 不溢出', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockPopup(page, null);
    await page.goto(`${UI}/workbench`);

    const overlay = page.locator('.guest-promo-overlay');
    await expect(overlay).toBeVisible({ timeout: 9000 });
    await expect(page.locator('.guest-promo-title')).toHaveText('新用户创作礼');
    await expect(page.locator('.guest-promo-countdown')).toHaveCount(0);
    await expect(page.locator('.guest-promo-note')).toHaveText('真实权益 · 登录即用');
    await expect(page.locator('.guest-promo-claim')).toHaveText('免费体验');

    const layout = await page.evaluate(() => {
      const close = document.querySelector('.guest-promo-close')?.getBoundingClientRect();
      const dialog = document.querySelector('.guest-promo-dialog')?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        dialogLeft: dialog?.left,
        dialogRight: dialog?.right,
        closeTop: close?.top,
        closeRight: close?.right,
      };
    });
    expect(layout.overflow).toBe(false);
    expect(layout.dialogLeft).toBeGreaterThanOrEqual(0);
    expect(layout.dialogRight).toBeLessThanOrEqual(390);
    expect(layout.closeTop).toBeGreaterThanOrEqual(0);
    expect(layout.closeRight).toBeLessThanOrEqual(390);

    await page.locator('.guest-promo-claim').click();
    await expect(page).toHaveURL(/\/background-remove$/);
    await expect(page.locator('.guest-promo-overlay')).toHaveCount(0);
  });

  test('用户开始操作后不自动打断当前任务', async ({ page }) => {
    await mockPopup(page, {
      title: '新人首单立减',
      body: '限时活动',
      ctaText: '去使用',
      ctaUrl: '/packages',
      durationMs: 60 * 60 * 1000,
    });
    await page.goto(`${UI}/workbench`);
    await page.locator('.wb-tool-card').first().waitFor();

    // 键盘/指针/滚轮任一真实操作都应取消本次自动弹出，促销条仍保留入口。
    await page.keyboard.press('Tab');
    await page.waitForTimeout(6500);
    await expect(page.locator('.guest-promo-overlay')).toHaveCount(0);
  });
});
