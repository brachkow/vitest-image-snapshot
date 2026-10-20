import { execFileSync } from 'node:child_process'
import path from 'node:path'

// Integration tests load the published build, so it has to be current
export const setup = () => {
  const root = path.join(import.meta.dirname, '..')
  execFileSync(process.execPath, [path.join(root, 'node_modules/tsdown/dist/run.mjs')], { cwd: root, stdio: 'ignore' })
}
