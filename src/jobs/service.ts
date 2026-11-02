import type { Sql } from '../db/index.ts'
import type { Fit } from '../job/fit.ts'
import { fitOf, type Gap, gapsOf, stemOf } from '../job/fit.ts'
import { type Connection, companyKey, knownAt } from '../outreach/people.ts'
import type { Profile } from '../script/types.ts'
import {
  type Board,
  BoardSchema,
  boardKey,
  type FetchFn,
  fetchBoardBody,
  type Job,
  type Pay,
  readBoard,
} from './boards.ts'
import { DEFAULT_BOARDS, visaOf, ycOf } from './companies.ts'
import { detailsFromBoard, greenhouseDetails } from './details.ts'
import { defaultSearch, rank, type Search, SearchSchema, type Suggestion, spread } from './rank.ts'

/**
 * Suggested jobs for one person: their search, the default boards plus any they added, read
 * from a shared cache that refreshes each board at most every few hours.
 */

const FRESH_MS = 6 * 3_600_000
/** a board that failed is tried again sooner, but not on every page load */
const RETRY_MS = 30 * 60_000
const CONCURRENCY = 8
/** how many boards one person may add */
export const MAX_OWN_BOARDS = 30

export interface SearchState {
  search: Search
  boards: Board[]
  hidden: string[]
  /** fit gaps they marked not relevant */
  ignoredGaps: string[]
  /** when they last looked at their matches */
  seenAt: Date | null
  /** true when nothing was saved yet and the search came from their profile */
  suggested: boolean
}

export async function getSearch(
  sql: Sql,
  owner: string,
  profileRole: string | undefined,
): Promise<SearchState> {
  const [row] = await sql<
    {
      search: unknown
      boards: unknown
      hidden: string[]
      ignoredGaps: string[]
      seenAt: Date | null
    }[]
  >`
    select search, boards, hidden, ignored_gaps, seen_at from job_searches where owner = ${owner}`
  if (!row)
    return {
      search: defaultSearch(profileRole),
      boards: [],
      hidden: [],
      ignoredGaps: [],
      seenAt: null,
      suggested: true,
    }
  const boards = Array.isArray(row.boards)
    ? row.boards.flatMap((b) => {
        const p = BoardSchema.safeParse(b)
        return p.success ? [p.data] : []
      })
    : []
  return {
    search: SearchSchema.parse(row.search),
    boards,
    hidden: row.hidden,
    ignoredGaps: row.ignoredGaps,
    seenAt: row.seenAt,
    suggested: false,
  }
}

export async function saveSearch(
  sql: Sql,
  owner: string,
  search: Search,
  boards: Board[],
): Promise<void> {
  await sql`
    insert into job_searches (owner, search, boards) values (${owner}, ${sql.json(search as never)}, ${sql.json(boards as never)})
    on conflict (owner) do update set search = excluded.search, boards = excluded.boards, updated_at = now()`
}

export async function hideJob(sql: Sql, owner: string, jobId: string, profileRole?: string) {
  const s = await getSearch(sql, owner, profileRole)
  // keep the last 500: old posts close on their own
  const hidden = [...s.hidden.filter((h) => h !== jobId), jobId].slice(-500)
  await sql`
    insert into job_searches (owner, search, boards, hidden) values (${owner}, ${sql.json(s.search as never)}, ${sql.json(s.boards as never)}, ${hidden})
    on conflict (owner) do update set hidden = excluded.hidden, updated_at = now()`
}

interface Cached {
  board: string
  fetchedAt: Date
  ok: boolean
  lastOkAt: Date | null
  error: string | null
  jobs: Job[]
}

/** In-flight refreshes, so two people loading at once fetch a board once */
const inflight = new Map<string, Promise<void>>()

async function refresh(sql: Sql, b: Board, fetchFn?: FetchFn): Promise<void> {
  const key = boardKey(b)
  const running = inflight.get(key)
  if (running) return running
  const p = (async () => {
    try {
      const body = await fetchBoardBody(b, fetchFn ? { fetch: fetchFn } : {})
      const jobs = readBoard(b, body)
      // Lever and Ashby listings carry descriptions: keep each job's requirements
      const details = [...detailsFromBoard(b, body)].map(([jobId, requirements]) => ({
        jobId,
        board: key,
        requirements,
      }))
      for (let i = 0; i < details.length; i += 500)
        await sql`
          insert into job_details ${sql(details.slice(i, i + 500), 'jobId', 'board', 'requirements')}
          on conflict (job_id) do update set requirements = excluded.requirements, fetched_at = now()`
      await sql`
        insert into job_boards (board, fetched_at, ok, last_ok_at, error, jobs) values (${key}, now(), true, now(), null, ${sql.json(jobs as never)})
        on conflict (board) do update set fetched_at = now(), ok = true, last_ok_at = now(), error = null, jobs = excluded.jobs`
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 300)
      // keep the last good listing: a board that hiccups shouldn't empty the suggestions
      await sql`
        insert into job_boards (board, fetched_at, ok, error) values (${key}, now(), false, ${msg})
        on conflict (board) do update set fetched_at = now(), ok = false, error = excluded.error`
    }
  })().finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async () => {
      for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x)
    }),
  )
}

let warming: Promise<void> | null = null

/** Refreshes boards without holding up the request; one background sweep at a time */
function background(sql: Sql, boards: Board[], fetchFn?: FetchFn) {
  if (warming) return
  warming = pool(boards, 6, (b) => refresh(sql, b, fetchFn))
    .catch(() => {})
    .finally(() => {
      warming = null
    })
}

/** Reads every default board that's due, in the background: run at start and every few hours */
export async function warmBoards(sql: Sql, fetchFn?: FetchFn): Promise<void> {
  const keys = DEFAULT_BOARDS.map(boardKey)
  const fresh = new Set(
    (
      await sql<{ board: string }[]>`
        select board from job_boards where board in ${sql(keys)}
        and fetched_at > now() - make_interval(secs => ${FRESH_MS / 1000})`
    ).map((r) => r.board),
  )
  background(
    sql,
    DEFAULT_BOARDS.filter((b) => !fresh.has(boardKey(b))),
    fetchFn,
  )
  await warming
}

/**
 * Listings kept in memory: each request reads only which boards changed (a small query) and
 * loads just those boards' jobs, instead of every board's listing each time.
 */
const memory = new Map<string, Cached>()

async function cachedRows(sql: Sql, keys: string[]): Promise<Map<string, Cached>> {
  const meta = await sql<Omit<Cached, 'jobs'>[]>`
    select board, fetched_at, ok, last_ok_at, error from job_boards where board in ${sql(keys)}`
  const changed = meta
    .filter((m) => memory.get(m.board)?.fetchedAt.getTime() !== m.fetchedAt.getTime())
    .map((m) => m.board)
  for (let i = 0; i < changed.length; i += 200) {
    const part = changed.slice(i, i + 200)
    for (const r of await sql<Cached[]>`select * from job_boards where board in ${sql(part)}`)
      memory.set(r.board, r)
  }
  return new Map(
    meta.flatMap((m) => {
      const c = memory.get(m.board)
      return c ? [[m.board, { ...c, ...m }] as const] : []
    }),
  )
}

/** The boards' listings, refreshing the stale ones first */
export async function listings(
  sql: Sql,
  boards: Board[],
  opts: { fetch?: FetchFn; now?: number; wait?: boolean } = {},
): Promise<{ jobs: Job[]; failed: Board[]; updatedAt: Date | null }> {
  const now = opts.now ?? Date.now()
  const keys = boards.map(boardKey)
  const rows = () => cachedRows(sql, keys)
  let cache = await rows()
  const stale = boards.filter((b) => {
    const c = cache.get(boardKey(b))
    if (!c) return true
    const age = now - c.fetchedAt.getTime()
    return age > (c.ok ? FRESH_MS : RETRY_MS)
  })
  // YC boards (hundreds) refresh in the background, so a page load never waits on them; the
  // curated ones and their own are read before answering, as before
  const isYc = (b: Board) => !!ycOf({ board: b })
  const due = opts.wait ? stale : stale.filter((b) => !isYc(b))
  const behind = opts.wait ? [] : stale.filter(isYc)
  if (behind.length) background(sql, behind, opts.fetch)
  if (due.length) {
    await pool(due, CONCURRENCY, (b) => refresh(sql, b, opts.fetch))
    cache = await rows()
  }
  const jobs: Job[] = []
  const failed: Board[] = []
  let updatedAt: Date | null = null
  for (const b of boards) {
    const c = cache.get(boardKey(b))
    if (!c?.lastOkAt) {
      // a YC board not read yet is on its way, not broken
      if (!isYc(b)) failed.push(b)
      continue
    }
    // the person's own name and website for the company win over what the cache was saved with
    for (const j of c.jobs)
      jobs.push({ ...j, company: b.name, ...(b.site ? { site: b.site } : {}) })
    if (!updatedAt || c.fetchedAt > updatedAt) updatedAt = c.fetchedAt
  }
  return { jobs, failed, updatedAt }
}

/** default boards and theirs, without the same board twice */
export function boardsFor(own: Board[]): Board[] {
  const seen = new Set<string>()
  return [...own, ...DEFAULT_BOARDS].filter((b) => {
    const k = boardKey(b)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** how a job's fit moves it in the list: strong fits first, stretches after */
const FIT_BONUS: Record<Fit['level'], number> = { strong: 1.5, good: 0.75, stretch: -0.25 }
/** how many of the best title matches get their requirements read and a fit worked out */
const FIT_POOL = 60

/** people they know at the company, from their LinkedIn connections export */
export interface Known {
  count: number
  /** up to three, recruiters and likely managers first */
  people: { name: string; position: string | null; url: string | null }[]
}

export type JobWithFit = Suggestion & { filmId?: string; fit?: Fit; known?: Known }

export interface Alerts {
  /** when they last looked at their matches; null on a first visit */
  since: string | null
  /** matches posted since then */
  newMatches: number
  /** new roles that fit their search, at companies they already made a film for */
  filmed: Suggestion[]
}

export interface Suggested {
  data: JobWithFit[]
  alerts: Alerts
  /** skills their best matches keep asking for that the profile doesn't show */
  gaps: Gap[]
  companies: number
  failed: string[]
  updatedAt: string | null
  search: SearchState
}

/**
 * Requirements for these jobs: from the cache, reading the Greenhouse ones not seen yet (their
 * listing has no descriptions). A job that can't be read is saved with none, so it isn't asked
 * for again on every page load.
 */
export async function requirementsFor(
  sql: Sql,
  jobs: Job[],
  opts: { fetch?: FetchFn; pay?: Map<string, Pay> } = {},
): Promise<Map<string, string[]>> {
  if (jobs.length === 0) return new Map()
  const rows = await sql<{ jobId: string; requirements: string[]; pay: Pay | null }[]>`
    select job_id, requirements, pay from job_details where job_id in ${sql(jobs.map((j) => j.id))}`
  const have = new Map(rows.map((r) => [r.jobId, r.requirements]))
  for (const r of rows) if (r.pay) opts.pay?.set(r.jobId, r.pay)
  const missing = jobs.filter((j) => !have.has(j.id) && j.board.startsWith('greenhouse:'))
  await pool(missing, CONCURRENCY, async (j) => {
    const [, token, id] = j.id.split(':') as [string, string, string]
    let requirements: string[] = []
    let pay: Pay | null = null
    try {
      ;({ requirements, pay } = await greenhouseDetails(
        token,
        id,
        opts.fetch ? { fetch: opts.fetch } : {},
      ))
    } catch {}
    have.set(j.id, requirements)
    if (pay) opts.pay?.set(j.id, pay)
    await sql`
      insert into job_details (job_id, board, requirements, pay) values (${j.id}, ${j.board}, ${requirements}, ${pay ? sql.json(pay as never) : null})
      on conflict (job_id) do update set requirements = excluded.requirements, pay = excluded.pay, fetched_at = now()`
  })
  return have
}

const ycBoard = (j: Pick<Job, 'board'>) => {
  const [ats, token] = j.board.split(':') as [Board['ats'], string]
  return ycOf({ board: { ats, token } })
}

/**
 * How fast each company is hiring: its open roles (one per title and place) and how many of
 * them went up in the last 30 days.
 */
export function momentum(
  jobs: Job[],
  now = Date.now(),
): Map<string, { open: number; recent: number }> {
  const out = new Map<string, { open: number; recent: number }>()
  const seen = new Set<string>()
  for (const j of jobs) {
    const k = `${j.board}|${j.title.toLowerCase()}|${j.location.toLowerCase()}`
    if (seen.has(k)) continue
    seen.add(k)
    const m = out.get(j.board) ?? { open: 0, recent: 0 }
    m.open++
    const t = Date.parse(j.posted ?? '')
    if (!Number.isNaN(t) && now - t <= 30 * 86_400_000) m.recent++
    out.set(j.board, m)
  }
  return out
}

const hostOf = (url: string | undefined) => {
  try {
    return new URL(url ?? '').hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Who they know at each of these jobs' companies, by board */
export async function knownFor(
  sql: Sql,
  owner: string,
  jobs: Pick<Job, 'board' | 'company' | 'site'>[],
): Promise<Map<string, Known>> {
  const out = new Map<string, Known>()
  if (jobs.length === 0) return out
  const keys = new Set<string>()
  for (const j of jobs)
    for (const k of [companyKey(j.company), companyKey(hostOf(j.site) ?? '')]) if (k) keys.add(k)
  if (keys.size === 0) return out
  const first = [...new Set([...keys].map((k) => k.split(' ')[0]!))]
  const rows = await sql<Connection[]>`
    select name, url, company, position, connected_on from connections
    where owner = ${owner} and (company_key = any(${[...keys]}) or split_part(company_key, ' ', 1) = any(${first}))
    limit 2000`
  if (rows.length === 0) return out
  for (const j of jobs) {
    if (out.has(j.board)) continue
    const at = knownAt(rows, j.company, hostOf(j.site))
    if (at.length)
      out.set(j.board, {
        count: at.length,
        people: at.slice(0, 3).map((c) => ({ name: c.name, position: c.position, url: c.url })),
      })
  }
  return out
}

const RANKED_MS = 90_000
const RANKED = new Map<
  string,
  {
    at: number
    ranked: JobWithFit[]
    gaps: Gap[]
    failed: Board[]
    updatedAt: Date | null
    recent: Suggestion[]
  }
>()

export async function suggestions(
  sql: Sql,
  owner: string,
  profile: Profile | undefined,
  opts: { limit?: number; fetch?: FetchFn; now?: number } = {},
): Promise<Suggested> {
  const state = await getSearch(sql, owner, profile?.sender.role)
  const boards = boardsFor(state.boards)
  if (state.search.roles.length === 0)
    return {
      data: [],
      alerts: { since: null, newMatches: 0, filmed: [] },
      gaps: [],
      companies: boards.length,
      failed: [],
      updatedAt: null,
      search: state,
    }
  // the ranking is the slow part: reuse it for a minute and a half while nothing it depends on changes
  const key = JSON.stringify([owner, state, profile ?? null, opts.limit ?? 24])
  let hit = opts.fetch || opts.now ? undefined : RANKED.get(key)
  if (!hit || Date.now() - hit.at > RANKED_MS) {
    hit = await (async () => {
      const { jobs: all, failed, updatedAt } = await listings(sql, boards, opts)
      const hidden = new Set(state.hidden)
      const jobs = all.filter(
        (j) =>
          (!state.search.ycOnly || ycOf({ site: j.site }) || ycBoard(j)) &&
          (!state.search.visaOnly || visaOf(j.board)),
      )
      const pace = momentum(all, opts.now)
      // the best title matches, then how well the person's record answers each one's requirements
      const matched = rank(
        jobs.filter((j) => !hidden.has(j.id)),
        state.search,
        opts.now,
      )
      // every match, newest first, for what's new since their last visit
      const recent = matched
        .filter((j) => j.posted)
        .sort((a, b) => b.posted!.localeCompare(a.posted!))
        .slice(0, 400)
      const candidates = spread(matched, 6).slice(0, FIT_POOL)
      const paid = new Map<string, Pay>()
      const reqs = profile
        ? await requirementsFor(sql, candidates, { ...opts, pay: paid })
        : new Map<string, string[]>()
      const fitted: JobWithFit[] = candidates.map((j) => {
        const fit = profile ? fitOf(reqs.get(j.id) ?? [], profile) : null
        const yc = ycBoard(j) ?? ycOf({ site: j.site })
        const hiring = pace.get(j.board)
        const visa = visaOf(j.board)
        return {
          ...j,
          ...(fit ? { fit, score: j.score + FIT_BONUS[fit.level] } : {}),
          ...(!j.pay && paid.has(j.id) ? { pay: paid.get(j.id)! } : {}),
          ...(yc?.batch ? { yc: yc.batch } : {}),
          ...(hiring ? { hiring } : {}),
          ...(visa ? { visa } : {}),
        }
      })
      const fastest = state.search.sort === 'fastest'
      fitted.sort(
        (a, b) =>
          (fastest ? (b.hiring?.recent ?? 0) - (a.hiring?.recent ?? 0) : 0) ||
          b.score - a.score ||
          (Date.parse(b.posted ?? '') || 0) - (Date.parse(a.posted ?? '') || 0) ||
          a.company.localeCompare(b.company),
      )
      const ranked = spread(fitted, fastest ? 2 : 3).slice(0, opts.limit ?? 24)
      const gaps = profile
        ? gapsOf(
            candidates.map((j) => ({ id: j.id, requirements: reqs.get(j.id) ?? [] })),
            profile,
            { ignore: state.ignoredGaps },
          )
        : []

      return { at: Date.now(), ranked, gaps, failed, updatedAt, recent }
    })()
    if (!opts.fetch && !opts.now) {
      RANKED.set(key, hit)
      if (RANKED.size > 200) RANKED.delete(RANKED.keys().next().value!)
    }
  }
  const { ranked, gaps, failed, updatedAt, recent } = hit
  // which of these already have a film: the job link, given as the job post or as the website
  const urls = ranked.map((j) => j.url)
  const made = urls.length
    ? await sql<{ id: string; url: string }[]>`
        select distinct on (u) id, u as url from (
          select id, coalesce(input->'job'->>'url', input->>'url') as u from runs
          where agent = 'film' and owner = ${owner}
        ) r where u in ${sql(urls)} order by u, id desc`
    : []
  const film = new Map(made.map((m) => [m.url, m.id]))
  const known = await knownFor(sql, owner, ranked)
  const alerts = await alertsFor(sql, owner, state.seenAt, recent)
  return {
    alerts,
    gaps,
    data: ranked.map((j) => ({
      ...j,
      ...(film.has(j.url) ? { filmId: film.get(j.url)! } : {}),
      ...(known.has(j.board) ? { known: known.get(j.board)! } : {}),
    })),
    companies: boards.length,
    failed: failed.map((b) => b.name),
    updatedAt: updatedAt?.toISOString() ?? null,
    search: state,
  }
}

/** Stop suggesting a fit gap */
export async function ignoreGap(sql: Sql, owner: string, word: string, profileRole?: string) {
  const s = await getSearch(sql, owner, profileRole)
  const t = stemOf(word)
  const ignored = [...s.ignoredGaps.filter((g) => g !== t), t].slice(-200)
  await sql`
    insert into job_searches (owner, search, boards, ignored_gaps) values (${owner}, ${sql.json(s.search as never)}, ${sql.json(s.boards as never)}, ${ignored})
    on conflict (owner) do update set ignored_gaps = excluded.ignored_gaps, updated_at = now()`
}

/** They looked at their matches: what's new is counted from now */
export async function markSeen(sql: Sql, owner: string, profileRole?: string) {
  const s = await getSearch(sql, owner, profileRole)
  await sql`
    insert into job_searches (owner, search, boards, seen_at) values (${owner}, ${sql.json(s.search as never)}, ${sql.json(s.boards as never)}, now())
    on conflict (owner) do update set seen_at = now()`
}

/**
 * What's new for them: matches posted since their last look, and new roles that fit their search
 * at companies they already made a film for (posted after that film).
 */
export async function alertsFor(
  sql: Sql,
  owner: string,
  seenAt: Date | null,
  recent: Suggestion[],
): Promise<Alerts> {
  const since = seenAt?.toISOString() ?? null
  const newMatches = since ? recent.filter((j) => j.posted! > since).length : 0
  const films = await sql<{ host: string; createdAt: Date }[]>`
    select output->>'host' as host, min(created_at) as created_at from runs
    where agent = 'film' and owner = ${owner} and status = 'succeeded' and output->>'host' is not null
    group by output->>'host'`
  const made = new Map(films.map((f) => [f.host.replace(/^www\./, ''), f.createdAt.toISOString()]))
  const filmed = made.size
    ? recent
        .filter((j) => {
          const at = made.get(hostOf(j.site) ?? '')
          return at !== undefined && j.posted! > at
        })
        .slice(0, 5)
    : []
  return { since, newMatches, filmed }
}
