import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';
const API = process.env.E2E_API ?? 'http://localhost:4100';

async function signIn(page: Page, request: APIRequestContext) {
  const email = `e2e-account-${Date.now()}-${Math.floor(Math.random() * 1e6)}@local.dev`;
  const response = await request.post(`${API}/api/v1/auth/register`, {
    data: { email, password: 'E2e@123456', name: 'e2e-account' },
  });
  if (!response.ok()) {
    throw new Error(`注册测试账号失败 ${response.status()}: ${await response.text()}`);
  }

  const session = (await response.json()).data;
  await page.goto(`${UI}/workbench`);
  await page.evaluate(
    ([token, userEmail, role]) => {
      localStorage.setItem('huojue_token', token as string);
      localStorage.setItem('huojue_email', userEmail as string);
      localStorage.setItem('huojue_role', role as string);
    },
    [session.accessToken as string, session.user.email as string, session.user.role as string],
  );
  await page.reload({ waitUntil: 'networkidle' });
}

/**
 * 账户面板展开时的视觉稳定性。
 *
 * 这个面板较高，若沿用默认的缩放入场，第一帧会以 95% 尺寸出现，
 * 下一帧再放大到完整尺寸，用户会看到整块内容跳动。同时菜单不应
 * 因为打开而锁住页面滚动。
 */
test('账户面板展开时保持位置和尺寸稳定', async ({ page, request }) => {
  await signIn(page, request);
  await expect(page.locator('.app-user')).toBeVisible();

  await page.evaluate(() => {
    const target = window as unknown as {
      __accountMenuRects: Array<{ x: number; y: number; width: number; height: number }>;
    };
    target.__accountMenuRects = [];
    const startedAt = performance.now();
    const sample = () => {
      const menu = document.querySelector('.app-user-dropdown');
      if (menu) {
        const rect = menu.getBoundingClientRect();
        target.__accountMenuRects.push({
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        });
      }
      if (performance.now() - startedAt < 400) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });

  await page.locator('.app-user').click();
  await expect(page.locator('.app-user-dropdown')).toBeVisible();
  await page.waitForTimeout(450);

  const rects = await page.evaluate(
    () =>
      (
        window as unknown as {
          __accountMenuRects: Array<{ x: number; y: number; width: number; height: number }>;
        }
      ).__accountMenuRects,
  );
  expect(rects.length).toBeGreaterThan(1);
  const [first] = rects;
  for (const rect of rects) {
    expect(rect.x).toBeCloseTo(first.x, 1);
    expect(rect.y).toBeCloseTo(first.y, 1);
    expect(rect.width).toBeCloseTo(first.width, 1);
    expect(rect.height).toBeCloseTo(first.height, 1);
  }

  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe('visible');
});
