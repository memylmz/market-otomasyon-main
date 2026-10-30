import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [
      // better-sqlite3 gibi yerel (native) modüller paket dışında bırakılır;
      // @market/shared ise ESM olduğu ve CJS ana süreçten require edilemeyeceği
      // için bilinçli olarak paketin içine gömülür.
      externalizeDepsPlugin({ exclude: ['@market/shared'] }),
    ],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@market/shared'] })],
    build: {
      rollupOptions: {
        // Müşteri ekranının preload'ı ayrıdır: kasa kanallarına erişimi yoktur.
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          musteri: resolve(__dirname, 'src/preload/musteri.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer/src'),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          'musteri-ekrani': resolve(__dirname, 'src/renderer/musteri-ekrani.html'),
        },
      },
    },
  },
});
