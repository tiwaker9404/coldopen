#!/usr/bin/env node
/**
 * Builds src/jobs/raised.json: companies in Jobs for you that filed an SEC Form D (the notice a
 * US company files when it sells shares in a private round) in the last month. Read from
 * EDGAR's quarterly form index: one file lists every filing of a quarter by form, so one or two
 * downloads cover the month, with no per-company lookups for EDGAR to throttle. A filer counts
 * only when its name is the company's own ("Ramp Business Corp" for Ramp), so investment
 * vehicles named after a company ("Acme SPV LP") never do. Amounts aren't kept: Form D often
 * states the most the round may raise.
 *
 * SEC asks automated clients to name themselves with a contact address: set SEC_USER_AGENT
 * (e.g. "coldopen you@example.com"), a repository variable in the workflow.
 *
 * Run by the "Raised recently" workflow (weekly), or by hand: node src/jobs/raised-build.ts
 */
import { writeFile } from 'node:fs/promises'
import { boardKey } from './boards.ts'
import { DEFAULT_BOARDS, raisedSince } from './companies.ts'
import { employerKey } from './visa-build.ts'

const OUT = new URL('./raised.json', import.meta.url)
const UA =
  process.env.SEC_USER_AGENT?.trim() ||
  'coldopen job search (https://github.com/tiwaker9404/coldopen)'

export interface Raised {
  /** when the latest Form D was filed, YYYY-MM-DD */
  date: string
  /** the filer, as EDGAR names it */
  filer: string
}

/** Words a company's legal name often adds to its brand: "Ramp Business Corp" for Ramp */
const EXTRA = new Set([
  'business',
  'software',
  'systems',
  'platform',
  'ai',
  'io',
  'app',
  'hq',
  'technologies',
  'technology',
  'labs',
  'group',
  'company',
])

/** Vehicles that invest in a company file under its name too: never the company's own round */
const VEHICLE = /\b(fund|spv|series|lp|l p|partners|capital|ventures|investors?|trust|portfolio)\b/i

/** Is this EDGAR filer the company itself: its name, plus at most one common legal word? */
export function sameFiler(brand: string, filer: string): boolean {
  if (VEHICLE.test(filer)) return false
  const b = employerKey(brand)
  const f = employerKey(filer)
  if (!b || !f) return false
  if (f === b) return true
  if (!f.startsWith(`${b} `)) return false
  const rest = f.slice(b.length + 1).split(' ')
  return rest.length === 1 && EXTRA.has(rest[0]!)
}

/** One Form D in EDGAR's form index */
export interface Filing {
  filer: string
  date: string
}

/**
 * The Form D lines of a quarterly form.idx. Each line is fixed-width columns: form type, company
 * name, CIK, date filed, file name ("D   Acme Inc   1234567   2026-10-01   edgar/data/...").
 */
export function formDs(index: string): Filing[] {
  const out: Filing[] = []
  for (const line of index.split('\n')) {
    const m = /^(D|D\/A)\s{2,}(.+?)\s{2,}\d+\s+(\d{4}-\d{2}-\d{2})\s/.exec(line)
    if (m) out.push({ filer: m[2]!.trim(), date: m[3]! })
  }
  return out
}

/** The quarters (year, 1-4) that cover the 12 months up to `now` */
export function quartersSince(from: Date, now: Date): { year: number; q: number }[] {
  const out: { year: number; q: number }[] = []
  let year = from.getUTCFullYear()
  let q = Math.floor(from.getUTCMonth() / 3) + 1
  const endYear = now.getUTCFullYear()
  const endQ = Math.floor(now.getUTCMonth() / 3) + 1
  while (year < endYear || (year === endYear && q <= endQ)) {
    out.push({ year, q })
    q++
    if (q === 5) {
      q = 1
      year++
    }
  }
  return out
}

/** Each board's latest Form D on or after `since`, from the filings */
export function match(
  boards: { name: string; key: string }[],
  filings: Filing[],
  since: string,
): Record<string, Raised> {
  // index filings by their first word, so each board compares against a handful, not all of them
  const byFirst = new Map<string, Filing[]>()
  for (const f of filings) {
    if (f.date < since) continue
    const first = employerKey(f.filer).split(' ')[0]
    if (!first) continue
    const list = byFirst.get(first)
    if (list) list.push(f)
    else byFirst.set(first, [f])
  }
  const out: Record<string, Raised> = {}
  for (const b of boards) {
    // short names match too many filers to trust
    if (employerKey(b.name).replace(/ /g, '').length < 5) continue
    const first = employerKey(b.name).split(' ')[0]!
    for (const f of byFirst.get(first) ?? []) {
      if (!sameFiler(b.name, f.filer)) continue
      if (!out[b.key] || f.date > out[b.key]!.date) out[b.key] = { date: f.date, filer: f.filer }
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function text(url: string): Promise<string | null> {
  let last = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, 'accept-encoding': 'gzip, deflate' },
      signal: AbortSignal.timeout(120_000),
    })
    if (res.ok) return res.text()
    // a quarter that hasn't started its index yet
    if (res.status === 404) return null
    last = `${res.status} ${res.statusText}`
    await sleep(5_000 * (attempt + 1))
  }
  throw new Error(
    `EDGAR refused ${url}: ${last}${last.startsWith('403') ? ' (set SEC_USER_AGENT to a name and contact email)' : ''}`,
  )
}

async function main() {
  const now = new Date()
  // the last month's rounds only: a raise from months ago isn't news to open an email with
  const since = raisedSince(now)
  const filings: Filing[] = []
  for (const { year, q } of quartersSince(new Date(since), now)) {
    const idx = await text(`https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${q}/form.idx`)
    if (idx) filings.push(...formDs(idx))
    // SEC asks for no more than 10 requests a second
    await sleep(500)
  }
  // early in a quarter its index can still be empty; that's no reason to fail
  if (filings.length === 0) console.log('EDGAR lists no Form D filings for the last month yet')
  const out = match(
    DEFAULT_BOARDS.map((b) => ({ name: b.name, key: boardKey(b) })),
    filings,
    since,
  )
  await writeFile(OUT, `${JSON.stringify(out, null, 0).replace(/},"/g, '},\n"')}\n`)
  const line = `${Object.keys(out).length} of ${DEFAULT_BOARDS.length} companies filed a Form D in the last month (from ${filings.length.toLocaleString('en-US')} Form D filings)`
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Raised recently\n\n${line}\n`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
