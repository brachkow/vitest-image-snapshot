import { defineConfig } from 'eslint-config-fans'
import globals from 'globals'

export default defineConfig(
  {
    typescript: true,
    test: true,
    formatter: 'prettier',
    // Vendored from jest-image-snapshot and kept as close to the original as possible
    ignores: ['test/original/**'],
  },
  {
    // Fixture projects executed by a real Jest, which provides its globals
    files: ['test/integration/jest-project/**', 'bench/jest-project/**'],
    languageOptions: { globals: globals.jest },
  },
  {
    // Fixture projects import the package by name, which each runner's config maps to the
    // build. Node resolution only finds it after a build, so these checks don't apply.
    files: ['test/integration/*-project/**', 'bench/*-project/**'],
    rules: {
      'n/no-missing-import': 'off',
      'n/no-missing-require': 'off',
    },
  },
)
