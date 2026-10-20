import { Buffer } from 'node:buffer'
import { describe, expect, test } from 'vitest'
import { waitForStableScreenshot } from '../src/index.ts'

const frame = (value: number) => Buffer.from([value, value, value])

const TIMEOUT_ERROR = /^Screenshot was still changing after \d+ captures in 20 ms$/

// Returns the given frames in order and repeats the last one once they run out
const captureSequence = (frames: Buffer[]) => {
  let calls = 0
  const capture = () => Promise.resolve(frames[Math.min(calls++, frames.length - 1)])
  return { capture, calls: () => calls }
}

describe('waitForStableScreenshot', () => {
  test('returns after two captures when the page is already stable', async () => {
    // Arrange
    const { capture, calls } = captureSequence([frame(1)])

    // Act
    const screenshot = await waitForStableScreenshot(capture)

    // Assert
    expect(screenshot.equals(frame(1))).toBe(true)
    expect(calls()).toBe(2)
  })

  test('keeps capturing until two captures in a row match', async () => {
    // Arrange
    const { capture, calls } = captureSequence([frame(1), frame(2), frame(3), frame(3)])

    // Act
    const screenshot = await waitForStableScreenshot(capture)

    // Assert
    expect(screenshot.equals(frame(3))).toBe(true)
    expect(calls()).toBe(4)
  })

  test('does not treat a frame that comes back later as stable', async () => {
    // Arrange
    const { capture, calls } = captureSequence([frame(1), frame(2), frame(1), frame(2), frame(2)])

    // Act
    const screenshot = await waitForStableScreenshot(capture)

    // Assert
    expect(screenshot.equals(frame(2))).toBe(true)
    expect(calls()).toBe(5)
  })

  test('accepts Uint8Array captures and returns a Buffer', async () => {
    // Arrange
    const capture = () => Promise.resolve(new Uint8Array([7, 7]))

    // Act
    const screenshot = await waitForStableScreenshot(capture)

    // Assert
    expect(Buffer.isBuffer(screenshot)).toBe(true)
  })

  test('throws when the screenshot keeps changing until the timeout', async () => {
    // Arrange
    let value = 0
    const capture = () => Promise.resolve(frame(value++))

    // Act
    const result = waitForStableScreenshot(capture, { timeout: 20 })

    // Assert
    await expect(result).rejects.toThrow(TIMEOUT_ERROR)
  })
})
