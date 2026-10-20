import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { encodeWithPngjs, flatPattern, withRectangle } from './fixtures.ts'

const root = path.join(import.meta.dirname, '..')

const base = encodeWithPngjs(flatPattern(64, 48), { colorType: 6, bitDepth: 8 })
const changed = encodeWithPngjs(withRectangle(flatPattern(64, 48), 10, 12, 8, 4), { colorType: 6, bitDepth: 8 })

// JEST_MODULES / VITEST_MODULES point at a node_modules with another runner version,
// which is how CI checks every supported major. The repo's own runners are the default.
const RUNNERS = {
  jest: {
    modules: process.env.JEST_MODULES ?? path.join(root, 'node_modules'),
    fixture: path.join(root, 'test/integration/jest-project'),
    args: (modules: string, project: string, updateFlag: boolean) => [
      path.join(modules, 'jest/bin/jest.js'),
      '--config',
      path.join(project, 'jest.config.cjs'),
      '--ci=false',
      ...(updateFlag ? ['-u'] : []),
    ],
  },
  vitest: {
    modules: process.env.VITEST_MODULES ?? path.join(root, 'node_modules'),
    fixture: path.join(root, 'test/integration/vitest-project'),
    args: (modules: string, project: string, updateFlag: boolean) => [
      path.join(modules, 'vitest/vitest.mjs'),
      'run',
      '--config',
      path.join(project, 'vitest.config.mjs'),
      ...(updateFlag ? ['-u'] : []),
    ],
  },
}

type Runner = keyof typeof RUNNERS

const SEMVER_MAJOR = /(\d+)\.\d+\.\d+/

// INTEGRATION_RUNNERS=jest limits a CI job to the runner whose version it installed
const selectedRunners = (process.env.INTEGRATION_RUNNERS?.split(',') ?? Object.keys(RUNNERS)) as Runner[]

describe.each(selectedRunners)('in a real %s run', (runner) => {
  const { modules, fixture, args } = RUNNERS[runner]
  let directory: string
  let project: string
  const snapshotsDirectory = () => path.join(directory, 'snapshots')
  // The name depends on each runner's currentTestName format, so the single baseline is looked up
  const baselinePath = () => {
    const baselines = fs.readdirSync(snapshotsDirectory()).filter((file) => file.endsWith('-snap.png'))
    expect(baselines).toHaveLength(1)
    return path.join(snapshotsDirectory(), baselines[0])
  }

  const run = (
    image: Buffer,
    { update = false, env: extraEnv = {} }: { update?: boolean; env?: Record<string, string> } = {},
  ) => {
    const imagePath = path.join(directory, 'screenshot.png')
    fs.writeFileSync(imagePath, image)
    // Both runners stop writing new snapshots when they detect CI. Jest gets --ci=false,
    // Vitest 3 has no equivalent flag, so the variables it detects CI by are removed.
    const env = { ...process.env }
    delete env.CI
    delete env.GITHUB_ACTIONS
    const result = spawnSync(process.execPath, args(modules, project, update), {
      cwd: project,
      env: {
        ...env,
        PACKAGE_DIR: root,
        IMAGE_PATH: imagePath,
        SNAPSHOTS_DIR: snapshotsDirectory(),
        FORCE_COLOR: '0',
        ...extraEnv,
      },
      encoding: 'utf8',
    })
    return { status: result.status, output: result.stdout + result.stderr }
  }

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), `image-snapshot-${runner}-`))
    // The fixture runs from a copy whose node_modules is the runner under test, so its
    // imports of 'vitest' or Jest's own packages resolve to that version
    project = path.join(directory, 'project')
    fs.cpSync(fixture, project, {
      recursive: true,
      filter: (source) => path.basename(source) !== 'node_modules',
    })
    fs.symlinkSync(modules, path.join(project, 'node_modules'), 'junction')
  })

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  // CI sets this so a broken JEST_MODULES/VITEST_MODULES path can't silently fall back to the repo's runner
  test.runIf(process.env.EXPECTED_RUNNER_MAJOR)('runs the runner version CI asked for', () => {
    // Act
    const { stdout } = spawnSync(process.execPath, [args(modules, project, false)[0], '--version'], {
      encoding: 'utf8',
    })

    // Assert
    expect(SEMVER_MAJOR.exec(stdout)?.[1]).toBe(process.env.EXPECTED_RUNNER_MAJOR)
  })

  test('writes a baseline on the first run', () => {
    // Act
    const { status, output } = run(base)

    // Assert
    expect(status, output).toBe(0)
    expect(fs.readFileSync(baselinePath()).equals(base)).toBe(true)
  })

  test('passes when the screenshot is unchanged', () => {
    // Arrange
    run(base)

    // Act
    const { status, output } = run(base)

    // Assert
    expect(status, output).toBe(0)
  })

  test('fails with the pixel count and diff path when the screenshot changed', () => {
    // Arrange
    run(base)

    // Act
    const { status, output } = run(changed)

    // Assert
    expect(status).toBe(1)
    expect(output).toContain('(32 differing pixels)')
    expect(output).toContain('-snap-diff.png')
    expect(fs.readdirSync(path.join(snapshotsDirectory(), '__diff_output__'))).toHaveLength(1)
  })

  test('updates the baseline with -u', () => {
    // Arrange
    run(base)

    // Act
    const { status, output } = run(changed, { update: true })

    // Assert
    expect(status, output).toBe(0)
    expect(fs.readFileSync(baselinePath()).equals(changed)).toBe(true)
  })

  test('the outdated snapshot reporter deletes baselines no test touched', () => {
    // Arrange
    run(base)
    const current = baselinePath()
    const stale = path.join(snapshotsDirectory(), 'removed-test-1-snap.png')
    fs.writeFileSync(stale, base)

    // Act
    const { status, output } = run(base, { env: { JEST_IMAGE_SNAPSHOT_TRACK_OBSOLETE: '1' } })

    // Assert
    expect(status, output).toBe(0)
    expect(fs.existsSync(stale)).toBe(false)
    expect(fs.existsSync(current)).toBe(true)
  })

  test('the outdated snapshot reporter keeps everything when tracking is off', () => {
    // Arrange
    run(base)
    const stale = path.join(snapshotsDirectory(), 'removed-test-1-snap.png')
    fs.writeFileSync(stale, base)

    // Act
    run(base)

    // Assert
    expect(fs.existsSync(stale)).toBe(true)
  })
})

const vitestMajor = Number(
  SEMVER_MAJOR.exec(
    spawnSync(process.execPath, [RUNNERS.vitest.args(RUNNERS.vitest.modules, '', false)[0], '--version'], {
      encoding: 'utf8',
    }).stdout,
  )?.[1],
)

// Vitest 3 builds a custom matcher's `this` from the global expect's state, which holds the
// test that started last. Vitest 4 and 5 read the test from the assertion itself.
describe.runIf(selectedRunners.includes('vitest'))('in a real vitest run with test.concurrent', () => {
  const { modules, args } = RUNNERS.vitest
  const fixture = path.join(root, 'test/integration/vitest-concurrent-project')
  let directory: string
  let project: string
  const snapshotsDirectory = () => path.join(directory, 'snapshots')
  const snapshotFiles = () =>
    fs
      .readdirSync(snapshotsDirectory())
      .filter((file) => file.endsWith('-snap.png'))
      .toSorted()
  const readSnapshot = (suffix: string) => {
    const file = snapshotFiles().find((name) => name.endsWith(suffix))
    expect(file, `no snapshot ending with ${suffix} in ${snapshotFiles().join(', ')}`).toBeDefined()
    return fs.readFileSync(path.join(snapshotsDirectory(), file ?? ''))
  }

  const run = (matcher: 'sync' | 'async') => {
    const firstImagePath = path.join(directory, 'first.png')
    const secondImagePath = path.join(directory, 'second.png')
    fs.writeFileSync(firstImagePath, base)
    fs.writeFileSync(secondImagePath, changed)
    const env = { ...process.env }
    delete env.CI
    delete env.GITHUB_ACTIONS
    const result = spawnSync(process.execPath, args(modules, project, false), {
      cwd: project,
      env: {
        ...env,
        PACKAGE_DIR: root,
        FIRST_IMAGE_PATH: firstImagePath,
        SECOND_IMAGE_PATH: secondImagePath,
        SNAPSHOTS_DIR: snapshotsDirectory(),
        MATCHER: matcher,
        FORCE_COLOR: '0',
      },
      encoding: 'utf8',
    })
    return { status: result.status, output: result.stdout + result.stderr }
  }

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-snapshot-vitest-concurrent-'))
    project = path.join(directory, 'project')
    fs.cpSync(fixture, project, { recursive: true, filter: (source) => path.basename(source) !== 'node_modules' })
    fs.symlinkSync(modules, path.join(project, 'node_modules'), 'junction')
  })

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true })
  })

  test.runIf(vitestMajor >= 4).each(['sync', 'async'] as const)(
    'names each snapshot after the test that took it (%s matcher)',
    (matcher) => {
      // Act
      const { status, output } = run(matcher)

      // Assert
      expect(status, output).toBe(0)
      expect(readSnapshot('-first-1-snap.png').equals(base)).toBe(true)
      expect(readSnapshot('-second-1-snap.png').equals(changed)).toBe(true)
    },
  )

  // Documents the limitation the README describes, and fails if Vitest 3 ever changes it
  test.runIf(vitestMajor === 3).each(['sync', 'async'] as const)(
    'Vitest 3 names both snapshots after the test that started last (%s matcher)',
    (matcher) => {
      // Act
      const { status, output } = run(matcher)

      // Assert
      expect(status, output).toBe(0)
      expect(snapshotFiles().every((file) => file.includes('-second-'))).toBe(true)
      expect(snapshotFiles()).toHaveLength(2)
    },
  )
})
