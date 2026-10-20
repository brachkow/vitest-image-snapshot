import { createRequire } from 'node:module'
import path from 'node:path'
import type { PNG as PNGType } from 'pngjs'

const require = createRequire(import.meta.url)
const jestImageSnapshotDirectory = path.dirname(require.resolve('jest-image-snapshot'))

// The exact pngjs copy jest-image-snapshot 6.5.2 decodes with, so tests compare
// against the original behavior rather than whatever pngjs version is newest
export const ReferencePNG: typeof PNGType = require(
  require.resolve('pngjs', { paths: [jestImageSnapshotDirectory] }),
).PNG

// The original matcher, typed with this package's signature since the APIs are meant to be identical
export const reference: {
  configureToMatchImageSnapshot: typeof import('../src/index.ts').configureToMatchImageSnapshot
} = require('jest-image-snapshot')
