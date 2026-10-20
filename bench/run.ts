// Compares jest-image-snapshot with this package under real Jest and Vitest runs.
// Usage: pnpm build && node bench/run.ts
import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const root = path.join(import.meta.dirname, '..')

const SIZES = { '1280x800': [1280, 800], '2560x1600': [2560, 1600], '1280x8000': [1280, 8000] } as const

// Flat UI blocks with noisy "text" rows, so PNG compression behaves like a real screenshot
const drawScreenshot = (width: number, height: number, changed: boolean): Buffer => {
  const data = Buffer.alloc(width * height * 4)
  let seed = 42
  // Linear congruential generator, so every run draws the same screenshot
  const random = () => (seed = (seed * 1_664_525 + 1_013_904_223) % 2 ** 32) / 2 ** 32
  for (let y = 0; y < height; y++) {
    const block = Math.floor(y / 120)
    const isTextRow = y % 120 > 20 && y % 120 < 90 && y % 6 < 4
    for (let x = 0; x < width; x++) {
      const index = (width * y + x) * 4
      const isInk = isTextRow && x > 40 && x < width - 200 && random() < 0.35
      const value = isInk ? 30 : 240 - (block % 4) * 20
      data[index] = value
      data[index + 1] = value
      data[index + 2] = value + (block % 3) * 5
      data[index + 3] = 255
    }
  }
  if (changed) {
    // A 200x40 button that changed color
    for (let y = 300; y < 340; y++) {
      for (let x = 100; x < 300; x++) {
        const index = (width * y + x) * 4
        data[index] = 220
        data[index + 1] = 40
        data[index + 2] = 40
      }
    }
  }
  return data
}

const writeFixtures = async (directory: string) => {
  for (const [name, [width, height]] of Object.entries(SIZES)) {
    const raw = { raw: { width, height, channels: 4 as const } }
    const original = drawScreenshot(width, height, false)
    await sharp(original, raw)
      .png()
      .toFile(path.join(directory, `${name}.png`))
    // Same pixels, different bytes: forces decoding instead of the identical-bytes check
    await sharp(original, raw)
      .png({ compressionLevel: 1, adaptiveFiltering: true })
      .toFile(path.join(directory, `${name}-reencoded.png`))
    await sharp(drawScreenshot(width, height, true), raw)
      .png()
      .toFile(path.join(directory, `${name}-changed.png`))
  }
}

const RUNNERS = {
  jest: [
    path.join(root, 'node_modules/jest/bin/jest.js'),
    '--config',
    path.join(root, 'bench/jest-project/jest.config.cjs'),
    '--ci=false',
  ],
  vitest: [
    path.join(root, 'node_modules/vitest/vitest.mjs'),
    'run',
    '--config',
    path.join(root, 'bench/vitest-project/vitest.config.mjs'),
  ],
}

const IMPLEMENTATIONS = ['jest-image-snapshot', 'jest-image-snapshot runInProcess', '@brachkow/vitest-image-snapshot']

interface Result {
  runner: string
  implementation: string
  size: string
  case: string
  ms: number
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'image-snapshot-bench-'))
const fixtures = path.join(work, 'fixtures')
fs.mkdirSync(fixtures)
await writeFixtures(fixtures)

const results: Result[] = []
for (const [runner, args] of Object.entries(RUNNERS)) {
  for (const implementation of IMPLEMENTATIONS) {
    const resultsFile = path.join(work, `${runner}-${implementation.replaceAll(/\W/g, '_')}.jsonl`)
    // CI changes the runners' defaults for writing new snapshots
    const env = { ...process.env }
    delete env.CI
    process.stderr.write(`${runner} / ${implementation}\n`)
    const run = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...env,
        BENCH_IMPLEMENTATION: implementation,
        BENCH_FIXTURES: fixtures,
        BENCH_SNAPSHOTS: path.join(work, `snapshots-${runner}-${implementation.replaceAll(/\W/g, '_')}`),
        BENCH_RESULTS: resultsFile,
      },
    })
    // Exit code is 1 by design: the failing case leaves unmatched snapshots behind
    if (!fs.existsSync(resultsFile)) {
      throw new Error(`${runner} / ${implementation} failed:\n${run.stdout}${run.stderr}`)
    }
    const rows = JSON.parse(fs.readFileSync(resultsFile).toString('utf8')) as Array<Omit<Result, 'runner'>>
    results.push(...rows.map((row) => ({ runner, ...row })))
  }
}
fs.rmSync(work, { recursive: true, force: true })

const print = (line: string) => process.stdout.write(`${line}\n`)

const format = (ms: number) => {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)} s`
  }
  if (ms < 1) {
    return '<1 ms'
  }
  return `${ms.toFixed(0)} ms`
}
// Sub-millisecond timings are too noisy for a meaningful ratio
const speedup = (original: number, ours: number) =>
  ours < 1 ? `>${Math.floor(original)}x` : `${(original / ours).toFixed(0)}x`
const lookup = (runner: string, implementation: string, size: string, name: string) =>
  results.find((r) => r.runner === runner && r.implementation === implementation && r.size === size && r.case === name)
    ?.ms ?? Number.NaN

for (const runner of Object.keys(RUNNERS)) {
  print(`\n### ${runner}\n`)
  print('| Case | Size | jest-image-snapshot | runInProcess | this package | Speedup vs default |')
  print('|---|---|---|---|---|---|')
  for (const name of new Set(results.map((r) => r.case))) {
    for (const size of Object.keys(SIZES)) {
      const [original, inProcess, ours] = IMPLEMENTATIONS.map((implementation) =>
        lookup(runner, implementation, size, name),
      )
      print(
        `| ${name} | ${size} | ${format(original)} | ${format(inProcess)} | ${format(ours)} | ${speedup(original, ours)} |`,
      )
    }
  }
}
