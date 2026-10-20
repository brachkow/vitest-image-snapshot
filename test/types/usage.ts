// Type-level checks of the README setup, compiled against every supported Vitest major.
// The augmentation lives next to this file, one per Vitest declaration style.
import { Buffer } from 'node:buffer'
import { expect } from 'vitest'
import { toMatchImageSnapshot, toMatchImageSnapshotAsync, waitForStableScreenshot } from '../../src/index.ts'

export const typedUsage = (image: Buffer) => {
  expect(image).toMatchImageSnapshot({ failureThreshold: 0.01, failureThresholdType: 'percent' })
  // @ts-expect-error unknown threshold types are rejected at compile time
  expect(image).toMatchImageSnapshot({ failureThresholdType: 'pixels' })
}

export const typedAsyncUsage = async (capture: () => Promise<Buffer>) => {
  const image = await waitForStableScreenshot(capture, { timeout: 1000 })
  await expect(image).toMatchImageSnapshotAsync({ diffCompressionLevel: 9 })
  // @ts-expect-error unknown threshold types are rejected at compile time
  await expect(image).toMatchImageSnapshotAsync({ failureThresholdType: 'pixels' })
}

// Jest and Vitest mark SnapshotState fields private, so the matcher's `this` type has to accept their MatcherState
export const registerMatcher = () => {
  expect.extend({ toMatchImageSnapshot, toMatchImageSnapshotAsync })
}
