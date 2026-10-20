import { defineConfig } from 'eslint-config-fans'
import globals from 'globals'

export default defineConfig(
  {
    typescript: true,
    test: true,
    formatter: 'prettier',
    // Vendored from jest-image-snapshot and kept as close to the original as possible
    // test/types/vitest-3.ts only compiles against Vitest 3 and 4, so the root tsconfig, which
    // type-aware linting needs, leaves it out. test/runners/typecheck.ts compiles it per runner.
    ignores: ['test/original/**', 'test/types/vitest-3.ts'],
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
