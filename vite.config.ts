import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const port = process.env.PORT ?? loadEnv(mode, process.cwd(), 'PORT').PORT ?? '3000';

  return {
    root: 'client',
    plugins: [vue(), tailwindcss()],
    build: { outDir: '../dist/client', emptyOutDir: true },
    server: {
      host: '127.0.0.1',
      proxy: { '/api': `http://127.0.0.1:${port}` },
    },
  };
});
