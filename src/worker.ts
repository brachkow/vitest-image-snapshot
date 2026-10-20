import { Buffer } from 'node:buffer'
import { runAsWorker } from 'synckit'
import { diffImageToSnapshot } from './diff-snapshot.ts'
import type { DiffOptions } from './types.ts'

runAsWorker((options: DiffOptions) => {
  // postMessage turns a Buffer into a plain Uint8Array
  const { receivedImageBuffer } = options
  return diffImageToSnapshot({
    ...options,
    receivedImageBuffer: Buffer.from(
      receivedImageBuffer.buffer,
      receivedImageBuffer.byteOffset,
      receivedImageBuffer.byteLength,
    ),
  })
})
