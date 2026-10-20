// Type-level check of the augmentation the README tells Vitest users to add
import { Buffer } from 'node:buffer'
import { expect } from 'vitest'
import type { MatchImageSnapshotOptions } from '../src/index.ts'
import { toMatchImageSnapshot } from '../src/index.ts'

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- merging requires Vitest's exact type parameters
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toMatchImageSnapshot: (options?: MatchImageSnapshotOptions) => R
  }
}

export const typedUsage = (image: Buffer) => {
  expect(image).toMatchImageSnapshot({ failureThreshold: 0.01, failureThresholdType: 'percent' })
  // @ts-expect-error unknown threshold types are rejected at compile time
  expect(image).toMatchImageSnapshot({ failureThresholdType: 'pixels' })
}

// Jest and Vitest mark SnapshotState fields private, so the matcher's `this` type has to accept their MatcherState
export const registerMatcher = () => {
  expect.extend({ toMatchImageSnapshot })
}
