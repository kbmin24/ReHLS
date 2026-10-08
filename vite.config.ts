import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  plugins: [vue(), tailwindcss()],
  build: { outDir: '../dist/client', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:3000' },
  },
});
