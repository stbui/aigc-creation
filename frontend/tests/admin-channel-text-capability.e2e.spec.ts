import { test, expect, type APIRequestContext } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, HAS_ADMIN_CREDENTIALS } from './support/admin-credentials';
import { ensureAdminLogin } from './support/admin-login';

const UI = process.env.ADMIN_UI ?? 'http://localhost:5100';
const API = process.env.E2E_API ?? 'http://localhost:4100';

async function adminToken(request: APIRequestContext) {
  const response = await request.post(`${API}/api/v1/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(response.ok(), `admin login ${response.status()}`).toBeTruthy();
  return (await response.json()).data.accessToken as string;
}

test.describe('渠道文本模型保存', () => {
  test.skip(!HAS_ADMIN_CREDENTIALS, '未提供后台管理员凭据');

  test('选择文本能力后可保存完整的文本能力合同', async ({ page, request }) => {
    const stamp = Date.now();
    const channelName = `验收渠道-文本保存-${stamp}`;
    const modelKey = `e2e-text-save-${stamp}`;
    const token = await adminToken(request);
    const auth = { Authorization: `Bearer ${token}` };
    let channelId = '';

    try {
      const channelResponse = await request.post(`${API}/api/v1/admin/channels`, {
        headers: auth,
        data: {
          name: channelName,
          baseUrl: 'http://127.0.0.1:3900',
          apiKey: 'mock-token',
          concurrencyLimit: 1,
        },
      });
      expect(channelResponse.ok(), await channelResponse.text()).toBeTruthy();
      channelId = (await channelResponse.json()).data.id as string;

      await page.setViewportSize({ width: 1600, height: 1000 });
      await ensureAdminLogin(page);
      await page.goto(`${UI}/admin/channels?id=${channelId}`);

      const detail = page.locator('#admin-channel-detail');
      await expect(detail).toContainText(channelName, { timeout: 20000 });
      await detail.getByRole('button', { name: '新建商品', exact: true }).click();

      const modal = page.getByTestId('admin-modal');
      await expect(modal).toBeVisible();
      await modal.getByLabel('商品编号').fill(modelKey);
      await modal.getByLabel('展示名称').fill('E2E 文本模型');

      await modal.getByLabel('模型类型').click();
      await page.getByRole('option', { name: '文本', exact: true }).click();

      await modal.getByLabel('接入方式').click();
      await page.getByRole('option', { name: /^OpenAI Chat Completions/ }).click();

      await expect(modal.getByLabel('能力配置')).toHaveValue(/"contextWindowTokens": 128000/);

      const saveResponse = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith(`/admin/channels/${channelId}/models`),
        { timeout: 15000 },
      );
      await modal.getByRole('button', { name: '保存商品', exact: true }).click();

      const response = await saveResponse;
      const body = await response.text();
      expect(response.status(), body).toBe(201);
      expect(JSON.parse(body).data.capabilityConfig).toMatchObject({
        version: 1,
        text: {
          contextWindowTokens: 128000,
          maxOutputTokens: 16384,
          references: { promptMaxChars: 4000, maxImages: 4 },
        },
      });
      await expect(modal).toBeHidden({ timeout: 15000 });
    } finally {
      if (channelId) {
        await request.delete(`${API}/api/v1/admin/channels/${channelId}`, { headers: auth });
      }
    }
  });
});
