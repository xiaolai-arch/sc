import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  server: { fs: { allow: ['..'] } },
  build: { outDir: '../out/web', emptyOutDir: true }
});
