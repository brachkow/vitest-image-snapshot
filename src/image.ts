/*
 * Derived from jest-image-snapshot (src/diff-snapshot.js, src/image-composer.js)
 * Copyright (c) 2017 American Express Travel Related Services Company, Inc.
 * Licensed under the Apache License, Version 2.0. Modified: pngjs replaced with sharp,
 * rewritten in TypeScript.
 */
import { Buffer } from 'node:buffer'
import sharp from 'sharp'
import { assertPngSignature } from './png-signature.ts'

export interface RawImage {
  data: Buffer
  width: number
  height: number
}

const RGBA_CHANNELS = 4
const MAX_8BIT = 255
const MAX_16BIT = 65_535

// pngjs 3.4 rounds 16-bit samples this way; libvips rounds differently and would
// shift some channel values by 1, changing pixel counts against existing baselines
const scale16BitTo8Bit = (data: Buffer): Buffer => {
  // libvips emits samples in native byte order, which a typed array view reads as is
  const aligned = data.byteOffset % 2 === 0 ? data : Buffer.from(data)
  const samples = new Uint16Array(aligned.buffer, aligned.byteOffset, aligned.length / 2)
  const out = Buffer.allocUnsafe(samples.length)
  for (const [index, sample] of samples.entries()) {
    out[index] = Math.floor((sample * MAX_8BIT) / MAX_16BIT + 0.5)
  }
  return out
}

export const decodePng = async (buffer: Buffer): Promise<RawImage> => {
  assertPngSignature(buffer)
  // ignoreIcc: pngjs never applied embedded color profiles, so pixel values must stay raw
  const image = sharp(buffer, { ignoreIcc: true })
  const { depth } = await image.metadata()
  const is16Bit = depth === 'ushort'
  const { data, info } = await image
    .toColourspace(is16Bit ? 'rgb16' : 'srgb')
    .ensureAlpha()
    .raw({ depth: is16Bit ? 'ushort' : 'uchar' })
    .toBuffer({ resolveWithObject: true })
  return {
    data: is16Bit ? scale16BitTo8Bit(data) : data,
    width: info.width,
    height: info.height,
  }
}

// Level 1 is 4-5x faster than the default 6 for a few times larger diff files
export const encodePng = (image: RawImage, compressionLevel = 1): Promise<Buffer> =>
  sharp(image.data, { raw: { width: image.width, height: image.height, channels: RGBA_CHANNELS } })
    .png({ compressionLevel })
    .toBuffer()

export const createImage = (width: number, height: number): RawImage => ({
  data: Buffer.alloc(width * height * RGBA_CHANNELS),
  width,
  height,
})

const copyInto = (source: RawImage, target: RawImage, offsetX: number, offsetY: number): void => {
  const rowBytes = source.width * RGBA_CHANNELS
  for (let y = 0; y < source.height; y++) {
    const targetStart = ((offsetY + y) * target.width + offsetX) * RGBA_CHANNELS
    source.data.copy(target.data, targetStart, y * rowBytes, (y + 1) * rowBytes)
  }
}

// Marks the area outside the original size with black at 25% opacity.
// `>` rather than `>=` is kept from jest-image-snapshot so diff pixel counts stay identical.
const fillSizeDifference = (image: RawImage, width: number, height: number): RawImage => {
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (y > height || x > width) {
        const index = (image.width * y + x) * RGBA_CHANNELS
        image.data[index] = 0
        image.data[index + 1] = 0
        image.data[index + 2] = 0
        image.data[index + 3] = 64
      }
    }
  }
  return image
}

export const alignImagesToSameSize = (first: RawImage, second: RawImage): [RawImage, RawImage] => {
  const width = Math.max(first.width, second.width)
  const height = Math.max(first.height, second.height)
  const resize = (image: RawImage): RawImage => {
    const resized = createImage(width, height)
    copyInto(image, resized, 0, 0)
    return fillSizeDifference(resized, image.width, image.height)
  }
  return [resize(first), resize(second)]
}

export type DiffDirection = 'horizontal' | 'vertical'

export const composeImages = (images: RawImage[], direction: DiffDirection): RawImage => {
  const width = Math.max(...images.map((image) => image.width))
  const height = Math.max(...images.map((image) => image.height))
  // An unknown direction overlays all images in place, as jest-image-snapshot does
  const offset = {
    horizontal: { x: width, y: 0, compositeWidth: width * images.length, compositeHeight: height },
    vertical: { x: 0, y: height, compositeWidth: width, compositeHeight: height * images.length },
  }[direction] ?? { x: 0, y: 0, compositeWidth: width, compositeHeight: height }
  const composite = createImage(offset.compositeWidth, offset.compositeHeight)
  for (const [index, image] of images.entries()) {
    copyInto(image, composite, offset.x * index, offset.y * index)
  }
  return composite
}
