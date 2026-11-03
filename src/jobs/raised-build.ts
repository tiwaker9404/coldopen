#!/usr/bin/env node
/**
 * Builds src/jobs/raised.json: companies in Jobs for you that filed an SEC Form D (the notice a
 * US company files when it sells shares in a private round) in the last 3 months. Read from
 * EDGAR's quarterly form index: one file lists every filing of a quarter by form, so two
 * downloads cover it, with no per-company lookups for EDGAR to throttle. A filer counts
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
  /** dollars sold in the round so far, as the filing states it (not the most it may raise) */
  amount?: number
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
  /** the filing's path in EDGAR, "edgar/data/1234567/0001234567-26-000123.txt" */
  path?: string
}

/**
 * The Form D lines of a quarterly form.idx. Each line is fixed-width columns: form type, company
 * name, CIK, date filed, file name ("D   Acme Inc   1234567   2026-10-01   edgar/data/...").
 */
export function formDs(index: string): Filing[] {
  const out: Filing[] = []
  for (const line of index.split('\n')) {
    const m = /^(D|D\/A)\s{2,}(.+?)\s{2,}\d+\s+(\d{4}-\d{2}-\d{2})\s+(edgar\/\S+)?/.exec(line)
    if (m) out.push({ filer: m[2]!.trim(), date: m[3]!, ...(m[4] ? { path: m[4] } : {}) })
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

/** Where a filing's form lives: edgar/data/CIK/ACCESSION.txt -> .../ACCESSIONNODASHES/primary_doc.xml */
export function formUrl(path: string): string | null {
  const m = /^edgar\/data\/(\d+)\/(\d{10}-\d{2}-\d{6})\.txt$/.exec(path)
  return m
    ? `https://www.sec.gov/Archives/edgar/data/${m[1]}/${m[2]!.replace(/-/g, '')}/primary_doc.xml`
    : null
}

/** "Total Amount Sold" from a Form D's XML, in dollars, or null when it isn't a plain number */
export function amountSold(xml: string): number | null {
  const m = /<totalAmountSold>\s*([\d.,]+)\s*<\/totalAmountSold>/i.exec(xml)
  const n = m ? Number(m[1]!.replace(/,/g, '')) : Number.NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/** Each board's latest Form D on or after `since`, from the filings, with where to read it */
export function match(
  boards: { name: string; key: string }[],
  filings: Filing[],
  since: string,
): Record<string, Raised & { path?: string }> {
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
  const out: Record<string, Raised & { path?: string }> = {}
  for (const b of boards) {
    // short names match too many filers to trust
    if (employerKey(b.name).replace(/ /g, '').length < 5) continue
    const first = employerKey(b.name).split(' ')[0]!
    for (const f of byFirst.get(first) ?? []) {
      if (!sameFiler(b.name, f.filer)) continue
      if (!out[b.key] || f.date > out[b.key]!.date)
        out[b.key] = { date: f.date, filer: f.filer, ...(f.path ? { path: f.path } : {}) }
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
  // the last 3 months' rounds only (the email congratulates only the last month's).
  // RAISED_REPORT_DAYS asks a what-if ("how many raised in 90 days?"): it reports, writes nothing
  const report = Number(process.env.RAISED_REPORT_DAYS) || 0
  const since = report
    ? new Date(now.getTime() - report * 86_400_000).toISOString().slice(0, 10)
    : raisedSince(now)
  const filings: Filing[] = []
  for (const { year, q } of quartersSince(new Date(since), now)) {
    const idx = await text(`https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${q}/form.idx`)
    if (idx) filings.push(...formDs(idx))
    // SEC asks for no more than 10 requests a second
    await sleep(500)
  }
  // early in a quarter its index can still be empty; that's no reason to fail
  if (filings.length === 0) console.log('EDGAR lists no Form D filings for the last 3 months yet')
  const matched = match(
    DEFAULT_BOARDS.map((b) => ({ name: b.name, key: boardKey(b) })),
    filings,
    since,
  )
  // how much each round raised, from its own filing: a few dozen small downloads
  const out: Record<string, Raised> = {}
  for (const [k, { path, ...r }] of Object.entries(matched)) {
    const url = path ? formUrl(path) : null
    const xml = url ? await text(url).catch(() => null) : null
    const amount = xml ? amountSold(xml) : null
    out[k] = { ...r, ...(amount ? { amount } : {}) }
    await sleep(200)
  }
  if (!report) await writeFile(OUT, `${JSON.stringify(out, null, 0).replace(/},"/g, '},\n"')}\n`)
  else
    for (const [k, v] of Object.entries(out))
      console.log(
        `${v.date}  ${v.filer}  ${v.amount ? `$${(v.amount / 1e6).toFixed(1)}M` : 'amount not stated'}  (${k})`,
      )
  const window = report ? `the last ${report} days` : 'the last 3 months'
  const line = `${Object.keys(out).length} of ${DEFAULT_BOARDS.length} companies filed a Form D in ${window} (from ${filings.length.toLocaleString('en-US')} Form D filings)`
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Raised recently\n\n${line}\n`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
