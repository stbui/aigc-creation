import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 默认端口 5173、代理目标 3001；与本机其他项目冲突时用环境变量换端口:
//   VITE_PORT=5174 VITE_API_PROXY=http://localhost:3002 VITE_API_BASE=http://localhost:3002 npm run dev
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    // 首屏体积优化: 框架/组件库/图标拆成稳定 chunk, 业务页面各自按路由懒加载。
    // 版本不变的 vendor chunk 可长期缓存, 业务改动不再让用户重下依赖。
    // vendor-antd ≈1.1MB (gzip ~360KB) 是 antd 6 主题引擎的固有体积, 故阈值放宽到 1200。
    chunkSizeWarningLimit: 1200,
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
});
