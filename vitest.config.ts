import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Fixture projects under test/integration are run by their own runner, not this one
    include: ['test/*.test.ts'],
    globalSetup: ['test/build.global-setup.ts'],
    // bench/*-project hold fixture files named *.bench.*, which belong to bench/run.ts
    benchmark: {
      include: ['bench/*.bench.ts'],
    },
  },
})
