import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vite 配置 —— 三环境由 `--mode` 驱动。
 *
 * mode 与 env 文件的绑定（Vite 内建行为，无需额外配置）：
 *   --mode development → .env.development.local > .env.development > .env
 *   --mode test        → .env.test.local        > .env.test
 *   --mode production  → .env.production.local  > .env.production
 *
 * 注意 Vite 的优先级方向与后端相反：Vite 是**靠后覆盖靠前**，后端 env-files.ts
 * 是**靠前优先**。两套规则各自内部一致即可，跨端不要互相推断。
 *
 * 各档位的端口与代理目标从 env 文件读，命令行可用同名变量覆盖：
 *   VITE_PORT=5101 VITE_API_PROXY=http://localhost:4101 npx vite --mode development
 */
export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  /*
   * 端口与代理目标必须从**当前 mode 的 env 文件**读。
   *
   * Vite 只把 env 文件里的变量注入客户端 (import.meta.env), 不会写进
   * process.env —— 直接读 process.env.VITE_PORT 永远拿不到 `.env.test` 里的值,
   * 于是 `npm run dev:test` 会静默跑在 5100、代理到开发库的 4100:
   * 症状是「测试档登录不上」，而没有任何一处报错。
   *
   * 优先级: 命令行显式给的同名变量 > env 文件 > 兜底默认值。
   */
  const fileEnv = loadEnv(mode, process.cwd(), 'VITE_');
  const port = Number(process.env.VITE_PORT || fileEnv.VITE_PORT || 5100);
  const apiProxy = process.env.VITE_API_PROXY || fileEnv.VITE_API_PROXY || 'http://localhost:4100';

  return {
    plugins: [react(), tailwindcss()],
    /*
     * `~` 是 `src` 的别名，供 shadcn 组件与后台代码使用（`components.json` 的
     * `aliases` 全指向 `~/...`）。C 端页面一律写相对路径，不依赖别名。
     */
    resolve: {
      alias: {
        '~': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiProxy,
          changeOrigin: true,
        },
        /**
         * ⚠️ **必须代理 /uploads** (2026-10-20 修)。
         *
         * 素材的 sourceUrl 是 `/uploads/<key>` 形态 (后端 main.ts 的静态服务直出)。
         * 开发态前端跑在 5100、后端在 4100, 不代理的话 Vite 会把 `/uploads/...`
         * 当成前端路由 → 返回 index.html (HTTP 200, 但 Content-Type 是 text/html)。
         *
         * 症状极隐蔽: **状态码是 200**, 看起来"请求成功", 但 <img> 拿到 HTML
         * 自然解码失败 → 图片位置显示 alt 文本与破图, 而网络面板全是 200。
         * 排查时容易误判成"素材没上传成功"或"路径拼错"。
         *
         * 生产由 Nginx 反代 /uploads (见 nginx.conf.template), 不受此影响。
         */
        '/uploads': {
          target: apiProxy,
          changeOrigin: true,
        },
      },
    },
    preview: {
      port,
      strictPort: true,
    },
    build: {
      // 首屏体积优化: 框架/组件库/图标拆成稳定 chunk, 业务页面各自按路由懒加载。
      // 版本不变的 vendor chunk 可长期缓存, 业务改动不再让用户重下依赖。
      // 迁移到 shadcn 后组件库体积显著下降, 阈值仍保留以约束业务 chunk 膨胀。
      chunkSizeWarningLimit: 1200,
      // 生产不产 sourcemap: 产物会公开到 CDN, 源码映射等于把源码送出去。
      // 非生产保留, 便于在浏览器里对照排查。
      sourcemap: isProd ? false : 'hidden',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
              return 'vendor-react';
            }
            if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) {
              return 'vendor-icons';
            }
            /*
             * 重库按「谁用」拆开, 不能一律塞进 vendor。
             *
             * vendor 会被入口静态依赖 (`ui/index.ts` 组合 shadcn 原子件),
             * 所以凡是掉进 vendor 的包 = 每个用户首屏都要下载。而下面这些
             * 库只在特定路由出现:
             *   recharts  → 仅后台概览图表 (`admin-ui/radar/chart.tsx`)
             *   stripe    → 仅结算页
             *   zod       → 仅后台渠道表单 schema
             *   date-fns  → 仅后台日期字段 / 日期选择器
             *   qrcode    → 仅邀请页与扫码登录
             * 拆出去后它们各自成为独立 chunk, 只随对应路由加载。
             *
             * recharts 的独占依赖一并归入 charts: 只被打包一次, 且不会
             * 因为散落在 vendor 而重新回到首屏。
             * `immer` / `reselect` / `use-sync-external-store` 看似是 recharts
             * 依赖, 但同时被 zustand / @base-ui 使用, 留在 vendor 避免重复。
             */
            if (
              /[\\/]node_modules[\\/](recharts|react-redux|@reduxjs[\\/]toolkit|redux|redux-thunk|victory-vendor|decimal\.js-light|es-toolkit|eventemitter3|tiny-invariant)[\\/]/.test(
                id,
              )
            ) {
              return 'vendor-charts';
            }
            if (/[\\/]node_modules[\\/]@stripe[\\/]/.test(id)) {
              return 'vendor-stripe';
            }
            if (/[\\/]node_modules[\\/](zod|@hookform[\\/]resolvers)[\\/]/.test(id)) {
              return 'vendor-validation';
            }
            if (/[\\/]node_modules[\\/](date-fns|react-day-picker)[\\/]/.test(id)) {
              return 'vendor-date';
            }
            if (/[\\/]node_modules[\\/]qrcode[\\/]/.test(id)) {
              return 'vendor-qrcode';
            }
            return 'vendor';
          },
        },
      },
    },
  };
});
