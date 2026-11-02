/**
 * Deploys the share worker:  pnpm share:deploy
 *
 * Adds anything newer versions of coldopen expect to an existing share/wrangler.toml first
 * (the 10-minute keep-awake schedule), so an older setup keeps working without re-running
 * share:setup.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = import.meta.dirname
const toml = join(dir, 'wrangler.toml')
if (!existsSync(toml)) {
  console.error('No share/wrangler.toml yet. Run `pnpm share:setup` first.')
  process.exit(1)
}
const text = readFileSync(toml, 'utf8')
if (!/^\[triggers\]/m.test(text)) {
  writeFileSync(
    toml,
    `${text.trimEnd()}\n\n# every 10 minutes: visit the hosted app (APP_URL) so its free server doesn't fall asleep\n[triggers]\ncrons = ["*/10 * * * *"]\n`,
  )
  console.log('Added the keep-awake schedule to share/wrangler.toml')
}
const r = spawnSync('npx', ['--yes', 'wrangler@4.149.0', 'deploy'], { cwd: dir, stdio: 'inherit' })
process.exit(r.status ?? 1)
