const original = require('jest-image-snapshot')
const replacement = require('@brachkow/vitest-image-snapshot')
const { runBench } = require('../cases.cjs')

const IMPLEMENTATIONS = {
  'jest-image-snapshot': () => original.configureToMatchImageSnapshot(),
  'jest-image-snapshot runInProcess': () => original.configureToMatchImageSnapshot({ runInProcess: true }),
  '@brachkow/vitest-image-snapshot': () => replacement.configureToMatchImageSnapshot(),
}

const implementation = process.env.BENCH_IMPLEMENTATION

test('bench', () => runBench({ expect, implementation, createMatcher: IMPLEMENTATIONS[implementation] }))
