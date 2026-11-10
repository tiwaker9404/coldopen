/**
 * Records the demo account's data from a real coldopen, so the demo can't drift from the API.
 *
 *   pnpm fixtures &                                              # the fictional sites
 *   ALLOW_PRIVATE_NETWORKS=true API_KEYS=demo FILMS_DIR=/tmp/demo-films node src/main.ts all &
 *   node scripts/demo-fixtures.ts                                # writes dashboard/src/demo/fixtures.json
 *
 * It saves a profile, makes one film per fixture site with the built-in writer (no model key,
 * so the run is the same every time), marks what happened after sending, then calls every
 * route the web app reads and saves the answers. The films' poster, GIF and MP4 are copied to
 * site/media/demo/ for GitHub Pages. Job boards need the network, so the job cache is seeded
 * from a Hiring Index snapshot (real listings on the day it was taken) and the Jobs tab ranks
 * those with the real fit code:
 *
 *   git fetch origin data && git show FETCH_HEAD:snapshots/2026-11-10.csv.gz > /tmp/jobs.csv.gz
 *   node scripts/demo-fixtures.ts --jobs /tmp/jobs.csv.gz
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'
import postgres from 'postgres'

const ROOT = join(import.meta.dirname, '..')
const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://127.0.0.1:8080' },
    key: { type: 'string', default: 'demo' },
    sites: { type: 'string', default: 'http://127.0.0.1:4100' },
    /** a Hiring Index snapshot (.csv.gz) to seed the job cache with */
    jobs: { type: 'string' },
  },
})
const BASE = values.base!

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${values.key}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 300)}`)
  return (text ? JSON.parse(text) : {}) as T
}
const get = <T>(path: string) => call<T>('GET', path)

/** one CSV line, with quoted fields */
function cells(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

const POSTING: Record<string, (token: string, id: string) => string> = {
  greenhouse: (t, id) => `https://job-boards.greenhouse.io/${t}/jobs/${id}`,
  lever: (t, id) => `https://jobs.lever.co/${t}/${id}`,
  ashby: (t, id) => `https://jobs.ashbyhq.com/${t}/${id}`,
}

if (values.jobs) {
  const rows = gunzipSync(await readFile(values.jobs))
    .toString('utf8')
    .trim()
    .split('\n')
  const head = cells(rows.shift()!)
  const byBoard = new Map<string, Record<string, unknown>[]>()
  for (const line of rows) {
    const r = Object.fromEntries(cells(line).map((v, i) => [head[i]!, v]))
    const [ats, token, id] = r.job_id!.split(':') as [string, string, string]
    const job = {
      id: r.job_id,
      board: r.board,
      company: r.company,
      title: r.title,
      url: POSTING[ats]?.(token, id) ?? '',
      location: r.location,
      remote: r.remote === 'true',
      ...(r.team ? { team: r.team } : {}),
      ...(r.posted_at ? { posted: r.posted_at } : {}),
      ...(r.pay_min && r.pay_max
        ? {
            pay: {
              min: Number(r.pay_min),
              max: Number(r.pay_max),
              currency: r.pay_currency || 'USD',
            },
          }
        : {}),
      ...(r.job_type ? { type: r.job_type } : {}),
      ...(r.workplace ? { workplace: r.workplace } : {}),
    }
    byBoard.set(r.board!, [...(byBoard.get(r.board!) ?? []), job])
  }
  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/coldopen')
  for (const [board, jobs] of byBoard)
    await sql`insert into job_boards (board, fetched_at, ok, last_ok_at, jobs)
      values (${board}, now(), true, now(), ${sql.json(jobs as never)})
      on conflict (board) do update set fetched_at = now(), ok = true, last_ok_at = now(), jobs = excluded.jobs`
  await sql.end()
  console.log(`seeded ${byBoard.size} job boards`)
}

const profile = JSON.parse(await readFile(join(ROOT, 'profiles/candidate.example.json'), 'utf8'))
const saved = await call<{ id: string }>('PUT', '/v1/profiles/me', {
  name: profile.sender.name,
  data: profile,
})

// the roles the demo account is looking for, so Jobs ranks like it would for a real person
await call('PUT', '/v1/jobs/search', {
  roles: ['Forward Deployed Engineer', 'Solutions Engineer', 'Solutions Architect'],
  country: 'us',
})

// one film per fixture site, and what happened after each was sent
const plan = [
  { site: 'northwind', outreach: 'interview', recipient: { name: 'Priya Shah' } },
  { site: 'lumen', outreach: 'replied', recipient: { name: 'Marcus Lee' } },
  { site: 'parcelpine', outreach: 'sent', recipient: { name: 'Dana Okafor' } },
] as const
const ids: string[] = []
for (const p of plan) {
  const { id } = await call<{ id: string }>('POST', '/v1/films', {
    url: `${values.sites}/${p.site}/`,
    profileId: saved.id,
  })
  ids.push(id)
}
for (const id of ids) {
  for (let i = 0; ; i++) {
    const f = await get<{ status: string; error: string | null }>(`/v1/films/${id}`)
    if (f.status === 'succeeded') break
    if (f.status === 'failed' || i > 120) throw new Error(`film ${id} didn't finish: ${f.error}`)
    await new Promise((r) => setTimeout(r, 5000))
  }
}
for (const [i, p] of plan.entries()) {
  await call('PUT', `/v1/films/${ids[i]}/recipient`, p.recipient)
  // the board moves through its stages in order: sent first, then what came back
  await call('PUT', `/v1/films/${ids[i]}/outreach`, { status: 'sent' })
  if (p.outreach !== 'sent')
    await call('PUT', `/v1/films/${ids[i]}/outreach`, { status: p.outreach })
}

// people watching: reports like a share page sends, from a browser, so the views are real rows
const UA = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
]
const watch = async (id: string, viewer: number, seconds: number, click: boolean) => {
  const s = `demo-${id.slice(-8)}-${viewer}`
  const events: [string, number][] = [
    ['open', 0],
    ['play', 0],
    ['progress', seconds],
  ]
  if (seconds >= 29) events.push(['end', 29.2])
  if (click) events.push(['click', seconds])
  for (const [e, t] of events)
    await fetch(`${BASE}/f/${id}/v`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA[viewer % 2]! },
      body: JSON.stringify({ s, e, t, d: 29.2 }),
    })
}
await watch(ids[0]!, 0, 29.2, true)
await watch(ids[0]!, 1, 29.2, false)
await watch(ids[1]!, 0, 29.2, true)
await watch(ids[2]!, 0, 14, false)

// every route the web app reads, answered by the real API
const routes: string[] = [
  '/v1/me',
  '/v1/profiles',
  '/v1/films?limit=120',
  '/v1/followups',
  '/v1/outreach',
  '/v1/me/openers',
  '/v1/me/keys',
  '/v1/me/tokens',
  '/v1/connections',
  '/v1/jobs/suggested?limit=24',
  '/v1/startups?since=2023&maxTeam=50&hiring=any&limit=30&offset=0',
  '/v1/startups?hiring=yc-only&limit=1',
  ...ids.flatMap((id) =>
    ['', '/messages', '/views', '/people', '/brief'].map((s) => `/v1/films/${id}${s}`),
  ),
]
const answers: Record<string, unknown> = {}
for (const r of routes) {
  try {
    answers[r] = await get(r)
  } catch (e) {
    console.warn(`skipped ${r}: ${(e as Error).message.split('\n')[0]}`)
  }
}

// media for GitHub Pages, named by film id like the share pages
for (const id of ids) {
  const dir = join(ROOT, 'site/media/demo', id)
  await mkdir(dir, { recursive: true })
  const film = answers[`/v1/films/${id}`] as { files: { film: string } }
  const mp4 = film.files.film.split('/').pop()!
  for (const [from, to] of [
    ['poster.jpg', 'poster.jpg'],
    ['preview.gif', 'preview.gif'],
    ['contact-sheet.jpg', 'contact-sheet.jpg'],
    [mp4, mp4],
  ] as const) {
    const res = await fetch(`${BASE}/f/${id}/${from}`)
    if (!res.ok) throw new Error(`media ${id}/${from}: ${res.status}`)
    await writeFile(join(dir, to), Buffer.from(await res.arrayBuffer()))
  }
}

// the sites and people were made up for the fixtures; show their .example hosts, not a local address
let text = JSON.stringify({ recordedAt: new Date().toISOString(), answers }, null, 2)
for (const [i, p] of plan.entries()) {
  const host = (answers[`/v1/films/${ids[i]}`] as { host: string }).host
  text = text.replaceAll(`${values.sites}/${p.site}/`, `https://${host}/`)
}
// the demo has no share pages; a share link opens the film itself
for (const id of ids) {
  const mp4 = (answers[`/v1/films/${id}`] as { files: { film: string } }).files.film
    .split('/')
    .pop()
  text = text.replaceAll(
    `http://localhost:8080/f/${id}`,
    `https://tiwaker9404.github.io/coldopen/media/demo/${id}/${mp4}`,
  )
}
text = text
  .replaceAll('127.0.0.1:4100', 'example.com')
  .replaceAll('http://localhost:8080', 'https://tiwaker9404.github.io/coldopen/demo')
await writeFile(join(ROOT, 'dashboard/src/demo/fixtures.json'), `${text}\n`)
console.log(`recorded ${Object.keys(answers).length} answers for ${ids.length} films`)
