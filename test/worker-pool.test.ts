import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { configureToMatchImageSnapshot, configureToMatchImageSnapshotAsync } from '../src/index.ts'
import type { MatcherContext, SnapshotState } from '../src/index.ts'
import { createWorkerPool, resolvePoolSize } from '../src/worker-pool.ts'
import { encodeWithPngjs, flatPattern, withRectangle } from './fixtures.ts'

const asyncWorkerPath = path.join(import.meta.dirname, '../src/async-worker.ts')

const pattern = flatPattern(64, 48)
const base = encodeWithPngjs(pattern, { colorType: 6, bitDepth: 8 })
const changedImages = [1, 2, 3, 4, 5, 6].map((size) =>
  encodeWithPngjs(withRectangle(pattern, 4, 4, size, size), { colorType: 6, bitDepth: 8 }),
)

const createContext = (directory: string, currentTestName: string): MatcherContext => ({
  testPath: path.join(directory, 'pool.test.ts'),
  currentTestName,
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

describe('resolvePoolSize', () => {
  test('uses IMAGE_SNAPSHOT_WORKERS when it is a positive number', () => {
    // Act
    const size = resolvePoolSize('7')

    // Assert
    expect(size).toBe(7)
  })

  test.each(['0', '-2', 'many', undefined])('falls back to 1 to 4 workers for %s', (value) => {
    // Act
    const size = resolvePoolSize(value)

    // Assert
    expect(size).toBeGreaterThanOrEqual(1)
    expect(size).toBeLessThanOrEqual(4)
  })
})

describe('the async matcher with concurrent checks', () => {
  let directory: string

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-snapshot-pool-'))
  })

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  test('reports the same result for every check as the sync matcher', async () => {
    // Arrange
    const options = { customSnapshotsDir: directory, noColors: true }
    const sync = configureToMatchImageSnapshot(options)
    const async = configureToMatchImageSnapshotAsync(options)
    const names = changedImages.map((_image, index) => `check ${index}`)
    for (const name of names) {
      sync.call(createContext(directory, name), base)
    }

    // Act
    const results = await Promise.all(
      changedImages.map((image, index) => async.call(createContext(directory, names[index]), image)),
    )

    // Assert
    const expected = changedImages.map((image, index) => sync.call(createContext(directory, names[index]), image))
    expect(results.map((result) => result.message())).toEqual(expected.map((result) => result.message()))
    expect(results.every((result) => !result.pass)).toBe(true)
  })
})

describe('createWorkerPool', () => {
  let directory: string

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-snapshot-pool-'))
  })

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  const diffOptions = (snapshotIdentifier: string, receivedImageBuffer: Buffer) => ({
    receivedImageBuffer,
    snapshotIdentifier,
    snapshotsDirectory: directory,
    failureThreshold: 0,
    failureThresholdType: 'pixel' as const,
  })

  test('spreads concurrent diffs over at most its size in workers', async () => {
    // Arrange
    const pool = createWorkerPool(asyncWorkerPath, 2)
    const identifiers = changedImages.map((_image, index) => `image-${index}`)
    for (const identifier of identifiers) {
      fs.writeFileSync(path.join(directory, `${identifier}.png`), base)
    }

    // Act
    const results = await Promise.all(
      changedImages.map((image, index) => pool.run(diffOptions(identifiers[index], image))),
    )

    // Assert
    expect(pool.size).toBe(2)
    expect(results.map((result) => result.diffPixelCount)).toEqual([1, 4, 9, 16, 25, 36])
  })

  test('rejects with the error the diff threw', async () => {
    // Arrange
    const pool = createWorkerPool(asyncWorkerPath, 1)
    fs.writeFileSync(path.join(directory, 'broken.png'), base)

    // Act
    const run = pool.run(diffOptions('broken', Buffer.from('not a png')))

    // Assert
    await expect(run).rejects.toThrow('Invalid file signature')
  })
})
