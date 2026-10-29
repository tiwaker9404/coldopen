/**
 * View tracking for share pages, shared by the API server (Postgres) and the Cloudflare share
 * worker (D1). Pure functions and Web Crypto only, so it runs in both.
 *
 * One row per viewing session (a page load). The page reports open, play, progress every few
 * seconds and end; each report updates that session's row. No IP address is stored: viewers
 * are told apart by a hash of IP, browser and day, salted with a server secret, so the same
 * person on the same day counts once and the hash can't be reversed into an address.
 */

export type BeaconEvent = 'open' | 'play' | 'progress' | 'end'

export interface Beacon {
  /** random per page load */
  s: string
  e: BeaconEvent
  /** furthest point reached, seconds */
  t: number
  /** the film's length, seconds */
  d: number
  /** document.referrer, sent with "open" */
  r?: string
}

export interface ViewRow {
  filmId: string
  session: string
  viewer: string
  firstSeen: string
  lastSeen: string
  played: boolean
  seconds: number
  finished: boolean
  device: 'mobile' | 'desktop'
  referrer: string | null
  country: string | null
}

export interface ViewSummary {
  /** page loads by people (bots and link scanners excluded) */
  opens: number
  /** distinct people who opened it */
  viewers: number
  /** sessions that pressed play */
  plays: number
  /** sessions that reached the end */
  finishes: number
  /** furthest anyone got, seconds */
  bestSeconds: number
  firstPlayAt: string | null
  lastSeen: string | null
}

const EVENTS = new Set<BeaconEvent>(['open', 'play', 'progress', 'end'])
const MAX_SECONDS = 600

/** Validates a report from a share page. Anything malformed is dropped, never an error page. */
export function parseBeacon(body: unknown): Beacon | null {
  let b = body
  if (typeof b === 'string') {
    if (b.length > 1024) return null
    try {
      b = JSON.parse(b)
    } catch {
      return null
    }
  }
  if (!b || typeof b !== 'object') return null
  const { s, e, t, d, r } = b as Record<string, unknown>
  if (typeof s !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(s)) return null
  if (typeof e !== 'string' || !EVENTS.has(e as BeaconEvent)) return null
  const num = (x: unknown) =>
    typeof x === 'number' && Number.isFinite(x) ? Math.min(Math.max(x, 0), MAX_SECONDS) : 0
  return {
    s,
    e: e as BeaconEvent,
    t: num(t),
    d: num(d),
    ...(typeof r === 'string' && r.length <= 300 ? { r } : {}),
  }
}

// Link unfurlers, crawlers, email security scanners and scripts. They fetch share links
// constantly and would make every film look watched.
const BOT =
  /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|embedly|whatsapp\/|telegrambot|discordbot|skypeuripreview|slack-?imgproxy|slackbot|linkedinbot|twitterbot|google-?(read|image|inspection)|bingpreview|headless|phantom|puppeteer|playwright|lighthouse|curl|wget|python|node-fetch|axios|go-http|java\/|okhttp|libwww|proofpoint|mimecast|barracuda|forcepoint|symantec|trend ?micro|zscaler|safelinks/i

export function isBot(userAgent: string | undefined | null): boolean {
  if (!userAgent || userAgent.length < 20) return true
  return BOT.test(userAgent)
}

export function deviceOf(userAgent: string): 'mobile' | 'desktop' {
  return /mobile|iphone|ipad|android/i.test(userAgent) ? 'mobile' : 'desktop'
}

/** "https://www.linkedin.com/feed/" -> "linkedin.com"; the page's own host is not a referrer */
export function referrerHost(ref: string | undefined | null, ownHost: string): string | null {
  if (!ref) return null
  try {
    const h = new URL(ref).hostname.replace(/^www\./, '')
    return h && h !== ownHost.replace(/^www\./, '') ? h.slice(0, 100) : null
  } catch {
    return null
  }
}

/** Day-salted, server-salted hash of who's watching. Not reversible into an IP address. */
export async function viewerHash(secret: string, ip: string, ua: string, now: Date) {
  const day = now.toISOString().slice(0, 10)
  const data = new TextEncoder().encode(`${secret}|${day}|${ip}|${ua}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Folds one report into its session's row. Returns the new row. */
export function applyBeacon(
  prev: ViewRow | undefined,
  b: Beacon,
  meta: Omit<ViewRow, 'session' | 'firstSeen' | 'lastSeen' | 'played' | 'seconds' | 'finished'>,
  now: Date,
): ViewRow {
  const at = now.toISOString()
  const played = (prev?.played ?? false) || b.e !== 'open'
  // a session can't report more than the film's length (plus rounding)
  const cap = b.d > 0 ? b.d + 1 : MAX_SECONDS
  const seconds = Math.min(Math.max(prev?.seconds ?? 0, b.t), cap)
  const finished = (prev?.finished ?? false) || b.e === 'end' || (b.d > 0 && seconds >= b.d * 0.9)
  return {
    ...meta,
    ...(prev ? { device: prev.device, referrer: prev.referrer, country: prev.country } : {}),
    session: b.s,
    firstSeen: prev?.firstSeen ?? at,
    lastSeen: at,
    played,
    seconds: Math.round(seconds * 10) / 10,
    finished,
  }
}

/** True when this report is the moment a session first pressed play: worth a notification. */
export function startedPlaying(prev: ViewRow | undefined, next: ViewRow): boolean {
  return next.played && !prev?.played
}

export function summarize(rows: ViewRow[]): ViewSummary {
  const plays = rows.filter((r) => r.played)
  const byTime = (a: string, b: string) => (a < b ? -1 : 1)
  return {
    opens: rows.length,
    viewers: new Set(rows.map((r) => r.viewer)).size,
    plays: plays.length,
    finishes: rows.filter((r) => r.finished).length,
    bestSeconds: rows.reduce((m, r) => Math.max(m, r.seconds), 0),
    firstPlayAt: plays.map((r) => r.firstSeen).sort(byTime)[0] ?? null,
    lastSeen:
      rows
        .map((r) => r.lastSeen)
        .sort(byTime)
        .at(-1) ?? null,
  }
}

/** The line posted to Slack (or Discord) when someone starts watching. */
export function playMessage(company: string, row: ViewRow, link: string): string {
  const where = [
    row.device,
    row.referrer ? `from ${row.referrer}` : null,
    row.country ? `in ${row.country}` : null,
  ]
    .filter(Boolean)
    .join(', ')
  return `Your film for ${company} is being watched (${where}). ${link}`
}

/** Posts to a Slack or Discord incoming webhook. Failures are swallowed: a view still counts. */
export async function notify(webhook: string | undefined, text: string): Promise<void> {
  if (!webhook) return
  try {
    await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Slack reads "text", Discord reads "content"
      body: JSON.stringify({ text, content: text }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // best-effort
  }
}

/** Where sessions are kept: Postgres on the API server, D1 on the share worker. */
export interface ViewStore {
  get(filmId: string, session: string): Promise<ViewRow | undefined>
  put(row: ViewRow): Promise<void>
}

export interface RecordInput {
  store: ViewStore
  filmId: string
  company: string
  body: unknown
  userAgent: string | undefined
  ip: string
  /** the share page's host, so its own URL isn't counted as a referrer */
  ownHost: string
  country?: string | null
  salt: string
  /** Slack or Discord incoming webhook; posted to when someone starts watching */
  webhook?: string
  /** the share link, for the notification */
  link: string
  now?: Date
  /** runs the notification after the response (Workers' waitUntil); awaited when absent */
  defer?: (p: Promise<void>) => void
}

/**
 * Handles one report from a share page. Returns the session's row, or null when the report
 * was ignored (a bot, or something malformed). Never throws on bad input.
 */
export async function recordBeacon(i: RecordInput): Promise<ViewRow | null> {
  const ua = i.userAgent ?? ''
  if (isBot(ua)) return null
  const b = parseBeacon(i.body)
  if (!b) return null
  const now = i.now ?? new Date()
  const prev = await i.store.get(i.filmId, b.s)
  const next = applyBeacon(
    prev,
    b,
    {
      filmId: i.filmId,
      viewer: prev?.viewer ?? (await viewerHash(i.salt, i.ip, ua, now)),
      device: deviceOf(ua),
      referrer: referrerHost(b.r, i.ownHost),
      country: i.country ?? null,
    },
    now,
  )
  await i.store.put(next)
  if (startedPlaying(prev, next) && i.webhook) {
    const sent = notify(i.webhook, playMessage(i.company, next, i.link))
    if (i.defer) i.defer(sent)
    else await sent
  }
  return next
}
