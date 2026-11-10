import { fileURLToPath } from 'node:url';
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
  /*
   * 必须与 `vite.config.ts` 的别名保持一致：`~` 是 shadcn 基座的别名
   * （`~/components/ui/...`），测试与构建必须解析到同一个目录。
   */
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    /*
     * 默认 forks 会为每个测试文件新建一次 jsdom；本仓 64 个前端测试文件
     * 会把大量时间耗在环境初始化上。vmThreads 仍保持默认的文件级隔离，
     * 但可在线程内复用 jsdom，实测全量用例从约 42s 降到约 10s。
     */
    pool: 'vmThreads',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // 显式排除 e2e 目录：Playwright 用例依赖真实浏览器与服务，不能进 jsdom。
    exclude: ['node_modules', 'dist', 'tests', 'e2e'],
    clearMocks: true,
    restoreMocks: true,
    /*
     * 全仓 23 个「具名导入对账」测试是同步 IO 密集型（递归 readFileSync/statSync）。
     * vmThreads 的文件级并行会让它们互相阻塞：实测并发时单测 7~38.8s、全量约 275s
     * 且 23 个撞 10s 超时；串行时单测约 1.6s、该批 60s 全通过。同一用例单跑仅
     * 97ms，说明超时是调度争抢而非契约失败 —— 关掉文件级并行，不放宽 testTimeout
     * 去掩盖问题。其余 83 个多为纯逻辑测试，串行开销可忽略。
     */
    fileParallelism: false,
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
