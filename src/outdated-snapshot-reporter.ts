/*
 * Derived from jest-image-snapshot (src/outdated-snapshot-reporter.js)
 * Copyright (c) 2017 American Express Travel Related Services Company, Inc.
 * Licensed under the Apache License, Version 2.0. Modified: added Vitest reporter hooks,
 * rewritten in TypeScript.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  isTrackingEnabled,
  markTouchedFile,
  readTouchedFileListFromDisk,
  removeTouchedFileList,
} from './touched-files.ts'

// Deletes `*-snap.png` baselines that no test touched during the run. Only directories
// that hold at least one touched baseline are scanned.
/* eslint-disable class-methods-use-this -- Jest and Vitest call reporter hooks as instance methods */
export default class OutdatedSnapshotReporter {
  // Static helpers kept from jest-image-snapshot's public class
  static markTouchedFile = markTouchedFile

  static readTouchedFileListFromDisk = readTouchedFileListFromDisk

  onRunStart(): void {
    if (!isTrackingEnabled()) {
      return
    }
    removeTouchedFileList()
  }

  onRunComplete(): void {
    if (!isTrackingEnabled()) {
      return
    }
    const touchedFiles = readTouchedFileListFromDisk()
    const directories = [...new Set(touchedFiles.map((file) => path.dirname(file)))]
    const obsoleteFiles = directories
      .flatMap((directory) => fs.readdirSync(directory).map((file) => path.join(directory, file)))
      .filter((file) => file.endsWith('-snap.png') && !touchedFiles.includes(file))

    removeTouchedFileList()

    for (const file of obsoleteFiles) {
      process.stderr.write(`Deleting outdated snapshot "${file}"...\n`)
      fs.unlinkSync(file)
    }
  }

  // Vitest reporter API names for the same two moments
  onTestRunStart(): void {
    this.onRunStart()
  }

  onTestRunEnd(): void {
    this.onRunComplete()
  }
}
