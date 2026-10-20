const path = require('node:path')

// IMAGE_SNAPSHOT_IMPLEMENTATION=original runs the same spec against jest-image-snapshot,
// which shows the vendored tests still pass where they came from
const IMPLEMENTATIONS = {
  original: require.resolve('jest-image-snapshot'),
  package: path.resolve(__dirname, '../../dist/index.cjs'),
}

module.exports = {
  rootDir: __dirname,
  testMatch: ['**/*.spec.js'],
  transform: {},
  testTimeout: 60000,
  moduleNameMapper: {
    '^@brachkow/vitest-image-snapshot$': IMPLEMENTATIONS[process.env.IMAGE_SNAPSHOT_IMPLEMENTATION ?? 'package'],
  },
}
