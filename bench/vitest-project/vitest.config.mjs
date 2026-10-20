import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@brachkow/vitest-image-snapshot': path.resolve(import.meta.dirname, '../../dist/index.mjs'),
    },
  },
  test: {
    include: ['*.bench.test.mjs'],
    testTimeout: 600_000,
  },
})
