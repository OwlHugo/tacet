import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    // Bundle the core so the packaged app does not depend on workspace symlinks.
    build: { externalizeDeps: { exclude: ['@tacet/core'] } },
  },
  preload: {
    build: {
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
          recorder: resolve(import.meta.dirname, 'src/renderer/recorder.html'),
        },
      },
    },
    plugins: [react()],
  },
});
