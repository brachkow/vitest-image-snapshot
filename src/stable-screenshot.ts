import { Buffer } from 'node:buffer'

export interface StableScreenshotOptions {
  /** How long to keep capturing before giving up, in milliseconds. Vitest's toMatchScreenshot also uses 5000. */
  timeout?: number
}

const DEFAULT_TIMEOUT = 5000

/**
 * Captures until two screenshots in a row are byte-identical and returns the last one. A late
 * font, image or transition then shows up as a retry instead of a flaky failure. Comparing bytes
 * needs no decoding, and a stable page usually returns after the second capture.
 */
export const waitForStableScreenshot = async (
  capture: () => Promise<Uint8Array>,
  { timeout = DEFAULT_TIMEOUT }: StableScreenshotOptions = {},
): Promise<Buffer> => {
  const deadline = Date.now() + timeout
  let previous: Buffer = Buffer.from(await capture())
  let captures = 1
  let current: Buffer
  do {
    // Each capture depends on the page settling after the previous one

    current = Buffer.from(await capture())
    captures += 1
    if (current.equals(previous)) {
      return current
    }
    previous = current
  } while (Date.now() < deadline)
  throw new Error(`Screenshot was still changing after ${captures} captures in ${timeout} ms`)
}
