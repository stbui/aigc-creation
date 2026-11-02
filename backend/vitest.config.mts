import { defineConfig } from 'vitest/config';

/**
 * 后端单元测试配置。
 *
 * 与前端 Vitest 分开：后端纯 Node 环境，不加载 jsdom，也不启动 Nest。
 * 需要真实数据库/HTTP 的场景仍然走 `scripts/verify-*` 与 `smoke-*`；
 * 这里只跑 service 逻辑与纯函数，保证每次提交快速反馈。
 *
 * 命名约定：`src` 目录下的 `*.spec.ts`（与 docs/testing.md 的「spec」口径一致）。
 * 组件名/文件名用 `.spec.ts`，避免与前端 `.test.ts(x)` 混淆。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    exclude: ['node_modules', 'dist'],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 10_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/**/*.d.ts'],
    },
  },
});
