import { Buffer } from 'node:buffer'
import type { CoreOptions as BlazediffOptions } from '@blazediff/core'
import type { PixelmatchOptions } from 'pixelmatch'
import type { Options as SsimOptions } from 'ssim.js'
import type { DiffDirection } from './image.ts'

export type FailureThresholdType = 'pixel' | 'percent'

export type ComparisonMethod = 'pixelmatch' | 'ssim' | 'blazediff'

export type CustomDiffConfig = PixelmatchOptions | Partial<SsimOptions> | BlazediffOptions

export interface CustomSnapshotIdentifierParams {
  testPath: string
  currentTestName: string
  counter: number
  defaultIdentifier: string
}

export interface MatchImageSnapshotOptions {
  customDiffConfig?: CustomDiffConfig
  customSnapshotIdentifier?: string | ((params: CustomSnapshotIdentifierParams) => string)
  customSnapshotsDir?: string
  storeReceivedOnFailure?: boolean
  customReceivedDir?: string
  customReceivedPostfix?: string
  customDiffDir?: string
  onlyDiff?: boolean
  runtimeHooksPath?: string
  diffDirection?: DiffDirection
  noColors?: boolean
  failureThreshold?: number
  failureThresholdType?: FailureThresholdType
  updatePassedSnapshot?: boolean
  blur?: number
  /** Accepted for compatibility. Image work always runs in a worker thread. */
  runInProcess?: boolean
  dumpDiffToConsole?: boolean
  dumpInlineDiffToConsole?: boolean
  allowSizeMismatch?: boolean
  /** Accepted for compatibility. No child process is spawned. */
  maxChildProcessBufferSizeInBytes?: number
  comparisonMethod?: ComparisonMethod
  /**
   * zlib level for diff images, 0 to 9. The default 1 encodes 4-5x faster than 6 and writes
   * larger files. Raise it when diff artifacts are uploaded and their size matters.
   */
  diffCompressionLevel?: number
}

export interface DiffOptions {
  receivedImageBuffer: Buffer
  snapshotIdentifier: string
  snapshotsDirectory: string
  storeReceivedOnFailure?: boolean
  receivedPostfix?: string
  receivedDirectory?: string
  diffDirectory?: string
  diffDirection?: DiffDirection
  onlyDiff?: boolean
  updateSnapshot?: boolean
  updatePassedSnapshot?: boolean
  customDiffConfig?: CustomDiffConfig
  failureThreshold: number
  failureThresholdType: FailureThresholdType
  blur?: number
  allowSizeMismatch?: boolean
  comparisonMethod?: ComparisonMethod
  diffCompressionLevel?: number
  testPath?: string
  currentTestName?: string
  runtimeHooksPath?: string
  /** The base64 diff is several MB for big screenshots, so it is only built when a dump option asks for it */
  includeImgSrcString?: boolean
}

export interface ImageDimensions {
  receivedWidth: number
  receivedHeight: number
  baselineWidth: number
  baselineHeight: number
}

export interface DiffResult {
  added?: boolean
  updated?: boolean
  pass?: boolean
  diffSize?: boolean
  diffRatio?: number
  diffPixelCount?: number
  diffOutputPath?: string
  receivedSnapshotPath?: string
  imageDimensions?: ImageDimensions
  imgSrcString?: string
}

export { type DiffDirection } from './image.ts'
