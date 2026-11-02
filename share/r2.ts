/**
 * Connects the share worker to Cloudflare R2 for videos and images (10 GB free; Workers KV,
 * the fallback, holds 1 GB in all). Used by share:setup and share:deploy.
 *
 * R2 has to be switched on once in the Cloudflare dashboard, which asks for a card or PayPal for
 * verification; the free tier still applies. Until then, films keep going to KV.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const BUCKET = 'coldopen-media'

export function ensureR2(
  dir: string,
  wrangler = 'wrangler@4.149.0',
): 'connected' | 'added' | 'off' {
  const toml = join(dir, 'wrangler.toml')
  const text = readFileSync(toml, 'utf8')
  if (/^\[\[r2_buckets\]\]/m.test(text)) return 'connected'
  const r = spawnSync('npx', ['--yes', wrangler, 'r2', 'bucket', 'create', BUCKET], {
    cwd: dir,
    encoding: 'utf8',
  })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  if (r.status !== 0 && !/already exists|already own/i.test(out)) {
    process.stdout.write(`
Videos are stored in Workers KV for now (1 GB free, about 270 films at a time).
For 10 GB free, switch on R2 once: https://dash.cloudflare.com -> R2 Object Storage ->
Purchase R2 (the free plan; Cloudflare asks for a card or PayPal to verify you). Then run
pnpm share:deploy again and new films go to R2.
`)
    return 'off'
  }
  writeFileSync(
    toml,
    `${text.trimEnd()}\n\n# videos and images (10 GB free); without it they're kept in KV\n[[r2_buckets]]\nbinding = "MEDIA"\nbucket_name = "${BUCKET}"\n`,
  )
  console.log(`Videos now go to R2 (bucket ${BUCKET}). Films made before stay playable from KV.`)
  return 'added'
}
