import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'outdated-snapshot-reporter': 'src/outdated-snapshot-reporter.ts',
    },
    format: ['esm', 'cjs'],
    platform: 'node',
    fixedExtension: true,
    dts: true,
    // The CJS build needs import.meta.url to locate the worker file
    shims: true,
  },
  {
    // The worker always runs in a plain Node thread, so ESM alone is enough
    entry: { worker: 'src/worker.ts' },
    format: 'esm',
    platform: 'node',
    fixedExtension: true,
    clean: false,
  },
])
