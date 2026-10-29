import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { HAS_ADMIN_CREDENTIALS } from './tests/support/admin-credentials';

/**
 * 后台 E2E 专用配置。
 *
 * 用 executablePath 指向本机已安装的 Chromium —— `npx playwright install`
 * 在本机被 broker 拦截 (safe-delete 拒绝删除 __dirlock), 而缓存里的
 * chromium-1134 与 playwright 1.64.1 期望的 1248 版本号不一致,
 * 故显式指定可执行文件绕过版本校验。
 */
const LOCAL_CHROMIUM_PATH =
  '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ??
  (existsSync(LOCAL_CHROMIUM_PATH) ? LOCAL_CHROMIUM_PATH : undefined);

const ADMIN_AUTH_FILE = 'playwright/.auth/admin.json';
const HAS_ADMIN_PASSWORD = HAS_ADMIN_CREDENTIALS;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 60000,
  use: {
    baseURL: process.env.ADMIN_UI ?? 'http://localhost:5100',
    trace: 'off',
    ...(CHROMIUM_PATH ? { launchOptions: { executablePath: CHROMIUM_PATH } } : {}),
  },
  projects: [
    // 登录态只建立一次；见 tests/admin-auth.setup.ts 的限流说明。
    ...(HAS_ADMIN_PASSWORD
      ? [{ name: 'admin-auth', testMatch: /admin-auth\.setup\.ts/ }]
      : []),
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...(HAS_ADMIN_PASSWORD ? { storageState: ADMIN_AUTH_FILE } : {}),
      },
      dependencies: HAS_ADMIN_PASSWORD ? ['admin-auth'] : [],
    },
  ],
});
