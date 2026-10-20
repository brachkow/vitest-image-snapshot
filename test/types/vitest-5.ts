// The augmentation the README gives for Vitest 5
import type { MatchImageSnapshotOptions } from '../../src/index.ts'

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- merging requires Vitest's exact type parameters
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toMatchImageSnapshot: (options?: MatchImageSnapshotOptions) => R
    toMatchImageSnapshotAsync: (options?: MatchImageSnapshotOptions) => Promise<void>
  }
}
