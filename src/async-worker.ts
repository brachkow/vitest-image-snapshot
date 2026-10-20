// The async matcher's counterpart of worker.ts. synckit's worker answers one blocking call at a
// time, this one is a plain message loop, so a pool of them can diff several images at once.
import { Buffer } from 'node:buffer'
import { parentPort } from 'node:worker_threads'
import { diffImageToSnapshot } from './diff-snapshot.ts'
import type { DiffRequest, DiffResponse } from './types.ts'

const port = parentPort
if (!port) {
  throw new Error('async-worker must run in a worker thread')
}

port.on('message', async ({ id, options }: DiffRequest) => {
  let response: DiffResponse
  try {
    // postMessage turns a Buffer into a plain Uint8Array
    const { receivedImageBuffer } = options
    const result = await diffImageToSnapshot({
      ...options,
      receivedImageBuffer: Buffer.from(
        receivedImageBuffer.buffer,
        receivedImageBuffer.byteOffset,
        receivedImageBuffer.byteLength,
      ),
    })
    response = { id, result }
  } catch (error) {
    const { name, message, stack } = error instanceof Error ? error : new Error(String(error))
    response = { id, error: { name, message, stack } }
  }
  port.postMessage(response)
})
