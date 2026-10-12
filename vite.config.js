import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// CloudBase 静态托管 SPA 配置：把所有路径回退到 index.html
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    base: env.VITE_PUBLIC_BASE || './',
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      sourcemap: false,
    },
    server: {
      port: 5173,
      open: true,
    },
  };
});