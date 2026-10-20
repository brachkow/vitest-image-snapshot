import { createRequire } from 'node:module'
import { configureToMatchImageSnapshot } from '@brachkow/vitest-image-snapshot'
import original from 'jest-image-snapshot'
import { expect, test } from 'vitest'

const { runBench } = createRequire(import.meta.url)('../cases.cjs')

// The default 10 MB child process buffer is too small for a full-page diff, which
// makes jest-image-snapshot throw ENOBUFS instead of reporting the failure
const CHILD_PROCESS_BUFFER = 64 * 1024 * 1024

const IMPLEMENTATIONS = {
  'jest-image-snapshot': () =>
    original.configureToMatchImageSnapshot({ maxChildProcessBufferSizeInBytes: CHILD_PROCESS_BUFFER }),
  'jest-image-snapshot runInProcess': () => original.configureToMatchImageSnapshot({ runInProcess: true }),
  '@brachkow/vitest-image-snapshot': () => configureToMatchImageSnapshot(),
}

const implementation = process.env.BENCH_IMPLEMENTATION

test('bench', () => runBench({ expect, implementation, createMatcher: IMPLEMENTATIONS[implementation] }))
