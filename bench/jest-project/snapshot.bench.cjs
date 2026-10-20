const original = require('jest-image-snapshot')
const replacement = require('@brachkow/vitest-image-snapshot')
const { runBench } = require('../cases.cjs')

// The default 10 MB child process buffer is too small for a full-page diff, which
// makes jest-image-snapshot throw ENOBUFS instead of reporting the failure
const CHILD_PROCESS_BUFFER = 64 * 1024 * 1024

const IMPLEMENTATIONS = {
  'jest-image-snapshot': () =>
    original.configureToMatchImageSnapshot({ maxChildProcessBufferSizeInBytes: CHILD_PROCESS_BUFFER }),
  'jest-image-snapshot runInProcess': () => original.configureToMatchImageSnapshot({ runInProcess: true }),
  '@brachkow/vitest-image-snapshot': () => replacement.configureToMatchImageSnapshot(),
}

const implementation = process.env.BENCH_IMPLEMENTATION

test('bench', () => runBench({ expect, implementation, createMatcher: IMPLEMENTATIONS[implementation] }))
