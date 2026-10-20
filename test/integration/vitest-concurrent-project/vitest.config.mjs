import path from 'node:path'
import { defineConfig } from 'vitest/config'

// PACKAGE_DIR is set by test/integration.test.ts, which runs this project from a temp copy
const buildDirectory = path.join(process.env.PACKAGE_DIR, 'dist')

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@brachkow/vitest-image-snapshot': path.join(buildDirectory, 'index.mjs'),
    },
  },
  test: {
    include: ['*.test.mjs'],
  },
})
