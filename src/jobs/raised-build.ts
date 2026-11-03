#!/usr/bin/env node
/**
 * Builds src/jobs/raised.json: companies in Jobs for you that filed an SEC Form D (the notice a
 * US company files when it sells shares in a private round) in the last 12 months. Read from
 * EDGAR's free company search and filings index. A filer counts only when its name is the
 * company's own ("Ramp Business Corp" for Ramp), so investment vehicles named after a company
 * ("Acme SPV LP") never do. Amounts aren't kept: Form D often states the most the round may raise.
 *
 * Run by the "Raised recently" workflow (weekly), or by hand: node src/jobs/raised-build.ts
 */
import { writeFile } from 'node:fs/promises'
import { boardKey } from './boards.ts'
import { DEFAULT_BOARDS } from './companies.ts'
import { employerKey } from './visa-build.ts'

const OUT = new URL('./raised.json', import.meta.url)
const UA = 'coldopen job search (https://github.com/tiwaker9404/coldopen)'

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

/** The latest Form D in a filer's EDGAR submissions, on or after `since` (YYYY-MM-DD) */
export function latestFormD(
  recent: { form?: string[]; filingDate?: string[] },
  since: string,
): string | null {
  let best: string | null = null
  ;(recent.form ?? []).forEach((form, i) => {
    const d = recent.filingDate?.[i]
    if ((form === 'D' || form === 'D/A') && d && d >= since && (!best || d > best)) best = d
  })
  return best
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function get(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    })
    if (res.ok) return res.json()
    if (res.status === 404) return null
    await sleep(2_000 * (attempt + 1))
  }
  throw new Error(`EDGAR: ${url}`)
}

/** EDGAR filers whose names start like this brand, from its company-name search */
async function filers(name: string): Promise<{ cik: string; name: string }[]> {
  const j = (await get(
    `https://efts.sec.gov/LATEST/search-index?keysTyped=${encodeURIComponent(name)}`,
  )) as { hits?: { hits?: { _id: string; _source?: { entity?: string } }[] } } | null
  return (j?.hits?.hits ?? []).flatMap((h) =>
    h._source?.entity ? [{ cik: h._id, name: h._source.entity }] : [],
  )
}

async function main() {
  const from = new Date(Date.now() - 365 * 86_400_000)
  const day = (d: Date) => d.toISOString().slice(0, 10)
  const out: Record<string, Raised> = {}
  let failed = 0
  for (const b of DEFAULT_BOARDS) {
    // short names match too many filers to trust
    if (employerKey(b.name).replace(/ /g, '').length < 5) continue
    try {
      for (const f of (await filers(b.name)).filter((f) => sameFiler(b.name, f.name))) {
        await sleep(150)
        const sub = (await get(
          `https://data.sec.gov/submissions/CIK${f.cik.padStart(10, '0')}.json`,
        )) as { filings?: { recent?: { form?: string[]; filingDate?: string[] } } } | null
        const date = latestFormD(sub?.filings?.recent ?? {}, day(from))
        if (date && (!out[boardKey(b)] || date > out[boardKey(b)]!.date))
          out[boardKey(b)] = { date, filer: f.name }
      }
    } catch {
      failed++
    }
    // EDGAR asks for no more than 10 requests a second
    await sleep(150)
  }
  await writeFile(OUT, `${JSON.stringify(out, null, 0).replace(/},"/g, '},\n"')}\n`)
  const line = `${Object.keys(out).length} of ${DEFAULT_BOARDS.length} companies filed a Form D in the last 12 months (${failed} searches failed)`
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Raised recently\n\n${line}\n`)
  }
  if (failed > DEFAULT_BOARDS.length / 2) process.exit(1)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
