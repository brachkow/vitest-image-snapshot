const path = require('node:path')

// PACKAGE_DIR is set by test/integration.test.ts, which runs this project from a temp copy
const buildDirectory = path.join(process.env.PACKAGE_DIR, 'dist')

module.exports = {
  rootDir: __dirname,
  testMatch: ['**/*.test.cjs'],
  transform: {},
  reporters: ['default', path.join(buildDirectory, 'outdated-snapshot-reporter.cjs')],
  moduleNameMapper: {
    '^@brachkow/vitest-image-snapshot$': path.join(buildDirectory, 'index.cjs'),
  },
}
