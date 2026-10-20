import fs from 'node:fs'
import { expect, test } from 'vitest'
import { toMatchImageSnapshot } from '@brachkow/vitest-image-snapshot'

expect.extend({ toMatchImageSnapshot })

test('matches the screenshot', () => {
  const image = fs.readFileSync(process.env.IMAGE_PATH)
  expect(image).toMatchImageSnapshot({ customSnapshotsDir: process.env.SNAPSHOTS_DIR })
})
