import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// SPA 配置：
//   - 前端路由回退由 nginx 处理（try_files）
//   - 本地开发时 /api 反向代理到服务器，方便直接联调线上后端
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    base: env.VITE_PUBLIC_BASE || '/',
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: false,
    },
    server: {
      port: 5173,
      open: true,
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://124.220.236.13',
          changeOrigin: true,
        },
      },
    },
  };
});
