import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { configureToMatchImageSnapshot, configureToMatchImageSnapshotAsync } from '../src/index.ts'
import type { MatcherContext, MatcherResult, SnapshotState } from '../src/index.ts'
import type { MatchImageSnapshotOptions } from '../src/types.ts'
import { reference, ReferencePNG } from './reference.ts'

export interface Step {
  received: Buffer | string
  options?: MatchImageSnapshotOptions
  testName?: string
  isNot?: boolean
  /** Continue the previous step's test run instead of starting a fresh one, e.g. a second snapshot in one test */
  sameRun?: boolean
  /** Overrides the scenario's update mode for this step's run */
  updateSnapshot?: SnapshotState['_updateSnapshot']
}

export interface Scenario {
  commonOptions?: MatchImageSnapshotOptions
  updateSnapshot?: SnapshotState['_updateSnapshot']
  /** Environment variables set while the scenario runs */
  env?: Record<string, string>
  /** Simulates jest.retryTimes(n), which Jest exposes through a global symbol */
  retryTimes?: number
  /** Options that need the scenario's temp directory, e.g. custom output directories */
  dirOptions?: (directory: string) => MatchImageSnapshotOptions
  steps: Step[]
}

type Implementation = typeof configureToMatchImageSnapshot

const createSnapshotState = (updateSnapshot: SnapshotState['_updateSnapshot']): SnapshotState => ({
  _counters: new Map(),
  _updateSnapshot: updateSnapshot,
  added: 0,
  updated: 0,
  matched: 0,
  unmatched: 0,
})

const decodePixels = (buffer: Buffer) => {
  const png = ReferencePNG.sync.read(buffer)
  return `${png.width}x${png.height}:${png.data.toString('base64')}`
}

const listFiles = (directory: string): string[] =>
  fs
    .readdirSync(directory, { recursive: true, encoding: 'utf8' })
    .filter((file) => fs.statSync(path.join(directory, file)).isFile())
    .toSorted()

// Diff images come from different PNG encoders, so they are compared by pixels.
// Everything else is copied from the received buffer and must match byte for byte.
const snapshotFiles = (directory: string) =>
  Object.fromEntries(
    listFiles(directory).map((file) => {
      const content = fs.readFileSync(path.join(directory, file))
      const isDiff = file.endsWith('-diff.png')
      return [file, isDiff ? decodePixels(content) : content.toString('base64')]
    }),
  )

const DATA_URI = /data:image\/png;base64,([\d+/=A-Za-z]+)/g
// iTerm's inline image escape sequence carries the file name and the PNG as bare base64
// eslint-disable-next-line no-control-regex -- the escape sequence ends with a BEL character
const ITERM_INLINE_IMAGE = /File=name=([\d+/=A-Za-z]+);inline=1;width=40:([\d+/=A-Za-z]+)\u0007/g

// Node appends the requiring files to "Cannot find module", which are internal paths
const REQUIRE_STACK = /\nRequire stack:[\S\s]*$/

const normalizeMessage = (message: string, directory: string) =>
  message
    .replace(REQUIRE_STACK, '')
    .replaceAll(directory, '<directory>')
    .replaceAll(DATA_URI, (_match, base64: string) => `<png ${decodePixels(Buffer.from(base64, 'base64'))}>`)
    .replaceAll(ITERM_INLINE_IMAGE, (_match, name: string, image: string) => {
      const fileName = Buffer.from(name, 'base64').toString().replaceAll(directory, '<directory>')
      return `File=name=${fileName};inline=1;width=40:<png ${decodePixels(Buffer.from(image, 'base64'))}>\u0007`
    })

const RETRY_TIMES = Symbol.for('RETRY_TIMES')

const applyEnvironment = (scenario: Scenario) => {
  const globals = globalThis as Record<symbol, unknown>
  const previousEnv = { ...process.env }
  Object.assign(process.env, scenario.env)
  if (scenario.retryTimes !== undefined) {
    globals[RETRY_TIMES] = scenario.retryTimes
  }
  return () => {
    process.env = previousEnv
    delete globals[RETRY_TIMES]
  }
}

const withEnvironment = <T>(scenario: Scenario, run: () => T): T => {
  const restore = applyEnvironment(scenario)
  try {
    return run()
  } finally {
    restore()
  }
}

// The environment has to stay in place until the last awaited step is done
const withEnvironmentAsync = async <T>(scenario: Scenario, run: () => Promise<T>): Promise<T> => {
  const restore = applyEnvironment(scenario)
  try {
    return await run()
  } finally {
    restore()
  }
}

export type Outcome = 'added' | 'updated' | 'pass' | 'fail' | 'error'

type Counters = Pick<SnapshotState, 'added' | 'updated' | 'matched' | 'unmatched'>

// Vitest's counters are objects that coerce to numbers, Number() reads both shapes
const readCounters = ({ added, updated, matched, unmatched }: SnapshotState): Counters => ({
  added: Number(added),
  updated: Number(updated),
  matched: Number(matched),
  unmatched: Number(unmatched),
})

const stepOutcome = (pass: boolean, before: Counters, after: Counters): Outcome => {
  if (!pass) {
    return 'fail'
  }
  if (after.added > before.added) {
    return 'added'
  }
  if (after.updated > before.updated) {
    return 'updated'
  }
  return 'pass'
}

const stepResult = (result: MatcherResult, before: Counters, snapshotState: SnapshotState, directory: string) => {
  const after = readCounters(snapshotState)
  return {
    outcome: stepOutcome(result.pass, before, after),
    pass: result.pass,
    message: normalizeMessage(result.message(), directory),
    counters: after,
  }
}

const stepError = (error: unknown, snapshotState: SnapshotState, directory: string) => ({
  outcome: 'error' as const,
  error: normalizeMessage((error as Error).message, directory),
  counters: readCounters(snapshotState),
})

// Each step is a new test run unless it continues the previous one
const createStepRunner = (scenario: Scenario, directory: string) => {
  let snapshotState = createSnapshotState('new')
  return (step: Step) => {
    if (!step.sameRun) {
      snapshotState = createSnapshotState(step.updateSnapshot ?? scenario.updateSnapshot ?? 'new')
    }
    const context: MatcherContext = {
      testPath: path.join(directory, 'example.test.ts'),
      currentTestName: step.testName ?? 'example test',
      isNot: step.isNot ?? false,
      snapshotState,
    }
    return { context, snapshotState, before: readCounters(snapshotState) }
  }
}

const createDirectory = () => fs.mkdtempSync(path.join(os.tmpdir(), 'image-snapshot-compat-'))

const matcherOptions = (scenario: Scenario, directory: string): MatchImageSnapshotOptions => ({
  noColors: true,
  ...scenario.commonOptions,
  ...scenario.dirOptions?.(directory),
})

export const runScenario = (implementation: Implementation, scenario: Scenario) =>
  withEnvironment(scenario, () => {
    const directory = createDirectory()
    try {
      const matcher = implementation(matcherOptions(scenario, directory))
      const prepareStep = createStepRunner(scenario, directory)
      const steps = scenario.steps.map((step) => {
        const { context, snapshotState, before } = prepareStep(step)
        try {
          return stepResult(matcher.call(context, step.received, step.options), before, snapshotState, directory)
        } catch (error) {
          return stepError(error, snapshotState, directory)
        }
      })
      return { steps, files: snapshotFiles(directory) }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

// Same steps through the async matcher, awaiting each check before the next one starts
export const runScenarioAsync = (scenario: Scenario) =>
  withEnvironmentAsync(scenario, async () => {
    const directory = createDirectory()
    try {
      const matcher = configureToMatchImageSnapshotAsync(matcherOptions(scenario, directory))
      const prepareStep = createStepRunner(scenario, directory)
      const steps = []
      for (const step of scenario.steps) {
        const { context, snapshotState, before } = prepareStep(step)
        try {
          // Steps share snapshot files and must run in order
          const result = await matcher.call(context, step.received, step.options)
          steps.push(stepResult(result, before, snapshotState, directory))
        } catch (error) {
          steps.push(stepError(error, snapshotState, directory))
        }
      }
      return { steps, files: snapshotFiles(directory) }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

export const runBoth = (scenario: Scenario) => ({
  actual: runScenario(configureToMatchImageSnapshot, scenario),
  expected: runScenario(
    (options) => reference.configureToMatchImageSnapshot({ ...options, runInProcess: true }),
    scenario,
  ),
})
