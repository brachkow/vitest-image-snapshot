import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { diff as blazediff } from '@blazediff/core'
import pixelmatch from 'pixelmatch'
import { describe, expect, test } from 'vitest'
import { configureToMatchImageSnapshot } from '../src/index.ts'
import type { MatchImageSnapshotOptions } from '../src/types.ts'
import { runScenario } from './compat.ts'
import { encodeWithPngjs, flatPattern, withRectangle } from './fixtures.ts'
import { ReferencePNG } from './reference.ts'

const STUBS = path.join(import.meta.dirname, 'original/stubs')
const stub = (name: string) => fs.readFileSync(path.join(STUBS, name))

// Defaults of the comparator behind Vitest 5's toMatchScreenshot (@vitest/browser 5.0.5)
const VITEST_COMPARATOR_DEFAULTS = { threshold: 0.1, includeAA: false, alpha: 0.1 }

const decode = (buffer: Buffer) => {
  const png = ReferencePNG.sync.read(buffer)
  return { data: png.data, width: png.width, height: png.height }
}

const countDirectly = (
  engine: typeof blazediff | typeof pixelmatch,
  baseline: Buffer,
  received: Buffer,
  options: { threshold?: number; includeAA?: boolean },
) => {
  const a = decode(received)
  const b = decode(baseline)
  return engine(a.data, b.data, null, a.width, a.height, options)
}

const DIFFERING_PIXELS = /\((\d+) differing pixels\)/

// Runs a baseline then a second image through the matcher and returns the second step
const compareWithMatcher = (baseline: Buffer, received: Buffer, options: MatchImageSnapshotOptions) => {
  const run = runScenario(configureToMatchImageSnapshot, {
    commonOptions: { comparisonMethod: 'blazediff', ...options },
    steps: [{ received: baseline }, { received }],
  })
  const step = run.steps[1]
  const count = 'message' in step ? DIFFERING_PIXELS.exec(step.message ?? '')?.[1] : undefined
  return { outcome: step.outcome, count: count === undefined ? undefined : Number(count), files: run.files }
}

describe("comparisonMethod: 'blazediff'", () => {
  test('reports the same count as @blazediff/core on the same pixels', () => {
    // Arrange
    const baseline = stub('TestImage.png')
    const received = stub('TestImageFailure.png')

    // Act
    const { outcome, count } = compareWithMatcher(baseline, received, {})

    // Assert
    expect(outcome).toBe('fail')
    expect(count).toBe(countDirectly(blazediff, baseline, received, { threshold: 0.01 }))
  })

  test('counts differently from pixelmatch on anti-aliased edges, which is why it is opt-in', () => {
    // Arrange
    const baseline = stub('TestImage.png')
    const received = stub('TestImageFailure.png')

    // Act
    const { count } = compareWithMatcher(baseline, received, {})

    // Assert
    expect(count).toBe(8625)
    expect(countDirectly(pixelmatch, baseline, received, { threshold: 0.01 })).toBe(8645)
  })

  test('passes a one-pixel change that pixelmatch fails at the default threshold', () => {
    // Arrange
    const baseline = stub('TestImage.png')
    const received = stub('TestImageUpdate1pxOff.png')

    // Act
    const { outcome } = compareWithMatcher(baseline, received, {})

    // Assert
    expect(outcome).toBe('pass')
    expect(countDirectly(pixelmatch, baseline, received, { threshold: 0.01 })).toBe(1)
  })

  test("counts like Vitest's toMatchScreenshot with threshold 0.1", () => {
    // Arrange
    const baseline = stub('Desktop 1_082.png')
    const received = stub('Desktop 1_083.png')

    // Act
    const { count } = compareWithMatcher(baseline, received, { customDiffConfig: { threshold: 0.1 } })

    // Assert
    expect(count).toBe(countDirectly(blazediff, baseline, received, VITEST_COMPARATOR_DEFAULTS))
  })

  test('passes includeAA through to blazediff', () => {
    // Arrange
    const baseline = stub('Desktop 1_082.png')
    const received = stub('Desktop 1_083.png')

    // Act
    const { count } = compareWithMatcher(baseline, received, { customDiffConfig: { includeAA: true } })

    // Assert
    expect(count).toBe(countDirectly(blazediff, baseline, received, { threshold: 0.01, includeAA: true }))
  })

  test("puts blazediff's diff output in the middle panel of the diff image", () => {
    // Arrange
    const pattern = flatPattern(40, 30)
    const baseline = encodeWithPngjs(pattern, { colorType: 6, bitDepth: 8 })
    const received = encodeWithPngjs(withRectangle(pattern, 5, 12, 6, 4), { colorType: 6, bitDepth: 8 })
    const expectedPanel = new Uint8Array(40 * 30 * 4)
    blazediff(decode(received).data, decode(baseline).data, expectedPanel, 40, 30, { threshold: 0.01 })

    // Act
    const { files } = compareWithMatcher(baseline, received, {})

    // Assert
    const [, diffFile] = Object.entries(files).find(([name]) => name.endsWith('-diff.png')) ?? []
    const [dimensions, base64] = String(diffFile).split(':')
    expect(dimensions).toBe('120x30')
    const composite = Buffer.from(base64, 'base64')
    const rowBytes = 40 * 4
    const middlePanel = Buffer.concat(
      Array.from({ length: 30 }, (_row, y) => composite.subarray((y * 3 + 1) * rowBytes, (y * 3 + 2) * rowBytes)),
    )
    expect(middlePanel.equals(Buffer.from(expectedPanel))).toBe(true)
  })

  test('passes identical pixels in a differently encoded file', () => {
    // Arrange
    const pattern = flatPattern(40, 30)
    const baseline = encodeWithPngjs(pattern, { colorType: 6, bitDepth: 8 })
    const received = encodeWithPngjs(pattern, { colorType: 2, bitDepth: 8 })

    // Act
    const { outcome } = compareWithMatcher(baseline, received, {})

    // Assert
    expect(outcome).toBe('pass')
  })
})
