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
import { writeFile } from 'node:fs/promises'
import { type Ats, type Board, fetchBoardBody, readBoard } from './boards.ts'

const SOURCE = 'https://yc-oss.github.io/api/companies/hiring.json'
const OUT = new URL('./yc.json', import.meta.url)
const CONCURRENCY = 24

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

async function find(c: YcCompany): Promise<YcBoard | null> {
  const tokens = tokensFor(c)
  for (const ats of ORDER)
    for (const token of tokens) {
      const b: Board = { ats, token, name: c.name }
      try {
        const jobs = readBoard(b, await fetchBoardBody(b, { timeoutMs: 20_000 }))
        if (jobs.length === 0) continue
        let site: string | undefined
        try {
          site = c.website ? new URL(c.website).toString() : undefined
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
      } catch {}
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
  const boards = found
    .filter((b) => count.get(`${b.ats}:${b.token}`) === 1)
    .sort((a, b) => a.name.localeCompare(b.name))
  await writeFile(OUT, `${JSON.stringify(boards, null, 0).replace(/},{/g, '},\n{')}\n`)
  const line = `${boards.length} of ${all.length} hiring YC companies have a Greenhouse, Lever or Ashby board`
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### YC boards\n\n${line}\n`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
