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
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      // Словарь Hunspell для проверки орфографии лежит в пакете dictionary-ru
      // и подключается как статический ассет (`?url`), поэтому путь к файлам
      // словаря разворачиваем вручную — пакет не публикует их в exports.
      {
        find: /^dictionary-ru\/(index\.(?:aff|dic))(\?.*)?$/,
        replacement: path.resolve(__dirname, 'node_modules/dictionary-ru') + '/$1$2',
      },
    ],
  },
  // Добавляем только это:
  optimizeDeps: {
    exclude: ['pdfjs-dist'],
  },
});
