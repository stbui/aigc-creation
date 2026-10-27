import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Vitest 配置 —— 前端单元 / 组件测试（L1.5）。
 *
 * 与 `vite.config.ts` 分开，避免把测试专用的环境、覆盖率、隔离策略带进
 * 生产构建链。测试不读 `.env.{mode}`，也不起服务：纯逻辑、hooks 与组件
 * 一律在 jsdom 里跑；需要真实 HTTP / 浏览器的场景仍归 `backend/scripts/*`
 * 与 Playwright（frontend/tests）。
 *
 * 命名约定：`src` 目录下的 `*.test.ts` / `*.test.tsx`。Playwright 只认
 * `tests/*.spec.ts`，两边不会互相收集。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // 显式排除 e2e 目录：Playwright 用例依赖真实浏览器与服务，不能进 jsdom。
    exclude: ['node_modules', 'dist', 'tests', 'e2e'],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/vite-env.d.ts',
        'src/types/**',
        'src/main.tsx',
      ],
    },
  },
});
