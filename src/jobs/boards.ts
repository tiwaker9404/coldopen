import { z } from 'zod'

/**
 * Open roles from the public job board APIs of Greenhouse, Lever and Ashby. All three publish a
 * company's listings as JSON with no key and no login, which is how their own careers pages
 * are built. Only the fields a suggestion needs are kept; descriptions are read later, by the
 * film, from the post's own page.
 */

export const ATS = ['greenhouse', 'lever', 'ashby'] as const
export type Ats = (typeof ATS)[number]

/** A company's board on one of the three systems. `site` is its own website, when known. */
export const BoardSchema = z.object({
  ats: z.enum(ATS),
  token: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/),
  name: z.string().min(1).max(80),
  site: z.string().url().optional(),
})
export type Board = z.infer<typeof BoardSchema>

export const boardKey = (b: Pick<Board, 'ats' | 'token'>) => `${b.ats}:${b.token.toLowerCase()}`

/** One open role. */
export interface Job {
  /** "<ats>:<token>:<id>", stable across fetches */
  id: string
  board: string
  company: string
  site?: string
  title: string
  url: string
  location: string
  remote: boolean
  team?: string
  /** ISO date the post went up (or was last updated, when that's all the board gives) */
  posted?: string
  /** yearly base pay the post lists, in its currency (Ashby and Lever boards publish it) */
  pay?: Pay
}

export interface Pay {
  min: number
  max: number
  currency: string
}

/** A yearly figure from an amount and its interval; hourly and monthly pay scaled up */
function yearly(v: unknown, interval: string): number | null {
  const n = typeof v === 'number' ? v : Number.NaN
  if (!Number.isFinite(n) || n <= 0) return null
  const i = interval.toLowerCase()
  if (/hour/.test(i)) return Math.round(n * 2080)
  if (/month/.test(i)) return Math.round(n * 12)
  if (/week/.test(i)) return Math.round(n * 52)
  return Math.round(n)
}

/** A pay range that makes sense as a yearly salary, or nothing */
export function payOf(
  min: unknown,
  max: unknown,
  currency: unknown,
  interval: unknown,
): Pay | null {
  const iv = typeof interval === 'string' ? interval : 'year'
  const lo = yearly(min, iv)
  const hi = yearly(max, iv) ?? lo
  const cur = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency) ? currency : 'USD'
  if (!lo || !hi || hi < lo || lo < 10_000 || hi > 5_000_000) return null
  return { min: lo, max: hi, currency: cur }
}

/** "acme-labs" -> "Acme Labs" */
export function prettyToken(token: string): string {
  return token
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

/**
 * A careers board link someone pasted, as a board. Accepts the board itself or any job on it:
 * boards.greenhouse.io/acme, job-boards.greenhouse.io/acme/jobs/123, jobs.lever.co/acme,
 * jobs.ashbyhq.com/acme/<id>. Anything else is null.
 */
export function parseBoardLink(link: string): Board | null {
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`)
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  const parts = u.pathname.split('/').filter(Boolean)
  let ats: Ats | null = null
  let token = parts[0]
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    ats = 'greenhouse'
    // boards.greenhouse.io/embed/job_board?for=acme
    if (token === 'embed') token = u.searchParams.get('for') ?? undefined
  } else if (host === 'jobs.lever.co' || host === 'jobs.eu.lever.co') ats = 'lever'
  else if (host === 'jobs.ashbyhq.com') ats = 'ashby'
  if (!ats || !token) return null
  const token2 = decodeURIComponent(token)
  const parsed = BoardSchema.safeParse({ ats, token: token2, name: prettyToken(token2) })
  return parsed.success ? parsed.data : null
}

/** The public board's own page, for links in the app */
export function boardPage(b: Pick<Board, 'ats' | 'token'>): string {
  if (b.ats === 'greenhouse') return `https://job-boards.greenhouse.io/${b.token}`
  if (b.ats === 'lever') return `https://jobs.lever.co/${b.token}`
  return `https://jobs.ashbyhq.com/${b.token}`
}

export function apiUrl(b: Pick<Board, 'ats' | 'token'>): string {
  const t = encodeURIComponent(b.token)
  if (b.ats === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${t}/jobs`
  if (b.ats === 'lever') return `https://api.lever.co/v0/postings/${t}?mode=json`
  return `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=true`
}

const REMOTE = /\bremote\b|\banywhere\b|\bdistributed\b/i

const iso = (v: unknown): string | undefined => {
  if (v === null || v === undefined || v === '') return undefined
  const d = new Date(typeof v === 'number' || typeof v === 'string' ? v : Number.NaN)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

type Raw = Record<string, unknown>

const pay = (raw: Raw | undefined, read: (r: Raw) => Pay | null): { pay?: Pay } => {
  if (!raw || typeof raw !== 'object') return {}
  const p = read(raw)
  return p ? { pay: p } : {}
}

/** Ashby's base salary component (equity and bonus left out) */
function ashbyPay(c: Raw): Pay | null {
  const parts = [
    ...((c.summaryComponents as Raw[] | undefined) ?? []),
    ...((c.compensationTiers as Raw[] | undefined) ?? []).flatMap(
      (t) => (t.components as Raw[] | undefined) ?? [],
    ),
  ]
  const base = parts.find((p) => /salary/i.test(String(p.compensationType ?? '')))
  return base ? payOf(base.minValue, base.maxValue, base.currencyCode, base.interval) : null
}

/** The board's JSON, as jobs. Unknown shapes give no jobs rather than throwing. */
export function readBoard(b: Board, body: unknown): Job[] {
  const base = { board: boardKey(b), company: b.name, ...(b.site ? { site: b.site } : {}) }
  const out: Job[] = []
  const push = (j: Omit<Job, 'board' | 'company' | 'site'> & { company?: string }) => {
    if (!j.title || !/^https:\/\//.test(j.url)) return
    out.push({ ...base, ...j, company: base.company, title: clean(j.title).slice(0, 140) })
  }
  if (b.ats === 'greenhouse') {
    const jobs = (body as { jobs?: Raw[] })?.jobs
    for (const j of Array.isArray(jobs) ? jobs : []) {
      const location = clean(str((j.location as Raw | undefined)?.name))
      const kind = ((j.metadata as Raw[] | undefined) ?? [])
        .map((m) => `${str(m.name)} ${str(m.value)}`)
        .join(' ')
      push({
        id: `${boardKey(b)}:${j.id}`,
        title: str(j.title),
        url: str(j.absolute_url),
        location,
        remote: REMOTE.test(location) || /location type\s+remote/i.test(kind),
        ...((j.departments as Raw[] | undefined)?.[0]
          ? { team: str((j.departments as Raw[])[0]!.name) }
          : {}),
        ...(iso(j.first_published ?? j.updated_at)
          ? { posted: iso(j.first_published ?? j.updated_at) }
          : {}),
      })
    }
  } else if (b.ats === 'lever') {
    for (const j of Array.isArray(body) ? (body as Raw[]) : []) {
      const c = (j.categories as Raw | undefined) ?? {}
      const all = Array.isArray(c.allLocations) ? (c.allLocations as unknown[]).map(str) : []
      const location = clean(all.length ? all.join(' | ') : str(c.location))
      push({
        id: `${boardKey(b)}:${j.id}`,
        title: str(j.text),
        url: str(j.hostedUrl),
        location,
        remote: str(j.workplaceType) === 'remote' || REMOTE.test(location),
        ...(str(c.team) ? { team: str(c.team) } : {}),
        ...(iso(j.createdAt) ? { posted: iso(j.createdAt) } : {}),
        ...pay(j.salaryRange as Raw | undefined, (r) =>
          payOf(r.min, r.max, r.currency, r.interval),
        ),
      })
    }
  } else {
    const jobs = (body as { jobs?: Raw[] })?.jobs
    for (const j of Array.isArray(jobs) ? jobs : []) {
      if (j.isListed === false) continue
      const more = Array.isArray(j.secondaryLocations)
        ? (j.secondaryLocations as Raw[]).map((l) => str(l.location)).filter(Boolean)
        : []
      const location = clean([str(j.location), ...more].filter(Boolean).join(' | '))
      push({
        id: `${boardKey(b)}:${j.id}`,
        title: str(j.title),
        url: str(j.jobUrl),
        location,
        remote: j.isRemote === true || str(j.workplaceType) === 'Remote' || REMOTE.test(location),
        ...(str(j.department) || str(j.team) ? { team: str(j.department) || str(j.team) } : {}),
        ...(iso(j.publishedAt) ? { posted: iso(j.publishedAt) } : {}),
        ...pay(j.compensation as Raw | undefined, ashbyPay),
      })
    }
  }
  return out
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>

/** One board's open roles from its public API. Throws on HTTP errors and timeouts. */
export async function fetchBoard(
  b: Board,
  opts: { fetch?: FetchFn; timeoutMs?: number } = {},
): Promise<Job[]> {
  return readBoard(b, await fetchBoardBody(b, opts))
}

/** The board's JSON as its API returns it */
export async function fetchBoardBody(
  b: Board,
  opts: { fetch?: FetchFn; timeoutMs?: number } = {},
): Promise<unknown> {
  const f = opts.fetch ?? fetch
  const res = await f(apiUrl(b), {
    headers: {
      accept: 'application/json',
      'user-agent': 'coldopen/1.0 (+https://github.com/tiwaker9404/coldopen)',
    },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  })
  if (!res.ok) throw new Error(`${b.name}: ${b.ats} board returned HTTP ${res.status}`)
  return res.json()
}
