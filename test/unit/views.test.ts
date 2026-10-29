import { afterEach, describe, expect, it, vi } from 'vitest'
import { sharePage, viewFromStoryboard } from '../../src/share/page.ts'
import {
  applyBeacon,
  isBot,
  parseBeacon,
  recordBeacon,
  referrerHost,
  summarize,
  type ViewRow,
  type ViewStore,
} from '../../src/share/views.ts'

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
// LinkedIn's in-app browser: a person, not LinkedInBot
const LINKEDIN_APP =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]/9.30.1'

describe('who counts as a viewer', () => {
  it('counts browsers, including LinkedIn and Gmail in-app ones', () => {
    for (const ua of [CHROME, IPHONE, LINKEDIN_APP]) expect(isBot(ua)).toBe(false)
  })

  it('ignores unfurlers, crawlers, email scanners and scripts', () => {
    for (const ua of [
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36',
      'curl/8.5.0',
      'python-requests/2.32',
      'Mozilla/5.0 Proofpoint URL Defense',
      '',
      undefined,
    ])
      expect(isBot(ua)).toBe(true)
  })
})

describe('reports from the page', () => {
  it('accepts well-formed reports and clamps numbers', () => {
    expect(parseBeacon('{"s":"abcdefgh12","e":"play","t":3.2,"d":30}')).toEqual({
      s: 'abcdefgh12',
      e: 'play',
      t: 3.2,
      d: 30,
    })
    expect(parseBeacon({ s: 'abcdefgh12', e: 'end', t: 99999, d: -4 })).toMatchObject({
      t: 600,
      d: 0,
    })
  })

  it('drops anything malformed', () => {
    for (const b of [
      'nope',
      '{}',
      { s: 'short', e: 'play', t: 1, d: 1 },
      { s: 'abcdefgh12', e: 'delete', t: 1, d: 1 },
      { s: '<script>alert(1)</script>', e: 'open', t: 0, d: 0 },
      'x'.repeat(5000),
      null,
    ])
      expect(parseBeacon(b)).toBeNull()
  })

  it('keeps only the referring site, and never itself', () => {
    expect(referrerHost('https://www.linkedin.com/messaging/thread/123', 'films.example.com')).toBe(
      'linkedin.com',
    )
    expect(referrerHost('https://films.example.com/f/x', 'films.example.com')).toBeNull()
    expect(referrerHost('not a url', 'films.example.com')).toBeNull()
  })
})

const meta = {
  filmId: 'f1',
  viewer: 'v1',
  device: 'desktop' as const,
  referrer: null,
  country: null,
}
const t0 = new Date('2026-10-28T10:00:00Z')
const at = (s: number) => new Date(t0.getTime() + s * 1000)

describe('a viewing session', () => {
  it('moves forward only: opened, played, how far, finished', () => {
    let r = applyBeacon(undefined, { s: 'sess12345', e: 'open', t: 0, d: 30 }, meta, t0)
    expect(r).toMatchObject({ played: false, seconds: 0, finished: false })
    r = applyBeacon(r, { s: 'sess12345', e: 'play', t: 0, d: 30 }, meta, at(1))
    r = applyBeacon(r, { s: 'sess12345', e: 'progress', t: 14.26, d: 30 }, meta, at(15))
    expect(r).toMatchObject({ played: true, seconds: 14.3, finished: false })
    // a late, smaller report doesn't move it back
    r = applyBeacon(r, { s: 'sess12345', e: 'progress', t: 3, d: 30 }, meta, at(16))
    expect(r.seconds).toBe(14.3)
    r = applyBeacon(r, { s: 'sess12345', e: 'progress', t: 28, d: 30 }, meta, at(30))
    expect(r.finished).toBe(true) // 90% counts as watched to the end
    expect(r.firstSeen).toBe(t0.toISOString())
  })

  it("can't claim more than the film's length", () => {
    const r = applyBeacon(undefined, { s: 'sess12345', e: 'progress', t: 500, d: 30 }, meta, t0)
    expect(r.seconds).toBe(31)
  })

  it('summarizes sessions per film', () => {
    const rows: ViewRow[] = [
      {
        ...meta,
        session: 'a',
        firstSeen: at(0).toISOString(),
        lastSeen: at(30).toISOString(),
        played: true,
        seconds: 30,
        finished: true,
      },
      {
        ...meta,
        session: 'b',
        firstSeen: at(60).toISOString(),
        lastSeen: at(70).toISOString(),
        played: true,
        seconds: 8,
        finished: false,
      },
      {
        ...meta,
        session: 'c',
        viewer: 'v2',
        firstSeen: at(90).toISOString(),
        lastSeen: at(90).toISOString(),
        played: false,
        seconds: 0,
        finished: false,
      },
    ]
    expect(summarize(rows)).toEqual({
      opens: 3,
      viewers: 2,
      plays: 2,
      finishes: 1,
      bestSeconds: 30,
      firstPlayAt: at(0).toISOString(),
      lastSeen: at(90).toISOString(),
    })
  })
})

describe('recording a report', () => {
  afterEach(() => vi.unstubAllGlobals())

  const memory = (): ViewStore & { rows: Map<string, ViewRow> } => {
    const rows = new Map<string, ViewRow>()
    return {
      rows,
      get: async (f, s) => rows.get(`${f}/${s}`),
      put: async (r) => void rows.set(`${r.filmId}/${r.session}`, r),
    }
  }
  const base = {
    filmId: 'f1',
    company: 'Deel',
    ip: '203.0.113.9',
    ownHost: 'films.example.com',
    salt: 'secret',
    link: 'https://films.example.com/f/f1',
  }

  it('notifies once, when a session first plays, and stores no IP', async () => {
    const posts: string[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      posts.push(String(init.body))
      return new Response('ok')
    })
    const store = memory()
    const send = (e: string, t = 0) =>
      recordBeacon({
        ...base,
        store,
        webhook: 'https://hooks.slack.com/services/x',
        userAgent: IPHONE,
        body: JSON.stringify({ s: 'sess12345', e, t, d: 30, r: 'https://mail.google.com/' }),
        now: at(t),
      })
    await send('open')
    await send('play')
    await send('progress', 10)
    expect(posts).toHaveLength(1)
    expect(JSON.parse(posts[0]!).text).toBe(
      'Your film for Deel is being watched (mobile, from mail.google.com). https://films.example.com/f/f1',
    )
    const row = [...store.rows.values()][0]!
    expect(row).toMatchObject({ device: 'mobile', referrer: 'mail.google.com', seconds: 10 })
    expect(JSON.stringify(row)).not.toContain('203.0.113.9')
    expect(row.viewer).toMatch(/^[0-9a-f]{16}$/)
  })

  it('ignores bots without storing anything', async () => {
    const store = memory()
    const r = await recordBeacon({
      ...base,
      store,
      userAgent: 'LinkedInBot/1.0',
      body: { s: 'sess12345', e: 'play', t: 5, d: 30 },
    })
    expect(r).toBeNull()
    expect(store.rows.size).toBe(0)
  })
})

describe('the share page', () => {
  const board = {
    company: 'Linear',
    sender: 'Ashwin Tiwari, Coldopen',
    duration: 30,
    scenes: [
      {
        kind: 'cta' as const,
        dur: 3,
        line: 'Could we talk this week?',
        contact: 'me@example.com',
        signoff: '',
      },
    ],
  }

  it('is built from a CLI film folder', () => {
    expect(viewFromStoryboard(board, 'film-square.mp4')).toEqual({
      company: 'Linear',
      format: 'square',
      from: 'Ashwin Tiwari at Coldopen',
      firstName: 'Ashwin',
      ctaLine: 'Could we talk this week?',
      contact: 'me@example.com',
      film: 'film-square.mp4',
    })
  })

  it('reports views only when asked to, and escapes what it shows', () => {
    const v = { ...viewFromStoryboard(board, 'film-square.mp4'), company: 'A<b>' }
    const plain = sharePage(v, 'https://x.dev/f/a')
    const tracked = sharePage(v, 'https://x.dev/f/a', 'https://x.dev/f/a/v')
    expect(plain).not.toContain('sendBeacon')
    expect(tracked).toContain('"https://x.dev/f/a/v"')
    expect(tracked).toContain('preview') // ?preview turns it off
    expect(tracked).toContain('A&lt;b&gt;')
    expect(tracked).not.toContain('A<b>')
  })
})
