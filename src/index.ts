/*
 * Derived from jest-image-snapshot (src/index.js)
 * Copyright (c) 2017 American Express Travel Related Services Company, Inc.
 * Licensed under the Apache License, Version 2.0. Modified: diffing moved to a worker thread,
 * chalk replaced with node:util styleText, lodash replaced with es-toolkit, rewritten in TypeScript.
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { styleText } from 'node:util'
import { kebabCase, merge } from 'es-toolkit/compat'
import { markTouchedFile } from './touched-files.ts'
import { runDiffImageToSnapshot } from './run-diff.ts'
import type { CustomSnapshotIdentifierParams, DiffResult, MatchImageSnapshotOptions } from './types.ts'

export type * from './types.ts'
export { waitForStableScreenshot } from './stable-screenshot.ts'
export type { StableScreenshotOptions } from './stable-screenshot.ts'

const SNAPSHOTS_DIR = '__image_snapshots__'

const SUPPORTED_INLINE_TERMINALS = new Set(['iTerm.app', 'WezTerm'])

const timesCalled = new Map<string, number>()

type SnapshotCounter = 'added' | 'updated' | 'matched' | 'unmatched'

// The subset of Jest's and Vitest's SnapshotState that image snapshots read and write.
// Vitest returns counter objects that coerce to numbers via valueOf, and its setters
// accept numbers, specifically so jest-image-snapshot style `added + 1` keeps working.
export interface SnapshotState {
  _counters: Map<string, number>
  _updateSnapshot: 'all' | 'new' | 'none'
  added: number
  updated: number
  matched: number
  unmatched: number
}

export interface MatcherContext {
  testPath?: string
  currentTestName?: string
  isNot?: boolean
  // Jest and Vitest declare _counters and _updateSnapshot as private class members, and TypeScript
  // never treats a class with private members as assignable to an interface with public ones.
  // Typing this as SnapshotState would make expect.extend({ toMatchImageSnapshot }) fail to compile
  snapshotState: object
}

export interface MatcherResult {
  pass: boolean
  message: () => string
}

type Received = Buffer | Uint8Array | ArrayBuffer | string

const toBuffer = (data: Received): Buffer => {
  if (data === null || data === undefined || Buffer.isBuffer(data)) {
    return data
  }
  if (typeof data === 'string') {
    return Buffer.from(data, 'base64')
  }
  return Buffer.from(data as Uint8Array)
}

export const updateSnapshotState = <T extends object>(originalSnapshotState: T, partialSnapshotState: object): T => {
  // jest-image-snapshot's own tests set this to keep their runs out of the snapshot summary
  if ((globalThis as { UNSTABLE_SKIP_REPORTING?: boolean }).UNSTABLE_SKIP_REPORTING) {
    return originalSnapshotState
  }
  return merge(originalSnapshotState, partialSnapshotState)
}

const incrementCounter = (snapshotState: SnapshotState, counter: SnapshotCounter) =>
  updateSnapshotState(snapshotState, { [counter]: snapshotState[counter] + 1 })

type Paint = (format: Parameters<typeof styleText>[0], text: string) => string

// Mirrors chalk's levels as jest-image-snapshot used them: true means no color,
// false forces basic color, undefined detects support from the terminal
const createPaint =
  (noColors: boolean | undefined): Paint =>
  (format, text) => {
    if (noColors === true) {
      return text
    }
    return styleText(format, text, { validateStream: noColors === undefined })
  }

const checkResult = ({
  result,
  snapshotState,
  retryTimes,
  snapshotIdentifier,
  paint,
  dumpDiffToConsole,
  dumpInlineDiffToConsole,
  allowSizeMismatch,
}: {
  result: DiffResult
  snapshotState: SnapshotState
  retryTimes: number
  snapshotIdentifier: string
  paint: Paint
  dumpDiffToConsole: boolean
  dumpInlineDiffToConsole: boolean
  allowSizeMismatch: boolean
}): MatcherResult => {
  if (result.updated) {
    incrementCounter(snapshotState, 'updated')
    return { pass: true, message: () => '' }
  }
  if (result.added) {
    incrementCounter(snapshotState, 'added')
    return { pass: true, message: () => '' }
  }
  if (result.pass) {
    incrementCounter(snapshotState, 'matched')
    return { pass: true, message: () => '' }
  }

  const currentRun = timesCalled.get(snapshotIdentifier) ?? 0
  // A retried test only counts as unmatched once its last attempt fails
  if (!retryTimes || currentRun > retryTimes) {
    incrementCounter(snapshotState, 'unmatched')
  }

  const differencePercentage = (result.diffRatio ?? 0) * 100
  const message = () => {
    const dimensions = result.imageDimensions
    let failure =
      result.diffSize && !allowSizeMismatch && dimensions
        ? `Expected image to be the same size as the snapshot (${dimensions.baselineWidth}x${dimensions.baselineHeight}), but was different (${dimensions.receivedWidth}x${dimensions.receivedHeight}).\n`
        : `Expected image to match or be a close match to snapshot but was ${differencePercentage}% different from snapshot (${result.diffPixelCount} differing pixels).\n`

    failure += `${paint(['bold', 'red'], 'See diff for details:')} ${paint('red', result.diffOutputPath ?? '')}`

    const imgSrcString = result.imgSrcString ?? ''
    const canDumpInline =
      SUPPORTED_INLINE_TERMINALS.has(process.env.TERM_PROGRAM ?? '') || 'ENABLE_INLINE_DIFF' in process.env
    if (dumpInlineDiffToConsole && canDumpInline) {
      const name = Buffer.from(result.diffOutputPath ?? '').toString('base64')
      failure += `\n\n\t\u001B]1337;File=name=${name};inline=1;width=40:${imgSrcString.replace('data:image/png;base64,', '')}\u0007\u001B\n\n`
    } else if (dumpDiffToConsole || dumpInlineDiffToConsole) {
      failure += `\n${paint(['bold', 'red'], 'Or paste below image diff string to your browser`s URL bar.')}\n ${imgSrcString}`
    }
    return failure
  }
  return { pass: false, message }
}

const createSnapshotIdentifier = ({
  retryTimes,
  testPath,
  currentTestName,
  customSnapshotIdentifier,
  snapshotState,
}: {
  retryTimes: number
  testPath: string
  currentTestName: string
  customSnapshotIdentifier: MatchImageSnapshotOptions['customSnapshotIdentifier']
  snapshotState: SnapshotState
}): string => {
  const counter = snapshotState._counters.get(currentTestName) ?? 0
  const defaultIdentifier = kebabCase(`${path.basename(testPath)}-${currentTestName}-${counter}`)

  let snapshotIdentifier =
    typeof customSnapshotIdentifier === 'string' && customSnapshotIdentifier
      ? customSnapshotIdentifier
      : `${defaultIdentifier}-snap`

  if (typeof customSnapshotIdentifier === 'function') {
    const params: CustomSnapshotIdentifierParams = { testPath, currentTestName, counter, defaultIdentifier }
    const customResult = customSnapshotIdentifier(params)
    if (retryTimes && !customResult) {
      throw new Error('A unique customSnapshotIdentifier must be set when jest.retryTimes() is used')
    }
    snapshotIdentifier = customResult || defaultIdentifier
  }

  if (retryTimes) {
    if (!customSnapshotIdentifier) {
      throw new Error('A unique customSnapshotIdentifier must be set when jest.retryTimes() is used')
    }
    timesCalled.set(snapshotIdentifier, (timesCalled.get(snapshotIdentifier) ?? 0) + 1)
  }

  return snapshotIdentifier
}

// Jest stores the retry count from jest.retryTimes() under this global symbol
const readRetryTimes = (): number =>
  Number.parseInt(String((globalThis as Record<symbol, unknown>)[Symbol.for('RETRY_TIMES')]), 10) || 0

export const configureToMatchImageSnapshot = ({
  customDiffConfig: commonCustomDiffConfig = {},
  customSnapshotIdentifier: commonCustomSnapshotIdentifier,
  customSnapshotsDir: commonCustomSnapshotsDirectory,
  storeReceivedOnFailure: commonStoreReceivedOnFailure = false,
  customReceivedDir: commonCustomReceivedDirectory,
  customReceivedPostfix: commonCustomReceivedPostfix,
  customDiffDir: commonCustomDiffDirectory,
  onlyDiff: commonOnlyDiff = false,
  runtimeHooksPath: commonRuntimeHooksPath,
  diffDirection: commonDiffDirection = 'horizontal',
  noColors: commonNoColors,
  failureThreshold: commonFailureThreshold = 0,
  failureThresholdType: commonFailureThresholdType = 'pixel',
  updatePassedSnapshot: commonUpdatePassedSnapshot = false,
  blur: commonBlur = 0,
  dumpDiffToConsole: commonDumpDiffToConsole = false,
  dumpInlineDiffToConsole: commonDumpInlineDiffToConsole = false,
  allowSizeMismatch: commonAllowSizeMismatch = false,
  comparisonMethod: commonComparisonMethod = 'pixelmatch',
}: MatchImageSnapshotOptions = {}) =>
  function toMatchImageSnapshot(
    this: MatcherContext,
    received: Received,
    {
      customSnapshotIdentifier = commonCustomSnapshotIdentifier,
      customSnapshotsDir: customSnapshotsDirectory = commonCustomSnapshotsDirectory,
      storeReceivedOnFailure = commonStoreReceivedOnFailure,
      customReceivedDir: customReceivedDirectory = commonCustomReceivedDirectory,
      customReceivedPostfix = commonCustomReceivedPostfix,
      customDiffDir: customDiffDirectory = commonCustomDiffDirectory,
      onlyDiff = commonOnlyDiff,
      runtimeHooksPath = commonRuntimeHooksPath,
      diffDirection = commonDiffDirection,
      customDiffConfig = {},
      noColors = commonNoColors,
      failureThreshold = commonFailureThreshold,
      failureThresholdType = commonFailureThresholdType,
      updatePassedSnapshot = commonUpdatePassedSnapshot,
      blur = commonBlur,
      dumpDiffToConsole = commonDumpDiffToConsole,
      dumpInlineDiffToConsole = commonDumpInlineDiffToConsole,
      allowSizeMismatch = commonAllowSizeMismatch,
      comparisonMethod = commonComparisonMethod,
    }: MatchImageSnapshotOptions = {},
  ): MatcherResult {
    const { testPath = '', currentTestName = '', isNot } = this
    const snapshotState = this.snapshotState as SnapshotState
    const paint = createPaint(noColors)
    const retryTimes = readRetryTimes()

    if (isNot) {
      throw new Error('Jest: `.not` cannot be used with `.toMatchImageSnapshot()`.')
    }

    updateSnapshotState(snapshotState, {
      _counters: snapshotState._counters.set(currentTestName, (snapshotState._counters.get(currentTestName) ?? 0) + 1),
    })

    const snapshotIdentifier = createSnapshotIdentifier({
      retryTimes,
      testPath,
      currentTestName,
      customSnapshotIdentifier,
      snapshotState,
    })

    const snapshotsDirectory = customSnapshotsDirectory || path.join(path.dirname(testPath), SNAPSHOTS_DIR)
    const baselineSnapshotPath = path.join(snapshotsDirectory, `${snapshotIdentifier}.png`)
    markTouchedFile(baselineSnapshotPath)

    if (snapshotState._updateSnapshot === 'none' && !fs.existsSync(baselineSnapshotPath)) {
      return {
        pass: false,
        message: () =>
          `New snapshot was ${paint(['bold', 'red'], 'not written')}. The update flag must be explicitly ` +
          'passed to write a new snapshot.\n\n + This is likely because this test is run in a continuous ' +
          'integration (CI) environment in which snapshots are not written by default.\n\n',
      }
    }

    const result = runDiffImageToSnapshot({
      receivedImageBuffer: toBuffer(received),
      snapshotsDirectory,
      storeReceivedOnFailure,
      receivedDirectory: customReceivedDirectory,
      receivedPostfix: customReceivedPostfix,
      diffDirectory: customDiffDirectory,
      diffDirection,
      testPath,
      currentTestName,
      onlyDiff,
      snapshotIdentifier,
      updateSnapshot: snapshotState._updateSnapshot === 'all',
      customDiffConfig: { ...commonCustomDiffConfig, ...customDiffConfig },
      failureThreshold,
      failureThresholdType,
      updatePassedSnapshot,
      blur,
      allowSizeMismatch,
      comparisonMethod,
      runtimeHooksPath,
      includeImgSrcString: dumpDiffToConsole || dumpInlineDiffToConsole,
    })

    return checkResult({
      result,
      snapshotState,
      retryTimes,
      snapshotIdentifier,
      paint,
      dumpDiffToConsole,
      dumpInlineDiffToConsole,
      allowSizeMismatch,
    })
  }

export const toMatchImageSnapshot = configureToMatchImageSnapshot()
