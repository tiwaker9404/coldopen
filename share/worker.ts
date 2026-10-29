/**
 * coldopen share links on Cloudflare's free plan: no server to run, and nothing to pay.
 *
 *   GET  /f/:id          the share page (the film, one ask, view tracking)
 *   GET  /f/:id/:file    film, poster and GIF, with byte ranges so Safari can play the video
 *   POST /f/:id/v        reports from the page: open, play, progress, end
 *   PUT  /api/films/:id            the page's details (JSON)       } Bearer SHARE_TOKEN
 *   PUT  /api/films/:id/:file      a film, poster or GIF            }
 *   DELETE /api/films/:id          take a link down                 }
 *   GET  /api/views                every film with its views        }
 *   GET  /api/films/:id/views      one film's sessions              }
 *
 * Films live in Workers KV, views in D1. The page and the tracking rules are the same code
 * the API server uses (src/share), so a film looks and counts the same wherever it's hosted.
 */
import { type ShareView, sharePage } from '../src/share/page.ts'
import { recordBeacon, type ViewRow, type ViewStore, type ViewSummary } from '../src/share/views.ts'

/* ------------------------------------------------- the slice of Workers types we use */
export interface KV {
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>
  get(key: string, type: 'json'): Promise<unknown>
  put(key: string, value: ArrayBuffer | string): Promise<void>
  delete(key: string): Promise<void>
  list(opts: {
    prefix: string
    cursor?: string
  }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>
}
interface D1Statement {
  bind(...values: unknown[]): D1Statement
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results: T[] }>
  run(): Promise<unknown>
}
export interface D1 {
  prepare(sql: string): D1Statement
}
export interface Env {
  FILMS: KV
  VIEWS: D1
  SHARE_TOKEN: string
  VIEW_SALT?: string
  NOTIFY_WEBHOOK_URL?: string
}
interface Ctx {
  waitUntil(p: Promise<unknown>): void
}

/* ------------------------------------------------------------------------ rules */
const ID = /^[a-z0-9][a-z0-9-]{5,79}$/
const FILES: Record<string, string> = {
  'film-square.mp4': 'video/mp4',
  'film-landscape.mp4': 'video/mp4',
  'film-portrait.mp4': 'video/mp4',
  'poster.jpg': 'image/jpeg',
  'preview.gif': 'image/gif',
}
const MAX_FILE = 24 * 1024 * 1024 // Workers KV's value limit is 25 MiB

const metaKey = (id: string) => `meta:${id}`
const fileKey = (id: string, name: string) => `file:${id}:${name}`

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
const err = (status: number, message: string) => json({ error: message }, status)

async function authorized(req: Request, env: Env) {
  const got = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!env.SHARE_TOKEN || !got) return false
  // compare digests, so the time taken says nothing about the token
  const h = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [a, b] = await Promise.all([h(got), h(env.SHARE_TOKEN)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!
  return diff === 0
}

function parseView(body: unknown): ShareView | null {
  if (!body || typeof body !== 'object') return null
  const v = body as Record<string, unknown>
  const str = (k: string, max: number) =>
    typeof v[k] === 'string' && (v[k] as string).length > 0 && (v[k] as string).length <= max
  if (
    !str('company', 120) ||
    !str('from', 160) ||
    !str('firstName', 60) ||
    !str('ctaLine', 160) ||
    !str('contact', 200) ||
    typeof v.film !== 'string' ||
    !FILES[v.film] ||
    !['square', 'landscape', 'portrait'].includes(v.format as string)
  )
    return null
  return {
    company: v.company as string,
    format: v.format as ShareView['format'],
    from: v.from as string,
    firstName: v.firstName as string,
    ctaLine: v.ctaLine as string,
    contact: v.contact as string,
    film: v.film,
  }
}

/** Serves a stored file, honouring Range so iOS Safari will play the video. */
function fileResponse(buf: ArrayBuffer, type: string, range: string | null): Response {
  const headers: Record<string, string> = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=86400',
  }
  const m = range?.match(/^bytes=(\d*)-(\d*)$/)
  if (m && (m[1] || m[2])) {
    const size = buf.byteLength
    let start = m[1] ? Number(m[1]) : size - Number(m[2])
    let end = m[1] && m[2] ? Number(m[2]) : size - 1
    start = Math.max(0, start)
    end = Math.min(end, size - 1)
    if (start > end || start >= size)
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
    return new Response(buf.slice(start, end + 1), {
      status: 206,
      headers: {
        ...headers,
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': String(end - start + 1),
      },
    })
  }
  return new Response(buf, { headers: { ...headers, 'content-length': String(buf.byteLength) } })
}

/* ------------------------------------------------------------------------- views */
type D1Row = {
  film_id: string
  session: string
  viewer: string
  first_seen: string
  last_seen: string
  played: number
  seconds: number
  finished: number
  device: 'mobile' | 'desktop'
  referrer: string | null
  country: string | null
}
const fromD1 = (r: D1Row): ViewRow => ({
  filmId: r.film_id,
  session: r.session,
  viewer: r.viewer,
  firstSeen: r.first_seen,
  lastSeen: r.last_seen,
  played: !!r.played,
  seconds: r.seconds,
  finished: !!r.finished,
  device: r.device,
  referrer: r.referrer,
  country: r.country,
})

export function d1ViewStore(db: D1): ViewStore {
  return {
    async get(filmId, session) {
      const r = await db
        .prepare('select * from film_views where film_id = ? and session = ?')
        .bind(filmId, session)
        .first<D1Row>()
      return r ? fromD1(r) : undefined
    },
    async put(v) {
      await db
        .prepare(
          `insert into film_views
             (film_id, session, viewer, first_seen, last_seen, played, seconds, finished, device, referrer, country)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict (film_id, session) do update set
             last_seen = max(last_seen, excluded.last_seen),
             played = max(played, excluded.played),
             seconds = max(seconds, excluded.seconds),
             finished = max(finished, excluded.finished)`,
        )
        .bind(
          v.filmId,
          v.session,
          v.viewer,
          v.firstSeen,
          v.lastSeen,
          v.played ? 1 : 0,
          v.seconds,
          v.finished ? 1 : 0,
          v.device,
          v.referrer,
          v.country,
        )
        .run()
    },
  }
}

async function summaries(db: D1, filmId?: string): Promise<Map<string, ViewSummary>> {
  const stmt = db.prepare(
    `select film_id,
       count(*) as opens,
       count(distinct viewer) as viewers,
       sum(played) as plays,
       sum(finished) as finishes,
       max(seconds) as best_seconds,
       min(case when played = 1 then first_seen end) as first_play_at,
       max(last_seen) as last_seen
     from film_views ${filmId ? 'where film_id = ?' : ''} group by film_id`,
  )
  const { results } = await (filmId ? stmt.bind(filmId) : stmt).all<{
    film_id: string
    opens: number
    viewers: number
    plays: number
    finishes: number
    best_seconds: number
    first_play_at: string | null
    last_seen: string | null
  }>()
  return new Map(
    results.map((r) => [
      r.film_id,
      {
        opens: r.opens,
        viewers: r.viewers,
        plays: r.plays ?? 0,
        finishes: r.finishes ?? 0,
        bestSeconds: Math.round((r.best_seconds ?? 0) * 10) / 10,
        firstPlayAt: r.first_play_at,
        lastSeen: r.last_seen,
      },
    ]),
  )
}

const EMPTY: ViewSummary = {
  opens: 0,
  viewers: 0,
  plays: 0,
  finishes: 0,
  bestSeconds: 0,
  firstPlayAt: null,
  lastSeen: null,
}

/* ------------------------------------------------------------------------ router */
export async function handle(req: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(req.url)
  const parts = url.pathname.split('/').filter(Boolean)
  const origin = url.origin

  // public: the share page, its files, and its reports
  if (parts[0] === 'f' && parts[1] && ID.test(parts[1])) {
    const id = parts[1]
    const link = `${origin}/f/${id}`
    if (req.method === 'GET' && parts.length === 2) {
      const view = (await env.FILMS.get(metaKey(id), 'json')) as ShareView | null
      if (!view)
        return new Response(
          '<!doctype html><title>Not found</title><p>This film does not exist or was taken down.</p>',
          { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } },
        )
      return new Response(sharePage(view, link, `${link}/v`), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-robots-tag': 'noindex',
        },
      })
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && parts.length === 3) {
      const type = FILES[parts[2]!]
      if (!type) return err(404, 'not found')
      const value = await env.FILMS.get(fileKey(id, parts[2]!), 'arrayBuffer')
      if (!value) return err(404, 'not found')
      const res = fileResponse(value, type, req.headers.get('range'))
      return req.method === 'HEAD' ? new Response(null, res) : res
    }
    if (req.method === 'POST' && parts.length === 3 && parts[2] === 'v') {
      const view = (await env.FILMS.get(metaKey(id), 'json')) as ShareView | null
      if (view) {
        const body = await req.text()
        const cf = (req as unknown as { cf?: { country?: string } }).cf
        await recordBeacon({
          store: d1ViewStore(env.VIEWS),
          filmId: id,
          company: view.company,
          body,
          userAgent: req.headers.get('user-agent') ?? undefined,
          ip: req.headers.get('cf-connecting-ip') ?? '',
          ownHost: url.host,
          country: cf?.country ?? null,
          salt: env.VIEW_SALT ?? env.SHARE_TOKEN,
          webhook: env.NOTIFY_WEBHOOK_URL,
          link,
          defer: (p) => ctx.waitUntil(p),
        })
      }
      // always 204: a page learns nothing from the answer, and a bad report breaks nothing
      return new Response(null, { status: 204 })
    }
    return err(405, 'method not allowed')
  }

  // private: uploads and stats
  if (parts[0] === 'api') {
    if (!(await authorized(req, env))) return err(401, 'missing or wrong SHARE_TOKEN')

    if (parts[1] === 'views' && parts.length === 2 && req.method === 'GET') {
      const ids: string[] = []
      let cursor: string | undefined
      do {
        const page = await env.FILMS.list({ prefix: 'meta:', ...(cursor ? { cursor } : {}) })
        ids.push(...page.keys.map((k) => k.name.slice(5)))
        cursor = page.list_complete ? undefined : page.cursor
      } while (cursor)
      const sums = await summaries(env.VIEWS)
      return json({
        films: ids.map((id) => ({
          id,
          link: `${origin}/f/${id}`,
          views: sums.get(id) ?? EMPTY,
        })),
      })
    }

    if (parts[1] === 'films' && parts[2] && ID.test(parts[2])) {
      const id = parts[2]
      if (parts.length === 3 && req.method === 'PUT') {
        const view = parseView(await req.json().catch(() => null))
        if (!view)
          return err(
            400,
            'expected the page details: company, from, firstName, ctaLine, contact, film, format',
          )
        await env.FILMS.put(metaKey(id), JSON.stringify(view))
        return json({ id, link: `${origin}/f/${id}` })
      }
      if (parts.length === 4 && parts[3] === 'views' && req.method === 'GET') {
        const { results } = await env.VIEWS.prepare(
          'select * from film_views where film_id = ? order by last_seen desc limit 100',
        )
          .bind(id)
          .all<D1Row>()
        const sum = (await summaries(env.VIEWS, id)).get(id) ?? EMPTY
        return json({ summary: sum, sessions: results.map(fromD1) })
      }
      if (parts.length === 4 && req.method === 'PUT') {
        const name = parts[3]!
        if (!FILES[name]) return err(400, `can't upload ${name}`)
        const buf = await req.arrayBuffer()
        if (buf.byteLength === 0 || buf.byteLength > MAX_FILE)
          return err(413, `${name} must be between 1 byte and 24 MB`)
        await env.FILMS.put(fileKey(id, name), buf)
        return json({ id, file: name, bytes: buf.byteLength })
      }
      if (parts.length === 3 && req.method === 'DELETE') {
        await Promise.all([
          env.FILMS.delete(metaKey(id)),
          ...Object.keys(FILES).map((f) => env.FILMS.delete(fileKey(id, f))),
          env.VIEWS.prepare('delete from film_views where film_id = ?').bind(id).run(),
        ])
        return json({ id, deleted: true })
      }
    }
    return err(404, 'not found')
  }

  if (url.pathname === '/')
    return new Response(
      'coldopen share links. Make yours: https://github.com/tiwaker9404/coldopen',
      {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      },
    )
  return err(404, 'not found')
}

export default { fetch: handle }
