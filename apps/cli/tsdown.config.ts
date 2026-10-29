import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  platform: 'node',
  dts: false,
  // The @tacet npm scope belongs to someone else: the core ships inside the CLI, not as a package.
  deps: { alwaysBundle: ['@tacet/core'] },
})
