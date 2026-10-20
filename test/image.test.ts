import { Buffer } from 'node:buffer'
import { describe, expect, test } from 'vitest'
import { alignImagesToSameSize, composeImages, createImage, decodePng, encodePng } from '../src/image.ts'
import {
  createOpaquePattern,
  createPattern,
  encodeInterlaced,
  encodePalette,
  encodeRgbWithTransparentColor,
  encodeWithIccProfile,
  encodeWithPngjs,
} from './fixtures.ts'
import { ReferencePNG } from './reference.ts'

const WIDTH = 37
const HEIGHT = 23

const decodeWithReference = (buffer: Buffer) => {
  const png = ReferencePNG.sync.read(buffer)
  return { data: png.data, width: png.width, height: png.height }
}

describe('decodePng returns the same RGBA bytes as pngjs 3.4', () => {
  const pattern = createPattern(WIDTH, HEIGHT)
  const opaque = createOpaquePattern(WIDTH, HEIGHT)
  const cases: Array<[string, () => Buffer | Promise<Buffer>]> = [
    ['RGBA 8-bit', () => encodeWithPngjs(pattern, { colorType: 6, bitDepth: 8 })],
    ['RGB 8-bit', () => encodeWithPngjs(pattern, { colorType: 2, bitDepth: 8 })],
    ['grayscale 8-bit', () => encodeWithPngjs(pattern, { colorType: 0, bitDepth: 8 })],
    ['grayscale with alpha 8-bit', () => encodeWithPngjs(pattern, { colorType: 4, bitDepth: 8 })],
    ['RGBA 16-bit', () => encodeWithPngjs(pattern, { colorType: 6, bitDepth: 16 })],
    ['RGB 16-bit', () => encodeWithPngjs(pattern, { colorType: 2, bitDepth: 16 })],
    ['grayscale 16-bit', () => encodeWithPngjs(pattern, { colorType: 0, bitDepth: 16 })],
    ['grayscale with alpha 16-bit', () => encodeWithPngjs(pattern, { colorType: 4, bitDepth: 16 })],
    ['palette with transparency', () => encodePalette(pattern, 64)],
    ['palette 2-bit', () => encodePalette(pattern, 4)],
    ['interlaced', () => encodeInterlaced(pattern)],
    ['embedded P3 color profile', () => encodeWithIccProfile(pattern)],
    [
      'RGB with tRNS transparent color',
      () => encodeRgbWithTransparentColor(opaque, [opaque.data[0], opaque.data[1], opaque.data[2]]),
    ],
  ]

  test.each(cases)('%s', async (_name, encode) => {
    // Arrange
    const png = await encode()
    const expected = decodeWithReference(png)

    // Act
    const actual = await decodePng(png)

    // Assert
    expect(actual.width).toBe(expected.width)
    expect(actual.height).toBe(expected.height)
    expect(actual.data.equals(expected.data)).toBe(true)
  })
})

describe('encodePng', () => {
  test('round-trips pixels losslessly, including fully transparent ones', async () => {
    // Arrange
    const pattern = createPattern(WIDTH, HEIGHT)

    // Act
    const decoded = await decodePng(await encodePng(pattern))

    // Assert
    expect(decoded.data.equals(pattern.data)).toBe(true)
  })
})

describe('alignImagesToSameSize', () => {
  test('pads both images to the larger width and height', () => {
    // Arrange
    const wide = createImage(10, 4)
    const tall = createImage(6, 8)

    // Act
    const [first, second] = alignImagesToSameSize(wide, tall)

    // Assert
    expect([first.width, first.height, second.width, second.height]).toEqual([10, 8, 10, 8])
  })

  test('marks the padded area with black at alpha 64 and keeps the original pixels', () => {
    // Arrange
    const small = { ...createOpaquePattern(3, 2) }
    const large = createImage(6, 5)

    // Act
    const [aligned] = alignImagesToSameSize(small, large)

    // Assert
    const pixel = (x: number, y: number) => [...aligned.data.subarray((y * 6 + x) * 4, (y * 6 + x) * 4 + 4)]
    expect(pixel(0, 0)).toEqual([...small.data.subarray(0, 4)])
    expect(pixel(5, 4)).toEqual([0, 0, 0, 64])
  })

  test('leaves the first padded row and column unmarked, like jest-image-snapshot', () => {
    // Arrange
    const small = createImage(3, 2)
    const large = createImage(6, 5)

    // Act
    const [aligned] = alignImagesToSameSize(small, large)

    // Assert
    const alpha = (x: number, y: number) => aligned.data[(y * 6 + x) * 4 + 3]
    expect(alpha(3, 0)).toBe(0)
    expect(alpha(0, 2)).toBe(0)
    expect(alpha(4, 0)).toBe(64)
    expect(alpha(0, 3)).toBe(64)
  })
})

describe('composeImages', () => {
  const panels = () => [0, 1, 2].map((seed) => createOpaquePattern(4, 3, seed * 100))

  test('places panels side by side horizontally', () => {
    // Arrange
    const images = panels()

    // Act
    const composite = composeImages(images, 'horizontal')

    // Assert
    expect([composite.width, composite.height]).toEqual([12, 3])
    expect([...composite.data.subarray(8 * 4, 9 * 4)]).toEqual([...images[2].data.subarray(0, 4)])
  })

  test('stacks panels vertically', () => {
    // Arrange
    const images = panels()

    // Act
    const composite = composeImages(images, 'vertical')

    // Assert
    expect([composite.width, composite.height]).toEqual([4, 9])
    expect([...composite.data.subarray(4 * 6 * 4, 4 * 6 * 4 + 4)]).toEqual([...images[2].data.subarray(0, 4)])
  })

  test('overlays panels in place for an unknown direction, like jest-image-snapshot', () => {
    // Arrange
    const images = panels()

    // Act
    // @ts-expect-error jest-image-snapshot accepts any string at runtime, this checks that path
    const composite = composeImages(images, 'diagonal')

    // Assert
    expect([composite.width, composite.height]).toEqual([4, 3])
    expect(composite.data.equals(images[2].data)).toBe(true)
  })
})
