import { createRequire } from 'node:module'
import { configureToMatchImageSnapshot } from '@brachkow/vitest-image-snapshot'
import original from 'jest-image-snapshot'
import { expect, test } from 'vitest'

const { runBench } = createRequire(import.meta.url)('../cases.cjs')

const IMPLEMENTATIONS = {
  'jest-image-snapshot': () => original.configureToMatchImageSnapshot(),
  'jest-image-snapshot runInProcess': () => original.configureToMatchImageSnapshot({ runInProcess: true }),
  '@brachkow/vitest-image-snapshot': () => configureToMatchImageSnapshot(),
}

const implementation = process.env.BENCH_IMPLEMENTATION

test('bench', () => runBench({ expect, implementation, createMatcher: IMPLEMENTATIONS[implementation] }))
