/*
 * Derived from jest-image-snapshot (src/outdated-snapshot-reporter.js)
 * Copyright (c) 2017 American Express Travel Related Services Company, Inc.
 * Licensed under the Apache License, Version 2.0. Modified: split from the reporter so the
 * matcher can record files without importing the reporter class.
 */
import fs from 'node:fs'
import path from 'node:path'

// Test workers run in separate processes, so touched baselines are collected in a shared file
const TOUCHED_FILE_LIST_PATH = path.join(process.cwd(), '.jest-image-snapshot-touched-files')

export const isTrackingEnabled = () => !!process.env.JEST_IMAGE_SNAPSHOT_TRACK_OBSOLETE

export const markTouchedFile = (filePath: string): void => {
  if (!isTrackingEnabled()) {
    return
  }
  fs.appendFileSync(TOUCHED_FILE_LIST_PATH, `${filePath}\n`)
}

export const readTouchedFileListFromDisk = (): string[] => {
  if (!fs.existsSync(TOUCHED_FILE_LIST_PATH)) {
    return []
  }
  const files = fs
    .readFileSync(TOUCHED_FILE_LIST_PATH, 'utf8')
    .split('\n')
    .filter((file) => file && fs.existsSync(file))
  return [...new Set(files)]
}

export const removeTouchedFileList = () => fs.rmSync(TOUCHED_FILE_LIST_PATH, { force: true })
