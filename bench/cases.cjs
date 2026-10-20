// Shared by the Jest and Vitest bench projects: times each toMatchImageSnapshot call
const fs = require('node:fs')
const path = require('node:path')
const { performance } = require('node:perf_hooks')

const REPEATS = 3
// Stops repeating a case once one call is this slow, so the bench finishes in minutes
const SLOW_CALL_MS = 5000

const SNAPSHOT_MISMATCH = /different from snapshot|same size as the snapshot/

// A snapshot mismatch is the point of the failing case, anything else is a broken run
const matchAllowingMismatch = (expect, image, options) => {
  try {
    expect(image).toMatchImageSnapshot(options)
  } catch (error) {
    if (!SNAPSHOT_MISMATCH.test(error.message)) {
      throw error
    }
  }
}

// createMatcher comes from each runner's project, so every runner loads its native build
const runBench = ({ expect, implementation, createMatcher }) => {
  const fixtures = process.env.BENCH_FIXTURES
  const snapshotsDirectory = process.env.BENCH_SNAPSHOTS
  expect.extend({ toMatchImageSnapshot: createMatcher() })
  const read = (name) => fs.readFileSync(path.join(fixtures, `${name}.png`))
  const results = []
  for (const size of ['1280x800', '2560x1600', '1280x8000']) {
    const options = { customSnapshotsDir: snapshotsDirectory, customSnapshotIdentifier: size }
    expect(read(size)).toMatchImageSnapshot(options)
    const cases = {
      'pass, identical bytes': read(size),
      'pass, same pixels re-encoded': read(`${size}-reencoded`),
      'fail, 200x40 area changed': read(`${size}-changed`),
    }
    for (const [name, image] of Object.entries(cases)) {
      const times = []
      for (let index = 0; index < REPEATS; index++) {
        const start = performance.now()
        matchAllowingMismatch(expect, image, options)
        times.push(performance.now() - start)
        if (times.at(-1) > SLOW_CALL_MS) {
          break
        }
      }
      results.push({ implementation, size, case: name, ms: Math.min(...times) })
    }
  }
  fs.appendFileSync(process.env.BENCH_RESULTS, `${JSON.stringify(results)}\n`)
}

module.exports = { runBench }
