import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const src = (p: string) => resolve(import.meta.dirname, 'src', p)
// Bundle the core from source: the app needs no build of the workspace package.
const core = (entry: string) => resolve(import.meta.dirname, '../../packages/core/src', entry)
const alias = [
  { find: '@tacet/core/browser', replacement: core('browser.ts') },
  { find: '@tacet/core', replacement: core('index.ts') },
]

export default defineConfig({
  main: {
    resolve: { alias },
    // Everything is bundled so the packaged app has no node_modules to resolve at runtime.
    build: { externalizeDeps: false, rollupOptions: { input: { main: src('main/main.ts') } } },
  },
  preload: {
    resolve: { alias },
    // A sandboxed preload must be a single CommonJS file.
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: { preload: src('preload/preload.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: src('renderer'),
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: src('renderer/index.html'), recorder: src('renderer/recorder.html') },
      },
    },
    plugins: [react()],
  },
})
