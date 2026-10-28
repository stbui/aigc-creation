import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * 左侧菜单复原回归。
 *
 * 参考站 2026-10-28 实测：176px 横排 / ≤1366px 100px 竖轨；分组全部默认展开，
 * 底部固定产品建议与联系客服。本地额外保留图生视频与数据看板两个真实入口。
 */

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';
const API = process.env.E2E_API ?? 'http://localhost:4100';
const GUEST_PROMO_DISMISS_KEY = 'ecom-guest-promo-dismissed-v1';

async function skipGuestPromo(page: Page) {
  await page.addInitScript(
    ([key]) => localStorage.setItem(key as string, '1'),
    [GUEST_PROMO_DISMISS_KEY],
  );
}

async function registerUser(request: APIRequestContext) {
  const email = `sidebar-e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@local.dev`;
  const res = await request.post(`${API}/api/v1/auth/register`, {
    data: { email, password: 'E2e@123456', name: '侧栏回归' },
  });
  expect(res.ok(), `注册测试账号失败: ${res.status()} ${await res.text()}`).toBeTruthy();
  return { email, token: (await res.json()).data.accessToken as string };
}

test.describe('左侧菜单复原', () => {
  test('1440 横排：几何、顺序、本地图标与底部入口与参考站一致', async ({ page }) => {
    await skipGuestPromo(page);
    await page.setViewportSize({ width: 1440, height: 1000 });

    const foreignRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('ijihua.cn')) foreignRequests.push(request.url());
    });

    await page.goto(`${UI}/workbench`, { waitUntil: 'networkidle' });
    const aside = page.locator('.app-sider-wrap .workspace-side-menu-v2');
    await expect(aside).toBeVisible();

    const box = await aside.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width).toBe(176);
    expect(box?.height).toBe(896);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(1000);

    const sections = page.locator('.app-sider-wrap .workspace-side-menu-sections');
    await expect(sections).toHaveCSS('padding-top', '8px');
    await expect(sections).toHaveCSS('row-gap', '16px');
    await expect(sections).toHaveCSS('width', '139px');

    const firstItem = page.locator('.app-sider-wrap .workspace-side-menu-btn').first();
    await expect(firstItem).toHaveCSS('width', '133px');
    await expect(firstItem).toHaveCSS('height', '45px');
    await expect(firstItem.locator('.side-menu-label')).toHaveCSS('font-size', '13px');
    await expect(firstItem).toHaveAttribute('aria-current', 'page');

    expect(
      await page.locator('.app-sider-wrap .workspace-menu-section-label').allTextContents(),
    ).toEqual(['AI视频', '电商生图', 'AI修图', '数据中心']);
    expect(
      await page.locator('.app-sider-wrap .workspace-side-menu-btn .side-menu-label').allTextContents(),
    ).toEqual([
      '工作台',
      '我的作品',
      '自由创作',
      '图生视频',
      '商品主图',
      '商品详情',
      '爆款复刻',
      '创意生图',
      '多图融合',
      '商品SKU图',
      '局部重绘',
      '一键抠图',
      '去除水印',
      '产品精修',
      '图片翻译',
      '智能扩图',
      '商品换色',
      '旋转角度',
      '数据看板',
      '素材库',
    ]);

    const iconSources = await page
      .locator('.app-sider-wrap .workspace-menu-icon img')
      .evaluateAll((images) => images.map((image) => image.getAttribute('src')));
    expect(iconSources.length).toBeGreaterThanOrEqual(19);
    expect(iconSources.every((src) => src?.startsWith('/menu/'))).toBe(true);

    const suggestion = page.locator('.app-sider-wrap .product-suggestion-sidebar-launcher');
    const service = page.locator('.app-sider-wrap .workspace-customer-service-trigger');
    await expect(suggestion).toContainText('产品建议');
    await expect(suggestion).toHaveAttribute(
      'href',
      '/tickets?type=other&compose=1&subject=%E4%BA%A7%E5%93%81%E5%BB%BA%E8%AE%AE',
    );
    await expect(service).toContainText('联系客服');
    await expect(service).toHaveAttribute('href', '/tickets?type=consultation&compose=1');
    await expect(service).toBeInViewport();

    await page.locator('.app-sider-wrap').getByRole('link', { name: '商品主图' }).hover();
    const preview = page.locator('.rail-preview');
    await expect(preview).toBeVisible();
    const previewBox = await preview.boundingBox();
    expect(previewBox?.width).toBe(376);
    expect(previewBox?.height).toBe(236);
    await expect(preview.locator('.rail-preview-desc')).toHaveCSS('line-height', '22px');
    await expect(preview.locator('.rail-preview-img')).toHaveAttribute(
      'src',
      '/workbench/spzt.webp',
    );
    const imageBox = await preview.locator('.rail-preview-img').boundingBox();
    expect(imageBox?.width).toBe(344);
    expect(imageBox?.height).toBe(172);

    expect(foreignRequests, '侧栏资源必须本地化，不得请求参考站').toEqual([]);
  });

  test('1280 竖轨：100px 轨迹、77×60 条目、10px 标签且无横向溢出', async ({ page }) => {
    await skipGuestPromo(page);
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto(`${UI}/workbench`, { waitUntil: 'networkidle' });

    const aside = page.locator('.app-sider-wrap .workspace-side-menu-v2');
    await expect(aside).toHaveCSS('width', '100px');
    await expect(aside).toHaveCSS('padding', '8px 8px 20px');

    const item = page.locator('.app-sider-wrap .workspace-side-menu-btn').first();
    await expect(item).toHaveCSS('width', '77px');
    await expect(item).toHaveCSS('height', '60px');
    await expect(item).toHaveCSS('flex-direction', 'column');
    await expect(item.locator('.side-menu-label')).toHaveCSS('font-size', '10px');
    await expect(item.locator('.side-menu-label')).toHaveCSS('line-height', '14px');

    const toggle = page.locator('.app-sider-wrap .workspace-menu-section-toggle').first();
    await expect(toggle).toHaveCSS('width', '77px');
    await expect(toggle).toHaveCSS('height', '24px');
    await expect(toggle).toHaveCSS('font-size', '12px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
      false,
    );
  });

  test('断点精确落在 1366 / 1367', async ({ page }) => {
    await skipGuestPromo(page);
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto(`${UI}/workbench`, { waitUntil: 'networkidle' });
    await expect(page.locator('.app-sider-wrap .workspace-side-menu-v2')).toHaveCSS(
      'width',
      '100px',
    );

    await page.setViewportSize({ width: 1367, height: 900 });
    await expect(page.locator('.app-sider-wrap .workspace-side-menu-v2')).toHaveCSS(
      'width',
      '176px',
    );
  });

  test('分组可折叠并恢复，aria-controls 指向唯一面板', async ({ page }) => {
    await skipGuestPromo(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${UI}/workbench`, { waitUntil: 'networkidle' });

    const toggle = page.locator('.app-sider-wrap').getByRole('button', { name: 'AI修图' });
    const section = toggle.locator('xpath=..');
    const panelId = await toggle.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    await expect(section.locator('.workspace-side-menu-list')).toHaveCount(1);
    await expect(page.locator(`[id="${panelId}"]`)).toHaveCount(1);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(section.locator('.workspace-side-menu-list')).toHaveCount(0);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(section.locator('.workspace-side-menu-btn')).toHaveCount(8);
  });

  test('底部入口进入真实工单表单，并预填产品建议 / 咨询类型', async ({ page, request }) => {
    const { token, email } = await registerUser(request);
    await page.goto(`${UI}/workbench`);
    await page.evaluate(
      ([value, userEmail]) => {
        localStorage.setItem('ecom_vision_token', value as string);
        localStorage.setItem('ecom_vision_email', userEmail as string);
      },
      [token, email],
    );
    await page.reload({ waitUntil: 'networkidle' });

    await page.locator('.app-sider-wrap .product-suggestion-sidebar-launcher').click();
    await expect(page).toHaveURL(/\/tickets$/);
    await expect(page.locator('.ticket-compose')).toBeVisible();
    await expect(page.getByLabel('标题')).toHaveValue('产品建议');
    await expect(page.getByRole('combobox', { name: /问题类型.*其他/ })).toBeVisible();

    await page.locator('.app-sider-wrap .workspace-customer-service-trigger').click();
    await expect(page.getByRole('combobox', { name: /问题类型.*咨询/ })).toBeVisible();
  });

  test('390 移动抽屉保留完整分组与真实入口，无横向溢出', async ({ page }) => {
    await skipGuestPromo(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${UI}/workbench`, { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: '打开导航菜单' }).click();
    const drawer = page.locator('.app-mobile-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('.workspace-menu-section-toggle')).toHaveCount(4);
    await expect(drawer.locator('.workspace-side-menu-btn')).toHaveCount(20);
    await expect(drawer.getByText('AI视频', { exact: true })).toBeVisible();
    await expect(drawer.getByText('图生视频', { exact: true })).toBeVisible();
    await expect(drawer.getByText('产品建议', { exact: true })).toBeAttached();
    await expect(drawer.getByText('联系客服', { exact: true })).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
      false,
    );
  });
});
