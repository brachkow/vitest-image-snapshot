// Compiles test/types against one runner's own Vitest types: node test/runners/typecheck.ts vitest-3
// The files are copied into the runner's directory, because 'vitest' in them has to resolve
// to that runner's node_modules. A tsconfig `paths` mapping resolves the types but breaks
// the `declare module 'vitest'` augmentation.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const [runner] = process.argv.slice(2)
const major = Number(/^vitest-(\d+)$/.exec(runner ?? '')?.[1])
if (!major) {
  throw new Error('Usage: node test/runners/typecheck.ts vitest-<major>')
}

const root = path.join(import.meta.dirname, '../..')
const runnerDirectory = path.join(import.meta.dirname, runner)
const outputDirectory = path.join(runnerDirectory, '.typecheck')
const augmentation = major >= 5 ? 'vitest-5.ts' : 'vitest-3.ts'
const sourceImport = path.relative(outputDirectory, path.join(root, 'src')).split(path.sep).join('/')

fs.rmSync(outputDirectory, { recursive: true, force: true })
fs.mkdirSync(outputDirectory)
for (const file of ['usage.ts', augmentation]) {
  const source = fs.readFileSync(path.join(root, 'test/types', file), 'utf8')
  fs.writeFileSync(path.join(outputDirectory, file), source.replaceAll("'../../src/", `'${sourceImport}/`))
}
// Runner directories have CommonJS package.json files, the copied tests are ES modules
fs.writeFileSync(path.join(outputDirectory, 'package.json'), '{ "type": "module" }\n')
fs.writeFileSync(
  path.join(outputDirectory, 'tsconfig.json'),
  `${JSON.stringify({ extends: '../../../../tsconfig.json', include: ['*.ts'], exclude: [] }, null, 2)}\n`,
)

const tsc = (...args: string[]) =>
  spawnSync('pnpm', ['exec', 'tsc', '--noEmit', '-p', path.join(outputDirectory, 'tsconfig.json'), ...args], {
    cwd: root,
    encoding: 'utf8',
  })

// A missing runner install would silently fall back to the repo's own Vitest
// pnpm installs Vitest under .pnpm, so the listed paths only share the runner's node_modules prefix
const runnerModules = path.join(runnerDirectory, 'node_modules', '.pnpm', 'vitest@')
if (!tsc('--listFilesOnly').stdout.includes(runnerModules)) {
  throw new Error(`${runner} types were not used. Run pnpm --dir test/runners/${runner} install first.`)
}

const result = tsc()
process.stdout.write(result.stdout + result.stderr)
process.exitCode = result.status ?? 1
