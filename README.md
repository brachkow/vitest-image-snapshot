# @brachkow/vitest-image-snapshot

A drop-in replacement for [jest-image-snapshot](https://github.com/americanexpress/jest-image-snapshot) 6.5.2 that works in Vitest and Jest. It produces the same snapshot file names, pass/fail results, pixel counts and failure messages, and is 2 to 9 times faster when images need decoding.

## Install

```sh
pnpm i -D @brachkow/vitest-image-snapshot
```

Requires Node 22.13 or newer. PNG work runs on [sharp](https://sharp.pixelplumbing.com), which installs a prebuilt native binary for your platform.

## Usage

The API is the same as jest-image-snapshot. Replace the import and keep your tests and baselines.

```js
// Vitest
import { expect } from 'vitest'
import { toMatchImageSnapshot } from '@brachkow/vitest-image-snapshot'

expect.extend({ toMatchImageSnapshot })

test('renders the button', async () => {
  const image = await page.screenshot()
  expect(image).toMatchImageSnapshot()
})
```

```js
// Jest
const { toMatchImageSnapshot } = require('@brachkow/vitest-image-snapshot')

expect.extend({ toMatchImageSnapshot })
```

The matcher is synchronous, so no `await` is needed, same as before. Every jest-image-snapshot option works: `failureThreshold`, `failureThresholdType`, `customDiffConfig`, `comparisonMethod: 'ssim'`, `blur`, `allowSizeMismatch`, `customSnapshotIdentifier`, `customSnapshotsDir`, `customDiffDir`, `storeReceivedOnFailure`, `runtimeHooksPath`, `dumpDiffToConsole` and the rest. See the [jest-image-snapshot option list](https://github.com/americanexpress/jest-image-snapshot#optional-configuration).

### TypeScript

Jest projects that use `@types/jest-image-snapshot` keep working, because those types extend Jest's global `jest.Matchers`. For Vitest 5, add this to a `.d.ts` file in your project:

```ts
import type { MatchImageSnapshotOptions } from '@brachkow/vitest-image-snapshot'

declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toMatchImageSnapshot: (options?: MatchImageSnapshotOptions) => R
  }
}
```

### Removing obsolete snapshots

The reporter that deletes unused `*-snap.png` files works in both runners. Run with `JEST_IMAGE_SNAPSHOT_TRACK_OBSOLETE=1`.

```js
// jest.config.js
reporters: ['default', '@brachkow/vitest-image-snapshot/outdated-snapshot-reporter']
```

```js
// vitest.config.js
import OutdatedSnapshotReporter from '@brachkow/vitest-image-snapshot/outdated-snapshot-reporter'

export default defineConfig({ test: { reporters: ['default', new OutdatedSnapshotReporter()] } })
```

## Why it is faster

Profiling jest-image-snapshot showed three costs:

1. About 80% of each check is spent decoding and encoding PNGs with pngjs, which runs in plain JavaScript.
2. By default every check spawns a new Node process, which adds about 50 ms.
3. With `runInProcess: true` under Jest, the PNG encoder calls `Math.abs` about 12 million times per diff image. Jest runs modules inside a `vm` context where global lookups are about 240 times slower, so a failing full-page check takes about a minute.

This package changes the following:

- If the screenshot is byte-identical to the baseline, it passes without decoding anything. In a passing CI run this is the usual case, and it takes under 1 ms.
- Otherwise the comparison runs in one worker thread per test file. The test thread calls it synchronously through [synckit](https://github.com/un-ts/synckit). The worker is plain Node, so Jest's sandbox doesn't slow it down. Starting the worker costs about 100 ms once per test file, and only if a check in that file needs decoding.
- sharp decodes and encodes PNGs natively. Decoding a 1280×8000 screenshot takes 30 to 50 ms instead of 160 ms.
- Diff images are written with zlib level 1, which is 4 to 5 times faster than the default level. The files are about 20% larger than jest-image-snapshot's.

## Benchmark

Time per `toMatchImageSnapshot` call, on an Apple M1 Pro with Node 24, Jest 30.5 and Vitest 5.0. The images are generated screenshots with flat blocks and text-like rows. Each case is the fastest of 3 calls. The code is in [`bench/`](bench), and `pnpm bench` reproduces the tables.

### Jest

| Case | Size | jest-image-snapshot | runInProcess | this package | Speedup vs default |
|---|---|---|---|---|---|
| pass, identical bytes | 1280x800 | 82 ms | 30 ms | <1 ms | >81x |
| pass, identical bytes | 2560x1600 | 156 ms | 122 ms | <1 ms | >155x |
| pass, identical bytes | 1280x8000 | 295 ms | 265 ms | <1 ms | >294x |
| pass, same pixels re-encoded | 1280x800 | 90 ms | 51 ms | 10 ms | 9x |
| pass, same pixels re-encoded | 2560x1600 | 199 ms | 218 ms | 91 ms | 2x |
| pass, same pixels re-encoded | 1280x8000 | 422 ms | 494 ms | 122 ms | 3x |
| fail, 200x40 area changed | 1280x800 | 174 ms | 5.5 s | 32 ms | 5x |
| fail, 200x40 area changed | 2560x1600 | 502 ms | 21.8 s | 135 ms | 4x |
| fail, 200x40 area changed | 1280x8000 | 1.1 s | 55.4 s | 239 ms | 5x |

### Vitest

| Case | Size | jest-image-snapshot | runInProcess | this package | Speedup vs default |
|---|---|---|---|---|---|
| pass, identical bytes | 1280x800 | 77 ms | 30 ms | <1 ms | >77x |
| pass, identical bytes | 2560x1600 | 148 ms | 107 ms | <1 ms | >148x |
| pass, identical bytes | 1280x8000 | 291 ms | 267 ms | <1 ms | >291x |
| pass, same pixels re-encoded | 1280x800 | 89 ms | 33 ms | 10 ms | 9x |
| pass, same pixels re-encoded | 2560x1600 | 205 ms | 136 ms | 54 ms | 4x |
| pass, same pixels re-encoded | 1280x8000 | 417 ms | 339 ms | 102 ms | 4x |
| fail, 200x40 area changed | 1280x800 | 169 ms | 118 ms | 28 ms | 6x |
| fail, 200x40 area changed | 2560x1600 | 519 ms | 406 ms | 109 ms | 5x |
| fail, 200x40 area changed | 1280x8000 | 1.2 s | 1.0 s | 241 ms | 5x |

## Compatibility

Three kinds of tests check that this package behaves like jest-image-snapshot 6.5.2.

**The original test suite.** [`test/original`](test/original) holds jest-image-snapshot's own integration spec, with its stub images and baselines, run against this package with `pnpm test:original`. All 25 tests pass. The same spec also passes against jest-image-snapshot itself (`IMAGE_SNAPSHOT_IMPLEMENTATION=original`), which shows the copy is still a valid test. Three changes were needed, listed at the top of the file: the import, comparing the `onlyDiff` image by pixels instead of PNG bytes, and a fix for a TypedArray test that fails on Node 22 and newer for jest-image-snapshot too. The other original spec files mock internals such as `child_process` and the `diff-snapshot` module, which this package does not have, so they are not included.

**Side-by-side scenarios.** The Vitest suite runs jest-image-snapshot 6.5.2 and this package on the same inputs, across 54 scenarios. It checks that they return the same pass/fail result, message and snapshot counters, write the same files with byte-identical baselines, and produce pixel-identical diff images. The scenarios cover every option, update and CI modes, size mismatches, SSIM, blur, retries, runtime hooks, console dumps and non-PNG input. Decoding matches pngjs byte for byte across PNG color types, 16-bit images, palettes, interlacing, transparency chunks and embedded color profiles.

**Real runners.** Integration tests run real Jest and Vitest processes against the built package. CI runs them on Jest 29 and 30 and Vitest 3, 4 and 5, each installed from its own lockfile in [`test/runners`](test/runners). The full suite also runs on Linux, macOS and Windows with Node 22 and 24.

Known differences:

- `runInProcess` and `maxChildProcessBufferSizeInBytes` are accepted but do nothing, since there is no child process.
- A corrupted PNG throws in both packages, but the error message comes from libpng instead of pngjs, for example `vipspng: libpng read error` instead of `Unrecognised filter type - 104`.
- Diff images are encoded differently, so their bytes differ from jest-image-snapshot's, but their pixels are identical.
- pixelmatch stays pinned to 5.x, the version jest-image-snapshot uses. pixelmatch 7 and 8 changed how they count differing pixels, which would flip existing thresholds.

## Development

```sh
pnpm install
pnpm test            # unit, side-by-side and integration tests
pnpm test:original   # jest-image-snapshot's own spec against this package
pnpm lint
pnpm typecheck
pnpm bench           # benchmark tables from the README
```

Integration tests can target another runner version: install it with `pnpm --dir test/runners/vitest-3 install`, then run `pnpm vitest run test/integration.test.ts` with `INTEGRATION_RUNNERS=vitest` and `VITEST_MODULES` (or `JEST_MODULES`) pointing at that directory's `node_modules`.

## License

Apache-2.0. Derived from jest-image-snapshot by American Express. See [NOTICE](NOTICE).
