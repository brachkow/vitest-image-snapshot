// The augmentation the README gives for Vitest 3 and 4, which only pick up custom matchers through Assertion
import type { MatchImageSnapshotOptions } from '../../src/index.ts'

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any -- merging requires Vitest's exact type parameters
  interface Assertion<T = any> {
    toMatchImageSnapshot: (options?: MatchImageSnapshotOptions) => void
    toMatchImageSnapshotAsync: (options?: MatchImageSnapshotOptions) => Promise<void>
  }
}
