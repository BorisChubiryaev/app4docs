// vite.config.ts

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: process.env.PORT
    ? { port: Number(process.env.PORT), strictPort: true }
    : undefined,
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    // Шрифты встраиваем в CSS: статический сервер Qlik Sense отвечает
    // HTTP 415 на .woff2, отдельными файлами они не загружаются.
    assetsInlineLimit: (filePath) =>
      filePath.endsWith('.woff2') ? true : undefined,
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Добавляем только это:
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
});
