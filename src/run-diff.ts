import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createSyncFn } from 'synckit'
import { assertPngSignature } from './png-signature.ts'
import { snapshotPaths, validateFailureThresholdType } from './snapshot-paths.ts'
import type { DiffOptions, DiffResult } from './types.ts'

// Sources run as .ts under Vitest, the build ships the worker as .mjs next to the entry
const WORKER_EXTENSION = import.meta.url.endsWith('.ts') ? '.ts' : '.mjs'
const workerPath = fileURLToPath(new URL(`worker${WORKER_EXTENSION}`, import.meta.url))

let diffInWorker: ((options: DiffOptions) => DiffResult) | undefined

// Most checks in a passing suite get exactly the baseline's bytes back, which needs
// no decoding and no worker. Comparing 2 MB of bytes takes about 1 ms.
const tryIdenticalBytes = (options: DiffOptions): DiffResult | undefined => {
  const { updateSnapshot = false, updatePassedSnapshot = false } = options
  // The worker owns rewriting a passing baseline, since runtime hooks may transform it
  if (updateSnapshot && updatePassedSnapshot) {
    return undefined
  }

  const { baselineSnapshotPath, receivedSnapshotPath, diffOutputPath } = snapshotPaths(options)
  let baseline: Buffer
  try {
    baseline = fs.readFileSync(baselineSnapshotPath)
  } catch {
    return undefined
  }
  if (!baseline.equals(options.receivedImageBuffer)) {
    return undefined
  }

  // Same order as jest-image-snapshot: stale outputs go first, then decoding (which
  // rejects a non-PNG pair even when identical), then the threshold type check
  fs.rmSync(receivedSnapshotPath, { recursive: true, force: true })
  fs.rmSync(diffOutputPath, { recursive: true, force: true })
  assertPngSignature(baseline)
  validateFailureThresholdType(options.failureThresholdType)
  return { pass: true, diffSize: false, diffRatio: 0, diffPixelCount: 0, diffOutputPath }
}

export const runDiffImageToSnapshot = (options: DiffOptions): DiffResult => {
  const fastResult = tryIdenticalBytes(options)
  if (fastResult) {
    return fastResult
  }
  // Started on first use, so a suite where every check matches never pays the worker startup
  diffInWorker ??= createSyncFn<(options: DiffOptions) => Promise<DiffResult>>(workerPath)
  return diffInWorker(options)
}
