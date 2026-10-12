import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

const videoJsElements = new Set(['live-video-player', 'live-video-neutral-skin', 'hlsjs-video']);

export default defineConfig(({ mode }) => {
  const port = process.env.PORT ?? loadEnv(mode, process.cwd(), 'PORT').PORT ?? '3000';

  return {
    root: 'client',
    plugins: [
      tailwindcss(),
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => videoJsElements.has(tag),
          },
        },
      })
    ],
    build: { outDir: '../dist/client', emptyOutDir: true },
    server: {
      host: '127.0.0.1',
      proxy: { '/api': `http://127.0.0.1:${port}` },
    },
  };
});
