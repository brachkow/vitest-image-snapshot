// Times toMatchImageSnapshot for the current source, the latest release and
// jest-image-snapshot in one process, so their ratios hold on any machine.
// Usage: pnpm bench. In CI, BENCH_MAX_REGRESSION fails the run when the current
// source is that many times slower than the release, and BENCH_REPORT gets a
// Markdown table.
//
// current and released are measured in interleaved rounds instead of one block
// each, so drift during the run (CPU clock, memory pressure, garbage collection)
// lands on both. The gate uses the median of the per-round ratios.
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { configureToMatchImageSnapshot as configureReleased } from 'vitest-image-snapshot-released'
import { configureToMatchImageSnapshot as configureCurrent } from '../src/index.ts'
import type { MatcherContext, MatchImageSnapshotOptions, SnapshotState } from '../src/index.ts'
import { reference } from '../test/reference.ts'
import { createScreenshots } from './screenshots.ts'
import type { Screenshots, Size } from './screenshots.ts'

const IMPLEMENTATIONS = {
  current: configureCurrent,
  // Not gated, shows what the opt-in comparison method costs next to pixelmatch
  'current (blazediff)': (options: MatchImageSnapshotOptions) =>
    configureCurrent({ ...options, comparisonMethod: 'blazediff' }),
  released: configureReleased,
  // The default 10 MB child process buffer is too small for a full-page diff, which
  // makes jest-image-snapshot throw ENOBUFS instead of reporting the failure
  'jest-image-snapshot': (options: MatchImageSnapshotOptions) =>
    reference.configureToMatchImageSnapshot({ ...options, maxChildProcessBufferSizeInBytes: 64 * 1024 * 1024 }),
}

type Implementation = keyof typeof IMPLEMENTATIONS

const BENCH_SIZES: Size[] = ['1280x800', '1280x8000']

const CASES = {
  'pass, identical bytes': (screenshots: Screenshots) => screenshots.original,
  'pass, same pixels re-encoded': (screenshots: Screenshots) => screenshots.reencoded,
  'fail, 200x40 area changed': (screenshots: Screenshots) => screenshots.changed,
}

type Case = keyof typeof CASES

// Untimed rounds first: they start each package's worker and warm up the JIT
const WARMUP_ROUNDS = 2
const GATED_ROUNDS = 21
// jest-image-snapshot is only a reference point and takes over a second per full-page failure
const REFERENCE_ROUNDS = 3
// Below this, a ratio between medians measures timer noise rather than code
const MIN_GATED_DIFFERENCE_MS = 1
const CASE_TIMEOUT_MS = 10 * 60 * 1000

const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const timeCall = (fn: () => unknown) => {
  const start = performance.now()
  fn()
  return performance.now() - start
}

const createSnapshotState = (): SnapshotState => ({
  _counters: new Map(),
  _updateSnapshot: 'new',
  added: 0,
  updated: 0,
  matched: 0,
  unmatched: 0,
})

interface Row {
  size: Size
  case: Case
  medians: Record<Implementation, number>
  /** Median of current / released over the interleaved rounds */
  ratio: number
}

const rows: Row[] = []
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-snapshot-bench-'))
const screenshots = new Map<Size, Screenshots>()

const screenshotsFor = (size: Size): Screenshots => {
  const found = screenshots.get(size)
  if (!found) {
    throw new Error(`No screenshots generated for ${size}`)
  }
  return found
}

// One matcher per implementation and size, each with a baseline already on disk
const createMatcher = (implementation: Implementation, size: Size) => {
  const matcher = IMPLEMENTATIONS[implementation]({
    customSnapshotsDir: path.join(directory, implementation),
    customSnapshotIdentifier: size,
    noColors: true,
  })
  const context: MatcherContext = {
    testPath: path.join(directory, 'matcher.bench.ts'),
    currentTestName: size,
    isNot: false,
    snapshotState: createSnapshotState(),
  }
  matcher.call(context, screenshotsFor(size).original)
  return (image: Buffer) => matcher.call(context, image)
}

beforeAll(async () => {
  for (const size of BENCH_SIZES) {
    screenshots.set(size, await createScreenshots(size))
  }
})

afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true })
  if (process.env.BENCH_REPORT) {
    fs.writeFileSync(process.env.BENCH_REPORT, formatReport(rows))
  }
})

const formatMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(1)} ms`)

const formatRow = (cells: string[]) => `| ${cells.join(' | ')} |`

const formatReport = (reportRows: Row[]) =>
  [
    formatRow([
      'Case',
      'Size',
      'current',
      'current (blazediff)',
      'released',
      'jest-image-snapshot',
      'current / released',
    ]),
    formatRow(Array.from<string>({ length: 7 }).fill('---')),
    ...reportRows.map(({ size, case: name, medians, ratio }) =>
      formatRow([
        name,
        size,
        formatMs(medians.current),
        formatMs(medians['current (blazediff)']),
        formatMs(medians.released),
        formatMs(medians['jest-image-snapshot']),
        `${ratio.toFixed(2)}x`,
      ]),
    ),
    '',
    `Median time per toMatchImageSnapshot call. current, current (blazediff) and released: ${GATED_ROUNDS} interleaved rounds, the last column is the median of their per-round ratios. jest-image-snapshot: ${REFERENCE_ROUNDS} calls.`,
    '',
  ].join('\n')

describe.each(BENCH_SIZES)('%s', (size) => {
  test.each(Object.keys(CASES) as Case[])(
    '%s',
    (name) => {
      const image = CASES[name](screenshotsFor(size))
      const run = Object.fromEntries(
        (Object.keys(IMPLEMENTATIONS) as Implementation[]).map((implementation) => [
          implementation,
          createMatcher(implementation, size),
        ]),
      ) as Record<Implementation, (image: Buffer) => unknown>

      const interleaved = ['current', 'current (blazediff)', 'released'] as const
      for (let round = 0; round < WARMUP_ROUNDS; round++) {
        for (const implementation of interleaved) {
          run[implementation](image)
        }
      }
      const times = { current: [] as number[], 'current (blazediff)': [] as number[], released: [] as number[] }
      const ratios: number[] = []
      for (let round = 0; round < GATED_ROUNDS; round++) {
        // Rotate the starting implementation, so none always runs right after another
        const order = interleaved.map((_name, index) => interleaved[(index + round) % interleaved.length])
        const roundTimes = { current: 0, 'current (blazediff)': 0, released: 0 }
        for (const implementation of order) {
          roundTimes[implementation] = timeCall(() => run[implementation](image))
        }
        for (const implementation of interleaved) {
          times[implementation].push(roundTimes[implementation])
        }
        ratios.push(roundTimes.current / roundTimes.released)
      }
      const referenceTimes = Array.from({ length: REFERENCE_ROUNDS }, () =>
        timeCall(() => run['jest-image-snapshot'](image)),
      )

      const medians = {
        current: median(times.current),
        'current (blazediff)': median(times['current (blazediff)']),
        released: median(times.released),
        'jest-image-snapshot': median(referenceTimes),
      }
      const ratio = median(ratios)
      rows.push({ size, case: name, medians, ratio })

      const maxRegression = Number(process.env.BENCH_MAX_REGRESSION)
      if (maxRegression && medians.current - medians.released > MIN_GATED_DIFFERENCE_MS) {
        expect(ratio).toBeLessThanOrEqual(maxRegression)
      }
    },
    CASE_TIMEOUT_MS,
  )
})
