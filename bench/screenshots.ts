import { Buffer } from 'node:buffer'
import sharp from 'sharp'

export const SIZES = {
  '1280x800': [1280, 800],
  '2560x1600': [2560, 1600],
  '1280x8000': [1280, 8000],
} as const

export type Size = keyof typeof SIZES

// Flat UI blocks with noisy "text" rows, so PNG compression behaves like a real screenshot
const drawScreenshot = (width: number, height: number, changed: boolean): Buffer => {
  const data = Buffer.alloc(width * height * 4)
  let seed = 42
  // Linear congruential generator, so every run draws the same screenshot
  const random = () => (seed = (seed * 1_664_525 + 1_013_904_223) % 2 ** 32) / 2 ** 32
  for (let y = 0; y < height; y++) {
    const block = Math.floor(y / 120)
    const isTextRow = y % 120 > 20 && y % 120 < 90 && y % 6 < 4
    for (let x = 0; x < width; x++) {
      const index = (width * y + x) * 4
      const isInk = isTextRow && x > 40 && x < width - 200 && random() < 0.35
      const value = isInk ? 30 : 240 - (block % 4) * 20
      data[index] = value
      data[index + 1] = value
      data[index + 2] = value + (block % 3) * 5
      data[index + 3] = 255
    }
  }
  if (changed) {
    // A 200x40 button that changed color
    for (let y = 300; y < 340; y++) {
      for (let x = 100; x < 300; x++) {
        const index = (width * y + x) * 4
        data[index] = 220
        data[index + 1] = 40
        data[index + 2] = 40
      }
    }
  }
  return data
}

export interface Screenshots {
  original: Buffer
  /** Same pixels as `original` with different bytes, which forces decoding */
  reencoded: Buffer
  /** `original` with a 200x40 area changed */
  changed: Buffer
}

export const createScreenshots = async (size: Size): Promise<Screenshots> => {
  const [width, height] = SIZES[size]
  const raw = { raw: { width, height, channels: 4 as const } }
  const original = drawScreenshot(width, height, false)
  return {
    original: await sharp(original, raw).png().toBuffer(),
    reencoded: await sharp(original, raw).png({ compressionLevel: 1, adaptiveFiltering: true }).toBuffer(),
    changed: await sharp(drawScreenshot(width, height, true), raw)
      .png()
      .toBuffer(),
  }
}
