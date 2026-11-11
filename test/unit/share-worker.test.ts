import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { type D1, type Env, handle, type KV, media, type R2 } from '../../share/worker.ts'
import { viewFromRun } from '../../src/share/page.ts'

const ttls = new Map<string, number>()
/** Workers KV, in memory. */
function memoryKv(): KV {
  const m = new Map<string, ArrayBuffer | string>()
  return {
    get: (async (key: string, type: 'arrayBuffer' | 'json' | 'text') => {
      const v = m.get(key)
      if (v === undefined) return null
      if (type === 'text') return typeof v === 'string' ? v : new TextDecoder().decode(v)
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
function sqliteD1(schema?: string): D1 {
  const db = new DatabaseSync(':memory:')
  db.exec(schema ?? readFileSync(join(import.meta.dirname, '../../share/schema.sql'), 'utf8'))
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

  it('shows the quoted line with the same caption as the film, linked to where it is from', async () => {
    const fact = {
      text: 'When a shopper sends something back for fit, Deel now offers the next size up.',
      caption: 'From their changelog, Oct 2026',
      url: 'https://deel.example/changelog/next-size',
    }
    await call(`/api/films/${ID}`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ ...view, fact }),
    })
    const html = await (await call(`/f/${ID}`)).text()
    expect(html).toContain(`<blockquote>${fact.text}</blockquote>`)
    expect(html).toContain(
      `<figcaption><a href="${fact.url}" target="_blank" rel="noopener">From their changelog, Oct 2026</a></figcaption>`,
    )
  })

  it('shows a caption without a link when the source has no https page, and nothing when there is no fact', async () => {
    for (const url of [undefined, 'javascript:alert(1)', 'http://deel.example/x']) {
      await call(`/api/films/${ID}`, {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({
          ...view,
          fact: {
            text: '61% of returns become exchanges',
            caption: 'From their homepage',
            ...(url ? { url } : {}),
          },
        }),
      })
      const html = await (await call(`/f/${ID}`)).text()
      expect(html).toContain('<figcaption>From their homepage</figcaption>')
      expect(html).not.toContain('javascript:')
    }
    await call(`/api/films/${ID}`, { method: 'PUT', headers: auth, body: JSON.stringify(view) })
    expect(await (await call(`/f/${ID}`)).text()).not.toContain('<blockquote>')
  })

  it("takes the caption and link from the film's highlights when it publishes", () => {
    const sender = {
      preset: 'candidate',
      sender: { name: 'Ashwin Tiwari' },
      cta: { line: 'Talk soon?', contact: 'a@b.co' },
    }
    const quote = (url?: string) => ({
      text: '61% of returns become exchanges',
      source: 'deel.example',
      caption: 'From their homepage',
      ...(url ? { url } : {}),
    })
    const out = (q: ReturnType<typeof quote>) =>
      ({
        company: 'Deel',
        format: 'square',
        files: { film: 'r1/film-square.mp4' },
        highlights: { quote: q, proof: [] },
      }) as never
    expect(
      viewFromRun({ profile: sender } as never, out(quote('https://deel.example/'))).fact,
    ).toEqual({
      text: '61% of returns become exchanges',
      caption: 'From their homepage',
      url: 'https://deel.example/',
    })
    expect(
      viewFromRun({ profile: sender } as never, out(quote('http://localhost:4000/'))).fact,
    ).toEqual({
      text: '61% of returns become exchanges',
      caption: 'From their homepage',
    })
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

  it('counts presses of the button, and keeps counting views on an older database without them', async () => {
    const beacon = (body: unknown) =>
      call(`/f/${ID}/v`, {
        method: 'POST',
        headers: { 'user-agent': CHROME, 'cf-connecting-ip': '198.51.100.7' },
        body: JSON.stringify(body),
      })
    const views = async () =>
      (await (await call('/api/views', { headers: auth })).json()).films[0].views
    await upload()
    await beacon({ s: 'sess-cccccccc', e: 'open', t: 0, d: 30 })
    await beacon({ s: 'sess-cccccccc', e: 'click', t: 0, d: 30 })
    expect(await views()).toMatchObject({ opens: 1, plays: 0, clicks: 1 })

    // a views database set up before clicks were counted
    const old = readFileSync(join(import.meta.dirname, '../../share/schema.sql'), 'utf8').replace(
      /\n\s*-- pressed the button[^\n]*\n\s*clicked[^\n]*/,
      '',
    )
    expect(old).not.toContain('clicked')
    env = { ...env, VIEWS: sqliteD1(old) }
    await upload()
    expect((await beacon({ s: 'sess-dddddddd', e: 'play', t: 5, d: 30 })).status).toBe(204)
    await beacon({ s: 'sess-dddddddd', e: 'click', t: 5, d: 30 })
    expect(await views()).toMatchObject({ opens: 1, plays: 1, clicks: 0 })
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

  it('says "Made with coldopen" and counts films made, publicly', async () => {
    await upload()
    const page = await (await call(`/f/${ID}`)).text()
    expect(page).toContain('href="https://github.com/tiwaker9404/coldopen?ref=share"')
    env.APP_URL = 'https://coldopen.example'
    expect(await (await call(`/f/${ID}`)).text()).toContain(
      'href="https://coldopen.example/?ref=share">Made with coldopen',
    )

    await call(`/f/${ID}/v`, {
      method: 'POST',
      headers: { 'user-agent': CHROME, 'cf-connecting-ip': '198.51.100.7' },
      body: JSON.stringify({ s: 'sess-aaaaaaaa', e: 'end', t: 30, d: 30 }),
    })
    await Promise.all(waits.splice(0))
    const stats = await call('/stats')
    expect(stats.headers.get('access-control-allow-origin')).toBe('*')
    expect(await stats.json()).toEqual({ films: 1, plays: 1, finishes: 1 })

    // publishing the same film again isn't another film; a new one is
    await upload()
    await call('/api/films/other-film-1', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify(view),
    })
    await Promise.all(waits.splice(0))
    expect((await (await call('/stats')).json()).films).toBe(2)
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

  it('keeps the hosted app awake on its schedule, and names downloads', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', async (u: string) => {
      seen.push(String(u))
      return new Response('ok')
    })
    worker.scheduled({}, { ...env, APP_URL: 'https://app.example.dev/' }, ctx)
    worker.scheduled({}, env, ctx)
    await Promise.all(waits)
    expect(seen).toEqual(['https://app.example.dev/healthz'])

    await upload()
    const r = await call(`/f/${ID}/film-square.mp4?download=${encodeURIComponent('Deel - Ashwin')}`)
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="Deel - Ashwin.mp4"')
  })
})

function memoryR2(): R2 & {
  store: Map<string, { buf: ArrayBuffer; meta: Record<string, string> }>
} {
  const store = new Map<string, { buf: ArrayBuffer; meta: Record<string, string> }>()
  return {
    store,
    put: async (k, v, o) => void store.set(k, { buf: v, meta: o?.customMetadata ?? {} }),
    get: async (k) => {
      const o = store.get(k)
      return o ? { arrayBuffer: async () => o.buf, customMetadata: o.meta } : null
    },
    delete: async (keys) => {
      for (const k of [keys].flat()) store.delete(k)
    },
    list: async ({ prefix = '' }) => ({
      objects: [...store]
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, o]) => ({ key, customMetadata: o.meta })),
      truncated: false,
    }),
  }
}

describe('share worker with R2 for the videos', () => {
  it('stores new files in R2, still plays older ones from KV, and honours expiry', async () => {
    const r2 = memoryR2()
    env = { ...env, MEDIA: r2 }
    // a film uploaded before R2 was set up
    await env.FILMS.put(`file:old-film-1:film-square.mp4`, film.buffer.slice(0) as ArrayBuffer)
    expect((await call('/f/old-film-1/film-square.mp4')).status).toBe(200)

    await call(`/api/films/${ID}?ttl=3600`, {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify(view),
    })
    await call(`/api/films/${ID}/film-square.mp4?ttl=3600`, {
      method: 'PUT',
      headers: auth,
      body: film,
    })
    expect(r2.store.has(`file:${ID}:film-square.mp4`)).toBe(true)
    expect(await env.FILMS.get(`file:${ID}:film-square.mp4`, 'arrayBuffer')).toBeNull()

    const part = await call(`/f/${ID}/film-square.mp4`, { headers: { range: 'bytes=0-99' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 0-99/1000')

    // an hour and a bit later: gone from the link, and the daily sweep deletes it
    const later = Date.now() + 3_700_000
    vi.spyOn(Date, 'now').mockReturnValue(later)
    expect((await call(`/f/${ID}/film-square.mp4`)).status).toBe(404)
    expect(await media.sweep(env, later)).toBe(1)
    expect(r2.store.size).toBe(0)
    vi.restoreAllMocks()
  })

  it('deletes a film from R2 and KV alike', async () => {
    const r2 = memoryR2()
    env = { ...env, MEDIA: r2 }
    await upload()
    expect(r2.store.size).toBe(1)
    await call(`/api/films/${ID}`, { method: 'DELETE', headers: auth })
    expect(r2.store.size).toBe(0)
    expect((await call(`/f/${ID}/film-square.mp4`)).status).toBe(404)
  })
})

afterEach(() => vi.unstubAllGlobals())
