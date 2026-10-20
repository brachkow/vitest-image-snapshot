/*
 * Derived from jest-image-snapshot (src/diff-snapshot.js)
 * Copyright (c) 2017 American Express Travel Related Services Company, Inc.
 * Licensed under the Apache License, Version 2.0. Modified: pngjs replaced with sharp,
 * child process replaced with a worker thread, byte-identical fast path added,
 * rewritten in TypeScript.
 */
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { blurRGBA } from 'glur'
import pixelmatch from 'pixelmatch'
import { ssim } from 'ssim.js'
import type { Options as SsimOptions } from 'ssim.js'
import { alignImagesToSameSize, composeImages, createImage, decodePng, encodePng } from './image.ts'
import type { RawImage } from './image.ts'
import { snapshotPaths, validateFailureThresholdType } from './snapshot-paths.ts'
import type { CustomDiffConfig, DiffOptions, DiffResult, FailureThresholdType } from './types.ts'

const require = createRequire(import.meta.url)

const DEFAULT_PIXELMATCH_DIFF_CONFIG = { threshold: 0.01 }

// Bezkrovny downsamples before comparing, which is about 9x faster than the 'fast' SSIM preset
const DEFAULT_SSIM_DIFF_CONFIG: Partial<SsimOptions> = { ssim: 'bezkrovny' }

// Converts SSIM's similarity score to a pixel count so thresholds work the same as with pixelmatch
const ssimMatch = (
  received: Buffer,
  baseline: Buffer,
  diff: Buffer,
  width: number,
  height: number,
  diffConfig: Partial<SsimOptions>,
): number => {
  const { ssim_map: ssimMap, mssim } = ssim(
    { data: new Uint8ClampedArray(received.buffer, received.byteOffset, received.length), width, height },
    { data: new Uint8ClampedArray(baseline.buffer, baseline.byteOffset, baseline.length), width, height },
    diffConfig,
  )
  const diffPixels = (1 - mssim) * width * height
  const diffRgbaPixels = new DataView(diff.buffer, diff.byteOffset)
  for (let line = 0; line !== height; ++line) {
    for (let position = 0; position !== width; ++position) {
      const mapIndex =
        ssimMap.width * Math.round((ssimMap.height * line) / height) + Math.round((ssimMap.width * position) / width)
      // Opaque red whose intensity grows with dissimilarity
      const diffValue = 0xff_00_00_00 + Math.floor(0xff * (1 - ssimMap.data[mapIndex]))
      diffRgbaPixels.setUint32((line * width + position) * 4, diffValue)
    }
  }
  return diffPixels
}

const shouldFail = ({
  totalPixels,
  diffPixelCount,
  hasSizeMismatch,
  allowSizeMismatch,
  failureThresholdType,
  failureThreshold,
}: {
  totalPixels: number
  diffPixelCount: number
  hasSizeMismatch: boolean
  allowSizeMismatch: boolean
  failureThresholdType: FailureThresholdType
  failureThreshold: number
}) => {
  const diffRatio = diffPixelCount / totalPixels
  // A size mismatch fails outright unless allowSizeMismatch. The threshold type is only
  // validated when the threshold is evaluated, matching jest-image-snapshot.
  if (hasSizeMismatch && !allowSizeMismatch) {
    return { pass: false, diffSize: true, diffRatio }
  }
  validateFailureThresholdType(failureThresholdType)
  const pass = {
    pixel: () => diffPixelCount <= failureThreshold,
    percent: () => diffRatio <= failureThreshold,
  }[failureThresholdType]()
  return { pass, diffSize: hasSizeMismatch, diffRatio }
}

interface WriteOptions {
  pathToFile: string
  content: Buffer
  runtimeHooksPath?: string
  testPath?: string
  currentTestName?: string
}

interface RuntimeHooks {
  onBeforeWriteToDisc: (args: {
    buffer: Buffer
    destination: string
    testPath?: string
    currentTestName?: string
  }) => Buffer
}

const loadRuntimeHooks = (runtimeHooksPath: string): RuntimeHooks => {
  try {
    return require(runtimeHooksPath)
  } catch (error) {
    throw new Error(`Couldn't import ${runtimeHooksPath}: ${(error as Error).message}`, { cause: error })
  }
}

const writeFileWithHooks = ({ pathToFile, content, runtimeHooksPath, testPath, currentTestName }: WriteOptions) => {
  // Created before the hook runs, since hooks may write next to the destination
  fs.mkdirSync(path.dirname(pathToFile), { recursive: true })
  let finalContent = content
  if (runtimeHooksPath) {
    const runtimeHooks = loadRuntimeHooks(runtimeHooksPath)
    try {
      finalContent = runtimeHooks.onBeforeWriteToDisc({
        buffer: content,
        destination: pathToFile,
        testPath,
        currentTestName,
      })
    } catch (error) {
      throw new Error(`Couldn't execute onBeforeWriteToDisc: ${(error as Error).message}`, { cause: error })
    }
  }
  fs.writeFileSync(pathToFile, finalContent)
}

const compare = (
  comparisonMethod: string,
  received: RawImage,
  baseline: RawImage,
  diff: RawImage,
  customDiffConfig: CustomDiffConfig,
): number => {
  if (comparisonMethod === 'ssim') {
    const config = { ...DEFAULT_SSIM_DIFF_CONFIG, ...customDiffConfig } as Partial<SsimOptions>
    return ssimMatch(received.data, baseline.data, diff.data, received.width, received.height, config)
  }
  const config = { ...DEFAULT_PIXELMATCH_DIFF_CONFIG, ...customDiffConfig }
  return pixelmatch(received.data, baseline.data, diff.data, received.width, received.height, config)
}

export const diffImageToSnapshot = async (options: DiffOptions): Promise<DiffResult> => {
  const {
    receivedImageBuffer,
    snapshotIdentifier,
    snapshotsDirectory,
    storeReceivedOnFailure,
    receivedPostfix,
    receivedDirectory,
    diffDirectory,
    diffDirection = 'horizontal',
    onlyDiff = false,
    updateSnapshot = false,
    updatePassedSnapshot = false,
    customDiffConfig = {},
    failureThreshold,
    failureThresholdType,
    blur,
    allowSizeMismatch = false,
    comparisonMethod = 'pixelmatch',
    testPath,
    currentTestName,
    runtimeHooksPath,
    includeImgSrcString = false,
  } = options
  const writeContext = { runtimeHooksPath, testPath, currentTestName }
  const { baselineSnapshotPath, receivedSnapshotPath, diffOutputPath } = snapshotPaths({
    snapshotsDirectory,
    snapshotIdentifier,
    receivedPostfix,
    receivedDirectory,
    diffDirectory,
  })

  if (!fs.existsSync(baselineSnapshotPath)) {
    writeFileWithHooks({ pathToFile: baselineSnapshotPath, content: receivedImageBuffer, ...writeContext })
    return { added: true }
  }

  fs.rmSync(receivedSnapshotPath, { recursive: true, force: true })
  fs.rmSync(diffOutputPath, { recursive: true, force: true })

  const [rawReceived, rawBaseline] = await Promise.all([
    decodePng(receivedImageBuffer),
    decodePng(fs.readFileSync(baselineSnapshotPath)),
  ])
  const hasSizeMismatch = rawReceived.width !== rawBaseline.width || rawReceived.height !== rawBaseline.height
  const imageDimensions = {
    receivedHeight: rawReceived.height,
    receivedWidth: rawReceived.width,
    baselineHeight: rawBaseline.height,
    baselineWidth: rawBaseline.width,
  }
  const [received, baseline] = hasSizeMismatch
    ? alignImagesToSameSize(rawReceived, rawBaseline)
    : [rawReceived, rawBaseline]
  const { width, height } = received

  if (typeof blur === 'number' && blur > 0) {
    blurRGBA(received.data, width, height, blur)
    blurRGBA(baseline.data, width, height, blur)
  }

  const diff = createImage(width, height)
  const diffPixelCount = compare(comparisonMethod, received, baseline, diff, customDiffConfig)

  const { pass, diffSize, diffRatio } = shouldFail({
    totalPixels: width * height,
    diffPixelCount,
    hasSizeMismatch,
    allowSizeMismatch,
    failureThresholdType,
    failureThreshold,
  })

  if (!pass && !updateSnapshot) {
    let result: DiffResult = {}
    if (storeReceivedOnFailure) {
      writeFileWithHooks({ pathToFile: receivedSnapshotPath, content: receivedImageBuffer, ...writeContext })
      result = { receivedSnapshotPath }
    }
    const panels = onlyDiff ? [diff] : [baseline, diff, received]
    const pngBuffer = await encodePng(composeImages(panels, diffDirection))
    writeFileWithHooks({ pathToFile: diffOutputPath, content: pngBuffer, ...writeContext })
    return {
      ...result,
      pass: false,
      diffSize,
      imageDimensions,
      diffOutputPath,
      diffRatio,
      diffPixelCount,
      ...(includeImgSrcString ? { imgSrcString: `data:image/png;base64,${pngBuffer.toString('base64')}` } : {}),
    }
  }

  if (updateSnapshot && (!pass || updatePassedSnapshot)) {
    writeFileWithHooks({ pathToFile: baselineSnapshotPath, content: receivedImageBuffer, ...writeContext })
    return { updated: true }
  }

  return { pass, diffSize, diffRatio, diffPixelCount, diffOutputPath }
}
