import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it } from 'vitest'
import { type D1, type Env, handle, type KV } from '../../share/worker.ts'

const ttls = new Map<string, number>()
/** Workers KV, in memory. */
function memoryKv(): KV {
  const m = new Map<string, ArrayBuffer | string>()
  return {
    get: (async (key: string, type: 'arrayBuffer' | 'json') => {
      const v = m.get(key)
      if (v === undefined) return null
      if (type === 'json')
        return JSON.parse(typeof v === 'string' ? v : new TextDecoder().decode(v))
      return typeof v === 'string' ? new TextEncoder().encode(v).buffer : v
    }) as KV['get'],
    put: async (key, value, opts) => {
      m.set(key, value)
      if (opts?.expirationTtl) ttls.set(key, opts.expirationTtl)
    },
    delete: async (key) => void m.delete(key),
    list: async ({ prefix }) => ({
      keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
    }),
  }
}

/** D1 is SQLite: run the real schema and queries on node:sqlite. */
function sqliteD1(): D1 {
  const db = new DatabaseSync(':memory:')
  db.exec(readFileSync(join(import.meta.dirname, '../../share/schema.sql'), 'utf8'))
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
    run: async () => db.prepare(sql).run(...(args as never[])),
  })
  return { prepare: (sql) => stmt(sql) }
}

const ORIGIN = 'https://share.example.dev'
const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
let env: Env
const waits: Promise<unknown>[] = []
const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) }
const call = (path: string, init: RequestInit = {}) =>
  handle(new Request(`${ORIGIN}${path}`, init), env, ctx)
const auth = { authorization: 'Bearer tok-123' }

const view = {
  company: 'Deel',
  format: 'square',
  from: 'Ashwin Tiwari',
  firstName: 'Ashwin',
  ctaLine: 'Could we talk this week?',
  contact: 'me@example.com',
  film: 'film-square.mp4',
}
const ID = 'deel-7q2k9xgm'
const film = new Uint8Array(1000).map((_, i) => i % 251)

async function upload() {
  await call(`/api/films/${ID}`, { method: 'PUT', headers: auth, body: JSON.stringify(view) })
  await call(`/api/films/${ID}/film-square.mp4`, { method: 'PUT', headers: auth, body: film })
}

beforeEach(() => {
  env = { FILMS: memoryKv(), VIEWS: sqliteD1(), SHARE_TOKEN: 'tok-123', VIEW_SALT: 's' }
})

describe('share worker', () => {
  it('needs the token to upload, list or delete', async () => {
    expect((await call(`/api/films/${ID}`, { method: 'PUT', body: '{}' })).status).toBe(401)
    expect((await call('/api/views', { headers: { authorization: 'Bearer nope' } })).status).toBe(
      401,
    )
    expect((await call(`/api/films/${ID}`, { method: 'DELETE' })).status).toBe(401)
  })

  it('rejects bad ids, page details and file names', async () => {
    expect((await call('/api/films/../x', { method: 'PUT', headers: auth })).status).toBe(404)
    const bad = await call(`/api/films/${ID}`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ ...view, film: 'kit.json' }),
    })
    expect(bad.status).toBe(400)
    const file = await call(`/api/films/${ID}/kit.json`, {
      method: 'PUT',
      headers: auth,
      body: 'x',
    })
    expect(file.status).toBe(400)
  })

  it('serves the page and the film, with byte ranges for Safari', async () => {
    await upload()
    const page = await call(`/f/${ID}`)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('A 30-second film for Deel')
    expect(html).toContain(`${ORIGIN}/f/${ID}/v`)

    const full = await call(`/f/${ID}/film-square.mp4`)
    expect(full.headers.get('content-type')).toBe('video/mp4')
    expect(new Uint8Array(await full.arrayBuffer())).toEqual(film)

    const part = await call(`/f/${ID}/film-square.mp4`, { headers: { range: 'bytes=100-199' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 100-199/1000')
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(film.slice(100, 200))

    const tail = await call(`/f/${ID}/film-square.mp4`, { headers: { range: 'bytes=-10' } })
    expect(tail.headers.get('content-range')).toBe('bytes 990-999/1000')
    expect(
      (await call(`/f/${ID}/film-square.mp4`, { headers: { range: 'bytes=5000-' } })).status,
    ).toBe(416)
    expect((await call(`/f/${ID}/poster.jpg`)).status).toBe(404)
    expect((await call('/f/nothing-here/')).status).toBe(404)
  })

  it('counts plays from people, not bots, and reports them', async () => {
    await upload()
    const beacon = (body: unknown, ua = CHROME) =>
      call(`/f/${ID}/v`, {
        method: 'POST',
        headers: { 'user-agent': ua, 'cf-connecting-ip': '198.51.100.7' },
        body: JSON.stringify(body),
      })
    expect((await beacon({ s: 'sess-aaaaaaaa', e: 'open', t: 0, d: 30 })).status).toBe(204)
    await beacon({ s: 'sess-aaaaaaaa', e: 'play', t: 0, d: 30 })
    await beacon({ s: 'sess-aaaaaaaa', e: 'end', t: 30, d: 30 })
    await beacon({ s: 'sess-bbbbbbbb', e: 'play', t: 4, d: 30 }, 'LinkedInBot/1.0')

    const all = await (await call('/api/views', { headers: auth })).json()
    expect(all.films).toEqual([
      {
        id: ID,
        link: `${ORIGIN}/f/${ID}`,
        views: expect.objectContaining({
          opens: 1,
          viewers: 1,
          plays: 1,
          finishes: 1,
          bestSeconds: 30,
        }),
      },
    ])
    const one = await (await call(`/api/films/${ID}/views`, { headers: auth })).json()
    expect(one.sessions).toHaveLength(1)
    expect(JSON.stringify(one)).not.toContain('198.51.100.7')
  })

  it('reports views for just the films asked about, and can expire uploads', async () => {
    await call(`/api/films/${ID}?ttl=604800`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify(view),
    })
    expect(ttls.get(`meta:${ID}`)).toBe(604800)
    await call(`/f/${ID}/v`, {
      method: 'POST',
      headers: { 'user-agent': CHROME },
      body: JSON.stringify({ s: 'sess-aaaaaaaa', e: 'play', t: 3, d: 30 }),
    })
    const r = await (
      await call(`/api/views?ids=${ID},other-film-1,../bad`, { headers: auth })
    ).json()
    expect(Object.keys(r.views)).toEqual([ID, 'other-film-1'])
    expect(r.views[ID].plays).toBe(1)
    expect(r.views['other-film-1'].plays).toBe(0)
  })

  it('takes a link down, views and all', async () => {
    await upload()
    await call(`/f/${ID}/v`, {
      method: 'POST',
      headers: { 'user-agent': CHROME },
      body: JSON.stringify({ s: 'sess-aaaaaaaa', e: 'play', t: 1, d: 30 }),
    })
    expect((await call(`/api/films/${ID}`, { method: 'DELETE', headers: auth })).status).toBe(200)
    expect((await call(`/f/${ID}`)).status).toBe(404)
    expect((await call(`/f/${ID}/film-square.mp4`)).status).toBe(404)
    const all = await (await call('/api/views', { headers: auth })).json()
    expect(all.films).toEqual([])
  })
})
