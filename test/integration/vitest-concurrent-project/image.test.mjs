import fs from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { expect, test } from 'vitest'
import { toMatchImageSnapshot, toMatchImageSnapshotAsync } from '@brachkow/vitest-image-snapshot'

expect.extend({ toMatchImageSnapshot, toMatchImageSnapshotAsync })

const options = { customSnapshotsDir: process.env.SNAPSHOTS_DIR }

const check = (context, imagePath) => {
  const image = fs.readFileSync(imagePath)
  return process.env.MATCHER === 'async'
    ? context.expect(image).toMatchImageSnapshotAsync(options)
    : context.expect(image).toMatchImageSnapshot(options)
}

// Concurrent tests assert through their own context.expect, as Vitest requires.
// The first test asserts after the second one has started. A matcher that reads the
// test name from shared state names the first snapshot after the second test then.
test.concurrent('first', async (context) => {
  await sleep(200)
  await check(context, process.env.FIRST_IMAGE_PATH)
})

test.concurrent('second', async (context) => {
  await check(context, process.env.SECOND_IMAGE_PATH)
})
