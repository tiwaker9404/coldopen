#!/usr/bin/env node
/**
 * Builds src/jobs/yc.json: the Greenhouse, Lever and Ashby boards of YC companies that are
 * hiring. The company list comes from yc-oss (github.com/yc-oss/api), a daily copy of YC's own
 * company directory; each company's board is found by trying the names it would be listed
 * under on each system and keeping one that lists open roles. Companies that only post on YC's
 * Work at a Startup are left out: it has no public API.
 *
 * Run by the "YC boards" workflow (weekly), or by hand: node src/jobs/yc-build.ts
 */
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { type Ats, type Board, boardPage, fetchBoardBody, readBoard } from './boards.ts'

const SOURCE = 'https://yc-oss.github.io/api/companies/hiring.json'
const OUT = new URL('./yc.json', import.meta.url)
// gentle enough that Greenhouse, Lever and Ashby don't start refusing (a burst of 429s once
// read as "no board" and dropped 171 companies)
const CONCURRENCY = 8

/** The board doesn't exist (404, or an empty list): not the same as couldn't tell */
export class NoBoard extends Error {}

/**
 * The board's body, retried with backoff when the system is busy or slow (429, 5xx, a timeout).
 * Throws NoBoard for a board that isn't there, anything else when it still couldn't tell.
 */
export async function bodyOf(
  b: Board,
  fetchBody: typeof fetchBoardBody = fetchBoardBody,
  waits = [2_000, 8_000, 20_000],
): Promise<unknown> {
  for (let i = 0; ; i++) {
    try {
      return await fetchBody(b, { timeoutMs: 20_000 })
    } catch (err) {
      const m = String((err as Error).message)
      if (/HTTP (404|410)\b/.test(m)) throw new NoBoard(m)
      const busy = /HTTP (429|5\d\d)\b|timeout|aborted|fetch failed|ECONNRESET|ETIMEDOUT/i.test(m)
      if (!busy || i >= waits.length) throw err
      await sleep(waits[i]!)
    }
  }
}

/**
 * The new list, keeping last week's board for any company whose check failed (rather than
 * found nothing): a busy afternoon at an ATS shouldn't drop a company that's still hiring.
 */
export function merge(
  found: YcBoard[],
  previous: YcBoard[],
  unsure: Set<string>,
  hiring: Set<string>,
): { boards: YcBoard[]; kept: number } {
  const have = new Set(found.map((b) => b.slug))
  const kept = previous.filter((p) => !have.has(p.slug) && unsure.has(p.slug) && hiring.has(p.slug))
  return { boards: [...found, ...kept], kept: kept.length }
}

/** The list shrank by more than this share in one run: something's wrong; don't publish it */
export const MAX_DROP = 0.2

interface YcCompany {
  name: string
  slug: string
  website?: string
  batch?: string
  team_size?: number | null
  one_liner?: string
  status?: string
}

export interface YcBoard {
  ats: Ats
  token: string
  name: string
  site?: string
  /** the batch, short: "W24", "S23", "X25", "F24" */
  batch: string
  /** the company's page on ycombinator.com, which lists its founders */
  slug: string
  size?: number
}

/** "Winter 2024" -> "W24", "Spring 2025" -> "X25" (YC's own shorthand) */
export function shortBatch(batch: string | undefined): string {
  const m = /^(winter|summer|spring|fall)\s+(\d{4})$/i.exec(batch?.trim() ?? '')
  if (!m) return ''
  const season = { winter: 'W', summer: 'S', spring: 'X', fall: 'F' }[
    m[1]!.toLowerCase() as 'winter'
  ]
  return `${season}${m[2]!.slice(2)}`
}

/** The names a company's board is likely listed under, most likely first */
export function tokensFor(c: Pick<YcCompany, 'name' | 'slug' | 'website'>): string[] {
  const out: string[] = []
  const add = (t: string | undefined) => {
    const v = t?.toLowerCase().trim()
    if (v && v.length >= 3 && /^[a-z0-9][a-z0-9._-]*$/.test(v) && !out.includes(v)) out.push(v)
  }
  add(c.slug)
  add(c.slug.replace(/-/g, ''))
  add(c.name.replace(/[^a-z0-9]+/gi, ''))
  add(c.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, ''))
  try {
    const host = new URL(c.website ?? '').hostname.replace(/^www\./, '')
    add(host.split('.')[0])
  } catch {}
  return out.slice(0, 4)
}

const ORDER: Ats[] = ['ashby', 'greenhouse', 'lever']

/** acme.com from https://www.acme.com/about */
export function hostOf(url: string | undefined): string {
  try {
    return new URL(url ?? '').hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Is this board the company's own? A board name like "hive" or "mesh" can belong to another
 * company, so the board's careers page (or Greenhouse's board details) must link to the
 * company's website.
 */
export function mentions(page: string, site: string | undefined): boolean {
  const host = hostOf(site)
  if (!host) return false
  return page.toLowerCase().includes(host)
}

/**
 * Clear without fetching the page: a job links to the company's own domain, or the board uses
 * the company's exact YC name and that name is long enough not to be someone else's ("instacart",
 * not "hive").
 */
export function trusted(
  token: string,
  c: Pick<YcCompany, 'slug' | 'website'>,
  jobs: { url: string }[],
): boolean {
  const host = hostOf(c.website)
  if (host && jobs.some((j) => hostOf(j.url) === host || hostOf(j.url).endsWith(`.${host}`)))
    return true
  return token.length >= 7 && (token === c.slug || token === c.slug.replace(/-/g, ''))
}

async function pageMentions(url: string, site: string | undefined): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'coldopen/1.0 (+https://github.com/tiwaker9404/coldopen)' },
      signal: AbortSignal.timeout(20_000),
    })
    return res.ok && mentions(await res.text(), site)
  } catch {
    return false
  }
}

/**
 * The board's careers page (or Greenhouse's board details) links to the company's site, or,
 * failing that, its job descriptions do (Greenhouse leaves them out of the job list unless asked)
 */
async function owns(b: Board, site: string | undefined): Promise<boolean> {
  const t = encodeURIComponent(b.token)
  if (b.ats !== 'greenhouse') return pageMentions(boardPage(b), site)
  return (
    (await pageMentions(`https://boards-api.greenhouse.io/v1/boards/${t}`, site)) ||
    (await pageMentions(`https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`, site))
  )
}

let rejected = 0
let byDescription = 0

const unsure = new Set<string>()

async function find(c: YcCompany): Promise<YcBoard | null> {
  const tokens = tokensFor(c)
  for (const ats of ORDER)
    for (const token of tokens) {
      const b: Board = { ats, token, name: c.name }
      try {
        const body = await bodyOf(b)
        const jobs = readBoard(b, body)
        if (jobs.length === 0) continue
        // Lever and Ashby send each job's description with the list: a board whose posts name
        // the company's own domain ("apply at", "jobs@", "learn more at") is the company's
        const described = !trusted(token, c, jobs) && mentions(JSON.stringify(body), c.website)
        if (described) byDescription++
        if (!trusted(token, c, jobs) && !described && !(await owns(b, c.website))) {
          rejected++
          continue
        }
        let site: string | undefined
        try {
          site = c.website ? new URL(c.website).toString().replace(/^http:/, 'https:') : undefined
        } catch {}
        return {
          ats,
          token,
          name: c.name.slice(0, 80),
          ...(site ? { site } : {}),
          batch: shortBatch(c.batch),
          slug: c.slug,
          ...(c.team_size ? { size: c.team_size } : {}),
        }
      } catch (err) {
        if (!(err instanceof NoBoard)) unsure.add(c.slug)
      }
    }
  return null
}

async function main() {
  const res = await fetch(SOURCE, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`yc-oss returned HTTP ${res.status}`)
  const all = ((await res.json()) as YcCompany[]).filter(
    (c) => c.slug && c.name && c.status !== 'Inactive' && c.status !== 'Acquired',
  )
  const found: YcBoard[] = []
  const queue = [...all]
  let done = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        const b = await find(c)
        if (b) found.push(b)
        if (++done % 100 === 0) console.log(`${done}/${all.length} checked, ${found.length} boards`)
      }
    }),
  )
  // the same board found for two companies (a shared name): keep neither, it's ambiguous
  const count = new Map<string, number>()
  for (const b of found)
    count.set(`${b.ats}:${b.token}`, (count.get(`${b.ats}:${b.token}`) ?? 0) + 1)
  const previous = JSON.parse(await readFile(OUT, 'utf8').catch(() => '[]')) as YcBoard[]
  const merged = merge(
    found.filter((b) => count.get(`${b.ats}:${b.token}`) === 1),
    previous,
    unsure,
    new Set(all.map((c) => c.slug)),
  )
  const boards = merged.boards.sort((a, b) => a.name.localeCompare(b.name))
  if (previous.length && boards.length < previous.length * (1 - MAX_DROP))
    throw new Error(
      `only ${boards.length} boards, down from ${previous.length}: the job boards were probably refusing requests (${unsure.size} companies couldn't be checked). Not publishing; rerun later.`,
    )
  await writeFile(OUT, `${JSON.stringify(boards, null, 0).replace(/},{/g, '},\n{')}\n`)
  const line = `${boards.length} of ${all.length} hiring YC companies have a Greenhouse, Lever or Ashby board (${merged.kept} kept from last run because their check failed; ${byDescription} confirmed by their job descriptions naming the company's site; ${rejected} boards with a matching name belonged to another company, or never linked to its site)`
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### YC boards\n\n${line}\n`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
