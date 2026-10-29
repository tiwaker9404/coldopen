/**
 * One-time setup for free share links on Cloudflare:  pnpm share:setup
 *
 * Creates a KV namespace (films) and a D1 database (views), writes share/wrangler.toml,
 * deploys the worker, and sets its upload token. Safe to re-run: existing resources are
 * reused, and the token is only replaced with --rotate-token.
 *
 * Needs a free Cloudflare account. The first run opens a browser to log in.
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WRANGLER = 'wrangler@4.149.0'
const dir = import.meta.dirname
const toml = join(dir, 'wrangler.toml')
const rotate = process.argv.includes('--rotate-token')

/** Runs wrangler with the terminal attached, for steps that may ask something. */
function wranglerLive(args: string[]) {
  const r = spawnSync('npx', ['--yes', WRANGLER, ...args], { cwd: dir, stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`wrangler ${args.join(' ')} failed`)
}

/** Runs wrangler, prints its output, and returns it for parsing. */
function wrangler(args: string[], input?: string): string {
  const r = spawnSync('npx', ['--yes', WRANGLER, ...args], {
    cwd: dir,
    input,
    stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', 'inherit'],
    encoding: 'utf8',
  })
  if (r.stdout) process.stdout.write(r.stdout)
  if (r.status !== 0) throw new Error(`wrangler ${args.join(' ')} failed`)
  return r.stdout ?? ''
}

const say = (s: string) => process.stdout.write(`\n\x1b[1m${s}\x1b[0m\n`)

say('1/5  Checking your Cloudflare login')
const who = spawnSync('npx', ['--yes', WRANGLER, 'whoami'], { cwd: dir, encoding: 'utf8' })
if (!/associated with the email|You are logged in/i.test(`${who.stdout}${who.stderr}`)) {
  wranglerLive(['login'])
}

let config = existsSync(toml) ? readFileSync(toml, 'utf8') : ''
const has = (placeholder: string) => config && !config.includes(placeholder)

if (!has('KV_NAMESPACE_ID') || !has('D1_DATABASE_ID')) {
  config = readFileSync(join(dir, 'wrangler.example.toml'), 'utf8')

  say('2/5  Creating storage for films (Workers KV)')
  let kvId = wrangler(['kv', 'namespace', 'create', 'FILMS']).match(
    /"?id"?\s*[:=]\s*"([0-9a-f]{32})"/,
  )?.[1]
  if (!kvId) {
    const list = JSON.parse(wrangler(['kv', 'namespace', 'list'])) as {
      id: string
      title: string
    }[]
    kvId = list.find((n) => /FILMS$/.test(n.title))?.id
  }
  if (!kvId) throw new Error('could not find the KV namespace id in wrangler output')
  config = config.replace('KV_NAMESPACE_ID', kvId)

  say('3/5  Creating the views database (D1)')
  let dbId: string | undefined
  try {
    dbId = wrangler(['d1', 'create', 'coldopen-views']).match(
      /database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/,
    )?.[1]
  } catch {
    // already exists from an earlier run
  }
  if (!dbId) {
    const list = JSON.parse(wrangler(['d1', 'list', '--json'])) as { uuid: string; name: string }[]
    dbId = list.find((d) => d.name === 'coldopen-views')?.uuid
  }
  if (!dbId) throw new Error('could not find the D1 database id in wrangler output')
  config = config.replace('D1_DATABASE_ID', dbId)
  writeFileSync(toml, config)
} else {
  say('2-3/5  Reusing the storage in share/wrangler.toml')
}

wrangler(['d1', 'execute', 'coldopen-views', '--remote', '--yes', '--file', 'schema.sql'])

say('4/5  Deploying the share worker')
let deployed: string
try {
  deployed = wrangler(['deploy'])
} catch (err) {
  process.stdout.write(`
If wrangler said you need a workers.dev subdomain: open https://dash.cloudflare.com, go to
Workers & Pages once and pick a subdomain (free), then run  pnpm share:setup  again.
`)
  throw err
}
const url = deployed.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i)?.[0]

say('5/5  Setting the upload token')
let token: string | null = null
const hasToken = wrangler(['secret', 'list']).includes('SHARE_TOKEN')
if (!hasToken || rotate) {
  token = randomBytes(24).toString('base64url')
  wrangler(['secret', 'put', 'SHARE_TOKEN'], token)
  wrangler(['secret', 'put', 'VIEW_SALT'], randomBytes(24).toString('base64url'))
  // keep it in the macOS Keychain, so it never sits in a file or shell history
  if (process.platform === 'darwin') {
    spawnSync('security', [
      'add-generic-password',
      '-U',
      '-a',
      process.env.USER ?? 'coldopen',
      '-s',
      'coldopen-share-token',
      '-w',
      token,
    ])
  }
}
if (process.env.NOTIFY_WEBHOOK_URL)
  wrangler(['secret', 'put', 'NOTIFY_WEBHOOK_URL'], process.env.NOTIFY_WEBHOOK_URL)

say('Done.')
const base = url ?? 'https://coldopen-share.<your-subdomain>.workers.dev'
process.stdout.write(`
Your share links live at ${base}/f/...

Add these two lines to ~/.zshrc, then open a new terminal:

  export SHARE_URL="${base}"
${
  process.platform === 'darwin'
    ? `  export SHARE_TOKEN="$(security find-generic-password -a "$USER" -s coldopen-share-token -w 2>/dev/null)"`
    : token
      ? `  export SHARE_TOKEN="${token}"`
      : '  export SHARE_TOKEN="<the token from your first setup>"'
}
${!token && hasToken ? '\n(The upload token was kept. Run with --rotate-token for a new one.)\n' : ''}
Then share films with:   pnpm coldopen share films
And see who watched:     pnpm coldopen views
`)
