# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@brachkow/vitest-image-snapshot` is a fast drop-in replacement for jest-image-snapshot 6.5.2 that works in Vitest and Jest. The goal is identical observable behavior: snapshot file names, pass/fail results, pixel counts, failure messages, snapshot counters and written files. Anything that changes those for existing users is a compatibility break, even when it looks like an improvement. New behavior goes behind an opt-in option, as `comparisonMethod: 'blazediff'` does.

Code is derived from jest-image-snapshot under Apache-2.0. Files ported from it keep the American Express copyright header plus a note on what changed, and `NOTICE` credits the original.

## Commands

Tools come from `mise.toml`, which pins Node 24 and pnpm 11. Run commands through `mise exec --` if they aren't on PATH.

```sh
pnpm test                                          # all Vitest tests (unit, side-by-side, integration)
pnpm vitest run test/compat.test.ts -t "ssim"      # one file, filtered by test name
pnpm test:original                                 # jest-image-snapshot's own spec, run with Jest
pnpm lint                                          # eslint-config-fans with Prettier
pnpm typecheck                                     # tsc --noEmit (TypeScript 7)
pnpm build                                         # tsdown to dist/
pnpm bench                                         # current source vs latest release vs jest-image-snapshot
pnpm bench:runners                                 # README tables, in real Jest and Vitest processes
```

`pnpm test` rebuilds `dist/` first through `test/build.global-setup.ts`, because the integration tests load the built package.

## Architecture

The matcher must stay synchronous (`expect(x).toMatchImageSnapshot()` with no `await`), but sharp is async-only. The work is split across two threads:

- **Main thread.** `src/index.ts` and `src/run-diff.ts` do the Jest and Vitest bookkeeping: the snapshot identifier, `snapshotState` counters and messages. Then they compare the received PNG's bytes with the baseline file. Identical bytes pass here without loading sharp or starting the worker. This module must not import sharp or the image code.
- **Worker thread.** `src/worker.ts` calls `src/diff-snapshot.ts`, which uses `src/image.ts` to decode with sharp, align sizes, blur when asked, compare, and compose and encode the 3-panel diff. `synckit` calls the worker synchronously and starts it on first use. It runs in plain Node, outside Jest's `vm` sandbox, where global lookups such as `Math.abs` are about 240 times slower.
- `src/run-diff.ts` loads `worker.ts` when running from source, which Vitest does directly, and `worker.mjs` from `dist/`. The CJS build gets `import.meta.url` through tsdown's `shims`.
- `toMatchImageSnapshotAsync` is the opt-in exception. `src/index.ts` runs the same synchronous bookkeeping for both matchers (`configureMatcher`), and only the diff differs: the async one sends it to `src/worker-pool.ts`, a pool of plain `worker_threads` workers running `src/async-worker.ts`. It must produce exactly what the sync matcher produces, which `test/compat.test.ts` checks for every scenario.

Details that keep results identical to the original:

- `decodePng` must return the same RGBA bytes as pngjs 3.4. It sets `ignoreIcc: true`, reads 16-bit images as `ushort` and scales them with pngjs's rounding, and checks the PNG signature so non-PNG input throws pngjs's `Invalid file signature`.
- pixelmatch is pinned to 5.x. Versions 7 and 8 count pixels differently and would flip existing thresholds.
- `alignImagesToSameSize` keeps the original's `>` instead of `>=` when marking padded pixels, because pixel counts depend on it.
- When decoded pixels are identical and 0 differences passes, blur and comparison are skipped. A negative `failureThreshold` still runs the full comparison, since it fails and needs a diff image.
- Vitest's `SnapshotState` counters are `CounterMap` objects. Vitest added a shim so `snapshotState.added = snapshotState.added + 1` keeps working, see vitest-dev/vitest#7322. Keep that arithmetic pattern.

## Tests

- `test/compat.test.ts` runs every scenario through both this package and the real jest-image-snapshot (`test/reference.ts`) and compares steps, messages, counters and written files. Diff images are compared by pixels, everything else byte for byte. Each scenario declares its expected per-step `outcomes`, which are checked against the original, so a scenario can't pass without testing anything. Each step is a fresh test run unless it sets `sameRun: true`.
- `test/original/` is jest-image-snapshot's own integration spec, vendored with minimal changes listed in its header. Don't edit it beyond what's needed to run it against this package. `IMAGE_SNAPSHOT_IMPLEMENTATION=original pnpm test:original` runs it against the original to confirm the copy is still valid.
- `test/integration.test.ts` copies a fixture project from `test/integration/` into a temp directory, links `node_modules` to the runner under test, and spawns real Jest or Vitest. `JEST_MODULES`, `VITEST_MODULES`, `INTEGRATION_RUNNERS` and `EXPECTED_RUNNER_MAJOR` select another runner version, installed from `test/runners/<runner>-<major>` with its own lockfile. The spawned runner's environment drops `CI` and `GITHUB_ACTIONS`: Jest gets `--ci=false`, but Vitest 3 has no flag to keep writing new snapshots in CI.

## Benchmark

`bench/matcher.bench.ts` compares the current source with the latest release, installed as the `vitest-image-snapshot-released` npm alias. It runs them in interleaved rounds and gates on the median of per-round ratios. Measuring each implementation in its own block gave up to 2x differences between identical code. CI sets `BENCH_MAX_REGRESSION=1.5` and ignores cases under 1 ms. jest-image-snapshot in the benchmarks needs a larger `maxChildProcessBufferSizeInBytes`, otherwise full-page failures throw `ENOBUFS`.

## Tooling notes

- `typescript` is an npm alias for `@typescript/typescript6`, because typescript-eslint and tsdown's type output need the TypeScript 6 API. `@typescript/native` is TypeScript 7 and provides `tsc`.
- `pnpm-workspace.yaml` denies build scripts explicitly in `allowBuilds`. pnpm 11 fails `install` on unreviewed build scripts, so new native dependencies need an entry. It also exempts this package from pnpm's minimum release age, so the benchmark can install a release right after publishing.
- Releases follow `pnpm version <x.y.z>`, `git push --follow-tags`, `pnpm publish` in an interactive terminal (npm login and 2FA need one), then a GitHub release with "## Highlights" notes. pnpm 11.28.5 made the version commit but no tag, so check `git tag -l` and create the annotated tag with `git tag -a v<x.y.z> -m <x.y.z>` if it's missing.
