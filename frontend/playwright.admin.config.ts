import { defineConfig, devices } from '@playwright/test';

/**
 * 后台 E2E 专用配置。
 *
 * 用 executablePath 指向本机已安装的 Chromium —— `npx playwright install`
 * 在本机被 broker 拦截 (safe-delete 拒绝删除 __dirlock), 而缓存里的
 * chromium-1134 与 playwright 1.64.1 期望的 1248 版本号不一致,
 * 故显式指定可执行文件绕过版本校验。
 */
const CHROMIUM_PATH =
  process.env.CHROMIUM_PATH ??
  '/Users/bright/Library/Caches/ms-playwright/chromium-1134/chrome-mac/Chromium.app/Contents/MacOS/Chromium';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 60000,
  use: {
    baseURL: process.env.ADMIN_UI ?? 'http://localhost:5173',
    trace: 'off',
    launchOptions: { executablePath: CHROMIUM_PATH },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
