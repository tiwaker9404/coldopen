/**
 * Finding the address of the person a film goes to. With the sender's own Hunter key (Hunter's
 * free plan has 50 searches a month, more than most job searches need), Hunter finds and checks
 * it. Without one, the common company patterns for that name and domain, clearly labelled as
 * guesses: coldopen never sends anything, so a wrong guess just bounces in the sender's inbox.
 */

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>

export interface EmailFound {
  email: string
  /** "found": Hunter found or verified it; "guess": a common pattern for the domain */
  source: 'hunter' | 'guess'
  /** Hunter's confidence, 0 to 100 */
  score?: number
  /** Hunter's check: valid, accept_all (the server takes any address) or unknown */
  status?: string
}

const ascii = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')

/** "Priya K. Shah" -> { first: "priya", last: "shah" } */
export function splitName(name: string): { first: string; last: string } | null {
  const parts = name
    .replace(/\([^)]*\)|,.*$/g, ' ')
    .trim()
    .split(/\s+/)
    .map(ascii)
    .filter(Boolean)
  if (parts.length === 0) return null
  return { first: parts[0]!, last: parts.length > 1 ? parts.at(-1)! : '' }
}

/** acme.com from https://www.acme.com/about */
export function domainOf(url: string): string | null {
  try {
    const h = new URL(/^https?:\/\//.test(url) ? url : `https://${url}`).hostname.toLowerCase()
    return h.replace(/^www\./, '') || null
  } catch {
    return null
  }
}

/** The patterns companies use most, most common first */
export function guesses(name: string, domain: string): EmailFound[] {
  const n = splitName(name)
  if (!n) return []
  const { first: f, last: l } = n
  const local = l ? [`${f}`, `${f}.${l}`, `${f[0]}${l}`, `${f}${l}`, `${f}_${l}`] : [`${f}`]
  return [...new Set(local)].map((x) => ({ email: `${x}@${domain}`, source: 'guess' as const }))
}

export class HunterError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const HUNTER = 'https://api.hunter.io/v2'

async function hunter(path: string, key: string, f: FetchFn): Promise<Record<string, unknown>> {
  const res = await f(`${HUNTER}${path}`, {
    headers: { 'x-api-key': key, accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (res.ok) return ((await res.json()) as { data?: Record<string, unknown> }).data ?? {}
  const why =
    res.status === 401
      ? "Hunter didn't accept that key"
      : res.status === 429
        ? "You've used this month's Hunter searches"
        : res.status === 403
          ? 'Hunter is busy; try again in a minute'
          : res.status === 451
            ? "Hunter doesn't share this person's address"
            : `Hunter answered HTTP ${res.status}`
  throw new HunterError(res.status, why)
}

/** Checks a key; returns the searches left this month when Hunter says */
export async function checkHunterKey(
  key: string,
  f: FetchFn = fetch,
): Promise<{ left: number | null }> {
  const d = await hunter('/account', key, f)
  const req = (d.requests ?? {}) as Record<string, { available?: number; used?: number }>
  const pool = req.searches ?? req.credits
  const left =
    pool && typeof pool.available === 'number'
      ? Math.max(0, pool.available - (pool.used ?? 0))
      : null
  return { left }
}

/** Hunter's best address for this person at this domain, or null when it has none */
export async function hunterFind(
  key: string,
  name: string,
  domain: string,
  f: FetchFn = fetch,
): Promise<EmailFound | null> {
  const q = new URLSearchParams({ domain, full_name: name.trim() })
  const d = await hunter(`/email-finder?${q}`, key, f)
  const email = typeof d.email === 'string' ? d.email : null
  if (!email) return null
  const v = (d.verification ?? {}) as { status?: string }
  return {
    email,
    source: 'hunter',
    ...(typeof d.score === 'number' ? { score: d.score } : {}),
    ...(v.status ? { status: v.status } : {}),
  }
}

export interface Leader {
  name: string
  position: string | null
  email: string
  score?: number
  status?: string
}

const FOUNDER = /founder|\bceo\b|chief executive|\bcto\b|chief technology|president/i

/**
 * The company's founders and executives Hunter knows, with their emails: one domain search.
 * Founders, CEOs and CTOs first.
 */
export async function hunterLeaders(
  key: string,
  domain: string,
  f: FetchFn = fetch,
): Promise<Leader[]> {
  const q = new URLSearchParams({ domain, seniority: 'executive', limit: '10' })
  const d = await hunter(`/domain-search?${q}`, key, f)
  const rows = Array.isArray(d.emails) ? (d.emails as Record<string, unknown>[]) : []
  const out: Leader[] = []
  for (const r of rows) {
    const email = typeof r.value === 'string' ? r.value : null
    const name = [r.first_name, r.last_name].filter((x) => typeof x === 'string' && x).join(' ')
    if (!email || !name) continue
    const v = (r.verification ?? {}) as { status?: string }
    out.push({
      name,
      position: typeof r.position === 'string' && r.position ? r.position : null,
      email,
      ...(typeof r.confidence === 'number' ? { score: r.confidence } : {}),
      ...(v.status ? { status: v.status } : {}),
    })
  }
  const rank = (l: Leader) => (l.position && FOUNDER.test(l.position) ? 0 : 1)
  return out.sort((a, b) => rank(a) - rank(b) || (b.score ?? 0) - (a.score ?? 0)).slice(0, 5)
}
