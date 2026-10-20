import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, describe, expect, test } from 'vitest'
import { runBoth } from './compat.ts'
import type { Outcome, Scenario } from './compat.ts'
import { encodePalette, encodeWithPngjs, flatPattern, withRectangle } from './fixtures.ts'
import type { PixelPattern } from './fixtures.ts'

const WIDTH = 120
const HEIGHT = 80
const HALF_TRANSPARENT_ORANGE = [230, 120, 40, 128]

const png = (pattern: PixelPattern) => encodeWithPngjs(pattern, { colorType: 6, bitDepth: 8 })

const basePattern = flatPattern(WIDTH, HEIGHT)
const base = png(basePattern)
// Rows 32-36 sit between stripes, so exactly 10 x 5 = 50 pixels change
const CHANGED_PIXELS = 50
const changed = png(withRectangle(basePattern, 20, 32, 10, 5))
const larger = png(flatPattern(WIDTH + 7, HEIGHT + 3))
const translucentPattern = flatPattern(WIDTH, HEIGHT, HALF_TRANSPARENT_ORANGE)
const translucent = png(translucentPattern)
const translucentChanged = png(withRectangle(translucentPattern, 5, 2, 4, 4))
const reencodedBase = encodeWithPngjs(basePattern, { colorType: 2, bitDepth: 8 })
const jpeg = await sharp(basePattern.data, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } })
  .jpeg()
  .toBuffer()

const hooksDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-snapshot-hooks-'))
const hooksPath = path.join(hooksDirectory, 'hooks.cjs')
fs.writeFileSync(
  hooksPath,
  String.raw`const fs = require('node:fs')
const path = require('node:path')
module.exports = {
  onBeforeWriteToDisc: ({ buffer, destination, currentTestName }) => {
    fs.appendFileSync(path.join(path.dirname(destination), 'hook.log'), path.basename(destination) + ' ' + currentTestName + '\n')
    return buffer
  },
}
`,
)
const throwingHooksPath = path.join(hooksDirectory, 'throwing-hooks.cjs')
fs.writeFileSync(throwingHooksPath, `module.exports = { onBeforeWriteToDisc: () => { throw new Error('boom') } }`)

afterAll(() => fs.rmSync(hooksDirectory, { recursive: true, force: true }))

type DocumentedScenario = Scenario & { outcomes: Outcome[] }

const scenarios: Record<string, DocumentedScenario> = {
  'writes a new baseline': { steps: [{ received: base }], outcomes: ['added'] },
  'passes when bytes are identical': { steps: [{ received: base }, { received: base }], outcomes: ['added', 'pass'] },
  'passes when pixels match but PNG encoding differs': {
    steps: [{ received: base }, { received: reencodedBase }],
    outcomes: ['added', 'pass'],
  },
  'fails on a changed area and writes the diff image': {
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'fails on changes in semi-transparent images': {
    steps: [{ received: translucent }, { received: translucentChanged }],
    outcomes: ['added', 'fail'],
  },
  'passes when changed pixels equal the pixel threshold': {
    commonOptions: { failureThreshold: CHANGED_PIXELS },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'pass'],
  },
  'fails when changed pixels exceed the pixel threshold by one': {
    commonOptions: { failureThreshold: CHANGED_PIXELS - 1 },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'passes under a percent threshold': {
    commonOptions: { failureThreshold: 0.01, failureThresholdType: 'percent' },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'pass'],
  },
  'fails over a percent threshold': {
    commonOptions: { failureThreshold: 0.001, failureThresholdType: 'percent' },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'throws on an unknown threshold type': {
    commonOptions: { failureThresholdType: 'pixels' as 'pixel' },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'error'],
  },
  'throws on an unknown threshold type even for identical images': {
    commonOptions: { failureThresholdType: 'pixels' as 'pixel' },
    steps: [{ received: base }, { received: base }],
    outcomes: ['added', 'error'],
  },
  'fails on a size mismatch': { steps: [{ received: base }, { received: larger }], outcomes: ['added', 'fail'] },
  'checks the threshold on a size mismatch when allowSizeMismatch is set': {
    commonOptions: { allowSizeMismatch: true },
    steps: [{ received: base }, { received: larger }],
    outcomes: ['added', 'fail'],
  },
  'passes a size mismatch within the threshold when allowSizeMismatch is set': {
    commonOptions: { allowSizeMismatch: true, failureThreshold: 0.9, failureThresholdType: 'percent' },
    steps: [{ received: base }, { received: larger }],
    outcomes: ['added', 'pass'],
  },
  'ignores an unknown threshold type on a disallowed size mismatch': {
    commonOptions: { failureThresholdType: 'pixels' as 'pixel' },
    steps: [{ received: base }, { received: larger }],
    outcomes: ['added', 'fail'],
  },
  'stacks the diff vertically': {
    commonOptions: { diffDirection: 'vertical' },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'writes only the diff panel with onlyDiff': {
    commonOptions: { onlyDiff: true },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'blurs both images before comparing': {
    commonOptions: { blur: 2 },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'applies customDiffConfig to pixelmatch': {
    commonOptions: { customDiffConfig: { threshold: 0.5, includeAA: true, diffColor: [0, 0, 255] } },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'compares with SSIM': {
    commonOptions: { comparisonMethod: 'ssim' },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'compares identical images with SSIM': {
    commonOptions: { comparisonMethod: 'ssim' },
    steps: [{ received: base }, { received: base }],
    outcomes: ['added', 'pass'],
  },
  'compares re-encoded identical images with SSIM': {
    commonOptions: { comparisonMethod: 'ssim' },
    steps: [{ received: base }, { received: reencodedBase }],
    outcomes: ['added', 'pass'],
  },
  'compares with the SSIM fast preset': {
    commonOptions: { comparisonMethod: 'ssim', customDiffConfig: { ssim: 'fast' } },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'stores the received image on failure': {
    commonOptions: { storeReceivedOnFailure: true },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'removes stale received and diff files once the image matches again': {
    commonOptions: { storeReceivedOnFailure: true },
    steps: [{ received: base }, { received: changed }, { received: base }],
    outcomes: ['added', 'fail', 'pass'],
  },
  'uses custom directories and postfix': {
    commonOptions: { storeReceivedOnFailure: true, customReceivedPostfix: '-actual' },
    dirOptions: (directory) => ({
      customSnapshotsDir: path.join(directory, 'baselines'),
      customDiffDir: path.join(directory, 'diffs'),
      customReceivedDir: path.join(directory, 'received'),
    }),
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'uses a string customSnapshotIdentifier': {
    commonOptions: { customSnapshotIdentifier: 'my-button' },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'uses a function customSnapshotIdentifier': {
    commonOptions: {
      customSnapshotIdentifier: ({ currentTestName, counter, defaultIdentifier }) =>
        `${currentTestName}__${counter}__${defaultIdentifier}`,
    },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'falls back to the default identifier when the function returns nothing': {
    commonOptions: { customSnapshotIdentifier: () => '' },
    steps: [{ received: base }],
    outcomes: ['added'],
  },
  'numbers several snapshots in one test': {
    steps: [{ received: base }, { received: changed, sameRun: true }, { received: larger, sameRun: true }],
    outcomes: ['added', 'added', 'added'],
  },
  'compares each numbered snapshot in a later run': {
    steps: [
      { received: base },
      { received: changed, sameRun: true },
      { received: changed },
      { received: changed, sameRun: true },
    ],
    outcomes: ['added', 'added', 'fail', 'pass'],
  },
  'kebab-cases unusual test names': {
    steps: [
      { received: base, testName: 'Button > renders "primary" state' },
      { received: base, testName: 'ünïcödé 名前 with  spaces_and-dashes' },
      { received: base, testName: 'camelCaseName42 HTTPServer' },
      { received: base, testName: "it's 100% done!" },
    ],
    outcomes: ['added', 'added', 'added', 'added'],
  },
  'accepts a base64 string': {
    steps: [{ received: base.toString('base64') }, { received: changed.toString('base64') }],
    outcomes: ['added', 'fail'],
  },
  'updates a failing baseline in update mode': {
    updateSnapshot: 'all',
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'updated'],
  },
  'keeps a passing baseline in update mode': {
    updateSnapshot: 'all',
    commonOptions: { failureThreshold: 100 },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'pass'],
  },
  'rewrites a passing baseline with updatePassedSnapshot': {
    updateSnapshot: 'all',
    commonOptions: { failureThreshold: 100, updatePassedSnapshot: true },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'updated'],
  },
  'rewrites an identical baseline with updatePassedSnapshot': {
    updateSnapshot: 'all',
    commonOptions: { updatePassedSnapshot: true },
    steps: [{ received: base }, { received: base }],
    outcomes: ['added', 'updated'],
  },
  'refuses to write a new baseline in CI mode': {
    updateSnapshot: 'none',
    steps: [{ received: base }],
    outcomes: ['fail'],
  },
  'compares against an existing baseline in CI mode': {
    updateSnapshot: 'none',
    steps: [{ received: base, updateSnapshot: 'new' }, { received: changed }, { received: base }],
    outcomes: ['added', 'fail', 'pass'],
  },
  'runs runtime hooks for every written file': {
    commonOptions: { runtimeHooksPath: hooksPath, storeReceivedOnFailure: true },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'reports a throwing runtime hook': {
    commonOptions: { runtimeHooksPath: throwingHooksPath },
    steps: [{ received: base }],
    outcomes: ['error'],
  },
  'reports a missing runtime hooks file': {
    commonOptions: { runtimeHooksPath: path.join(hooksDirectory, 'missing.cjs') },
    steps: [{ received: base }],
    outcomes: ['error'],
  },
  'throws on a received image that is not a PNG': {
    steps: [{ received: base }, { received: jpeg }],
    outcomes: ['added', 'error'],
  },
  'throws on an identical baseline that is not a PNG': {
    steps: [{ received: jpeg }, { received: jpeg }],
    outcomes: ['added', 'error'],
  },
  'removes stale outputs before rejecting a non-PNG image': {
    commonOptions: { storeReceivedOnFailure: true },
    steps: [{ received: base }, { received: changed }, { received: jpeg, updateSnapshot: 'all' }],
    outcomes: ['added', 'fail', 'error'],
  },
  'throws when used with .not': {
    steps: [{ received: base, isNot: true }],
    outcomes: ['error'],
  },
  'requires a customSnapshotIdentifier when retries are on': {
    retryTimes: 2,
    steps: [{ received: base }],
    outcomes: ['error'],
  },
  'counts a retried failure as unmatched only after the last retry': {
    retryTimes: 2,
    commonOptions: { customSnapshotIdentifier: 'retried' },
    steps: [
      { received: base },
      { received: changed },
      { received: changed, sameRun: true },
      { received: changed, sameRun: true },
    ],
    outcomes: ['added', 'fail', 'fail', 'fail'],
  },
  'dumps the diff inline for iTerm': {
    env: { TERM_PROGRAM: 'iTerm.app' },
    commonOptions: { dumpInlineDiffToConsole: true },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'falls back to a data URI when the terminal cannot show images inline': {
    env: { TERM_PROGRAM: 'Apple_Terminal' },
    commonOptions: { dumpInlineDiffToConsole: true },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'dumps the diff as a data URI': {
    commonOptions: { dumpDiffToConsole: true },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'colors the failure message when noColors is false': {
    commonOptions: { noColors: false },
    steps: [{ received: base }, { received: changed }],
    outcomes: ['added', 'fail'],
  },
  'colors the CI message when noColors is false': {
    updateSnapshot: 'none',
    commonOptions: { noColors: false },
    steps: [{ received: base }],
    outcomes: ['fail'],
  },
}

describe('behaves exactly like jest-image-snapshot 6.5.2', () => {
  test.each(Object.entries(scenarios))('%s', (_name, scenario) => {
    // Arrange
    const { outcomes, ...steps } = scenario

    // Act
    const { actual, expected } = runBoth(steps)

    // Assert
    expect(expected.steps.map((step) => step.outcome)).toEqual(outcomes)
    expect(actual).toEqual(expected)
  })

  test('compares a palette-encoded baseline by pixels against an RGBA screenshot', async () => {
    // Arrange
    const palette = await encodePalette(basePattern, 256)

    // Act
    const { actual, expected } = runBoth({ steps: [{ received: palette }, { received: base }] })

    // Assert
    expect(expected.steps.map((step) => step.outcome)).toEqual(['added', 'pass'])
    expect(actual).toEqual(expected)
  })
})
