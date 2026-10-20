/*
 * Derived from jest-image-snapshot (src/diff-snapshot.js)
 * Copyright (c) 2017 American Express Travel Related Services Company, Inc.
 * Licensed under the Apache License, Version 2.0. Modified: extracted into its own module.
 */
import path from 'node:path'
import type { FailureThresholdType } from './types.ts'

export const snapshotPaths = ({
  snapshotsDirectory,
  snapshotIdentifier,
  receivedPostfix = '-received',
  receivedDirectory = path.join(snapshotsDirectory, '__received_output__'),
  diffDirectory = path.join(snapshotsDirectory, '__diff_output__'),
}: {
  snapshotsDirectory: string
  snapshotIdentifier: string
  receivedPostfix?: string
  receivedDirectory?: string
  diffDirectory?: string
}) => ({
  baselineSnapshotPath: path.join(snapshotsDirectory, `${snapshotIdentifier}.png`),
  receivedSnapshotPath: path.join(receivedDirectory, `${snapshotIdentifier}${receivedPostfix}.png`),
  diffOutputPath: path.join(diffDirectory, `${snapshotIdentifier}-diff.png`),
})

// Typed as string because JavaScript callers can pass anything
export function validateFailureThresholdType(
  failureThresholdType: string,
): asserts failureThresholdType is FailureThresholdType {
  if (failureThresholdType !== 'pixel' && failureThresholdType !== 'percent') {
    throw new Error(`Unknown failureThresholdType: ${failureThresholdType}. Valid options are "pixel" or "percent".`)
  }
}
