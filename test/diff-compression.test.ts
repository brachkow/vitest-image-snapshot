import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { configureToMatchImageSnapshot } from '../src/index.ts'
import type { MatcherContext, MatchImageSnapshotOptions, SnapshotState } from '../src/index.ts'
import { createPattern, encodeWithPngjs, withRectangle } from './fixtures.ts'
import { ReferencePNG } from './reference.ts'

// A noisy pattern, so the compression level visibly changes the file size
const pattern = createPattern(200, 120)
const base = encodeWithPngjs(pattern, { colorType: 6, bitDepth: 8 })
const changed = encodeWithPngjs(withRectangle(pattern, 30, 30, 40, 20), { colorType: 6, bitDepth: 8 })

const SHARP_COMPRESSION_ERROR = /compressionLevel/

describe('diffCompressionLevel', () => {
  let directory: string

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-snapshot-compression-'))
  })

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  // Writes the baseline, then fails on the changed image and returns the diff file
  const writeDiff = (name: string, options: MatchImageSnapshotOptions) => {
    const matcher = configureToMatchImageSnapshot({ customSnapshotsDir: directory, noColors: true, ...options })
    const context = (): MatcherContext => ({
      testPath: path.join(directory, 'compression.test.ts'),
      currentTestName: name,
      isNot: false,
      snapshotState: {
        _counters: new Map(),
        _updateSnapshot: 'new',
        added: 0,
        updated: 0,
        matched: 0,
        unmatched: 0,
      } satisfies SnapshotState,
    })
    matcher.call(context(), base)
    const result = matcher.call(context(), changed)
    const diffDirectory = path.join(directory, '__diff_output__')
    const diffFile = fs.readdirSync(diffDirectory).find((file) => file.includes(name.replaceAll(' ', '-')))
    return { result, diff: fs.readFileSync(path.join(diffDirectory, diffFile ?? '')) }
  }

  test('writes a smaller diff with the same pixels at a higher level', () => {
    // Act
    const fast = writeDiff('level one', {})
    const small = writeDiff('level nine', { diffCompressionLevel: 9 })

    // Assert
    expect(small.diff.length).toBeLessThan(fast.diff.length)
    expect(ReferencePNG.sync.read(small.diff).data.equals(ReferencePNG.sync.read(fast.diff).data)).toBe(true)
    expect(small.result.message().replaceAll('nine', 'one')).toBe(fast.result.message())
  })

  test('rejects a level sharp does not support', () => {
    // Act
    const write = () => writeDiff('level ten', { diffCompressionLevel: 10 })

    // Assert
    expect(write).toThrow(SHARP_COMPRESSION_ERROR)
  })
})
