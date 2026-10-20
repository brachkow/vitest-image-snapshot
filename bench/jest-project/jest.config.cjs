const path = require('node:path')

module.exports = {
  rootDir: __dirname,
  testMatch: ['**/*.bench.cjs'],
  transform: {},
  testTimeout: 600_000,
  moduleNameMapper: {
    '^@brachkow/vitest-image-snapshot$': path.resolve(__dirname, '../../dist/index.cjs'),
  },
}
