import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineConfig } from 'vitest/config'

// PACKAGE_DIR is set by test/integration.test.ts, which runs this project from a temp copy
const buildDirectory = path.join(process.env.PACKAGE_DIR, 'dist')
const { default: OutdatedSnapshotReporter } = await import(
  pathToFileURL(path.join(buildDirectory, 'outdated-snapshot-reporter.mjs')).href
)

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@brachkow/vitest-image-snapshot': path.join(buildDirectory, 'index.mjs'),
    },
  },
  test: {
    include: ['*.test.mjs'],
    reporters: ['default', new OutdatedSnapshotReporter()],
  },
})
