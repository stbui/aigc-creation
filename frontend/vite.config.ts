import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

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
    plugins: [react()],
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
      // vendor-antd ≈1.1MB (gzip ~360KB) 是 antd 6 主题引擎的固有体积, 故阈值放宽到 1200。
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
            if (/[\\/]node_modules[\\/](antd|@ant-design|rc-|@rc-component)/.test(id)) {
              return 'vendor-antd';
            }
            if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) {
              return 'vendor-icons';
            }
            return 'vendor';
          },
        },
      },
    },
  };
});