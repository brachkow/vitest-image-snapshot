// Compares jest-image-snapshot with this package under real Jest and Vitest runs,
// which produces the README tables. Usage: pnpm bench:runners
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createScreenshots, SIZES } from './screenshots.ts'
import type { Size } from './screenshots.ts'

const root = path.join(import.meta.dirname, '..')

const writeFixtures = async (directory: string) => {
  for (const size of Object.keys(SIZES) as Size[]) {
    const { original, reencoded, changed } = await createScreenshots(size)
    fs.writeFileSync(path.join(directory, `${size}.png`), original)
    fs.writeFileSync(path.join(directory, `${size}-reencoded.png`), reencoded)
    fs.writeFileSync(path.join(directory, `${size}-changed.png`), changed)
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
    // Both runners stop writing new snapshots when they detect CI
    const env = { ...process.env }
    delete env.CI
    delete env.GITHUB_ACTIONS
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
