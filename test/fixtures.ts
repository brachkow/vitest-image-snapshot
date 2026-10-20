import { Buffer } from 'node:buffer'
import zlib from 'node:zlib'
import { PNG } from 'pngjs'
import sharp from 'sharp'

export interface PixelPattern {
  width: number
  height: number
  data: Buffer
}

// Varied colors and alpha levels (transparent, half, opaque) so every
// channel conversion path gets exercised
export const createPattern = (width: number, height: number, seed = 0): PixelPattern => {
  const data = Buffer.alloc(width * height * 4)
  for (let index = 0; index < width * height; index++) {
    const n = index + seed
    data[index * 4] = (n * 7) % 256
    data[index * 4 + 1] = (n * 13) % 256
    data[index * 4 + 2] = (n * 29) % 256
    data[index * 4 + 3] = n % 5 === 0 ? 0 : n % 3 === 0 ? 128 : 255
  }
  return { width, height, data }
}

const WHITE = [255, 255, 255, 255]

// A flat background with a gray stripe every 10 rows. Flat areas keep pixelmatch's
// anti-aliasing detection out of the way, so changed pixel counts are exact.
export const flatPattern = (width: number, height: number, [r, g, b, a] = WHITE): PixelPattern => {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    const isStripe = y % 10 === 0
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      data[index] = isStripe ? 128 : r
      data[index + 1] = isStripe ? 128 : g
      data[index + 2] = isStripe ? 128 : b
      data[index + 3] = a
    }
  }
  return { width, height, data }
}

// Paints a solid red rectangle, the typical "a button changed" regression
export const withRectangle = (
  pattern: PixelPattern,
  x: number,
  y: number,
  width: number,
  height: number,
): PixelPattern => {
  const data = Buffer.from(pattern.data)
  for (let row = y; row < y + height; row++) {
    for (let col = x; col < x + width; col++) {
      const index = (row * pattern.width + col) * 4
      data[index] = 220
      data[index + 1] = 40
      data[index + 2] = 40
      data[index + 3] = 255
    }
  }
  return { ...pattern, data }
}

export const createOpaquePattern = (width: number, height: number, seed = 0): PixelPattern => {
  const pattern = createPattern(width, height, seed)
  for (let index = 3; index < pattern.data.length; index += 4) {
    pattern.data[index] = 255
  }
  return pattern
}

export const encodeWithPngjs = (
  pattern: PixelPattern,
  options: { colorType: 0 | 2 | 4 | 6; bitDepth: 8 | 16 },
): Buffer => {
  const png = new PNG({ width: pattern.width, height: pattern.height })
  pattern.data.copy(png.data)
  return PNG.sync.write(png, { ...options, inputHasAlpha: true })
}

const sharpFrom = (pattern: PixelPattern) =>
  sharp(pattern.data, { raw: { width: pattern.width, height: pattern.height, channels: 4 } })

export const encodePalette = (pattern: PixelPattern, colours: number): Promise<Buffer> =>
  sharpFrom(pattern).png({ palette: true, colours, dither: 0 }).toBuffer()

export const encodeInterlaced = (pattern: PixelPattern): Promise<Buffer> =>
  sharpFrom(pattern).png({ progressive: true }).toBuffer()

export const encodeWithIccProfile = (pattern: PixelPattern): Promise<Buffer> =>
  sharpFrom(pattern).withIccProfile('p3').png().toBuffer()

const pngChunk = (type: string, data: Buffer): Buffer => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(zlib.crc32(typeAndData))
  return Buffer.concat([length, typeAndData, crc])
}

// RGB PNG where one exact color means "transparent" (tRNS chunk). Neither pngjs
// nor sharp writes this variant, so the chunk is inserted after IHDR by hand.
export const encodeRgbWithTransparentColor = (pattern: PixelPattern, color: [number, number, number]): Buffer => {
  const rgb = encodeWithPngjs(pattern, { colorType: 2, bitDepth: 8 })
  const IHDR_END = 8 + 4 + 4 + 13 + 4
  const trns = Buffer.alloc(6)
  for (const [index, value] of color.entries()) {
    trns.writeUInt16BE(value, index * 2)
  }
  return Buffer.concat([rgb.subarray(0, IHDR_END), pngChunk('tRNS', trns), rgb.subarray(IHDR_END)])
}
