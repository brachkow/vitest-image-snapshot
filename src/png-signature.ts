import { Buffer } from 'node:buffer'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// sharp would happily decode JPEG or WebP, but jest-image-snapshot rejects anything that
// is not a PNG with pngjs's error, so the same check and message are kept
export const assertPngSignature = (buffer: Buffer): void => {
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid file signature')
  }
}
