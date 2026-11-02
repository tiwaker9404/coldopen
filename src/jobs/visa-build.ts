#!/usr/bin/env node
/**
 * Builds src/jobs/visa.json: which companies in Jobs for you had H-1B petitions approved in the
 * latest year of USCIS's H-1B Employer Data Hub (a free public download), and how many. A company
 * counts only when its name matches an employer's name exactly once common suffixes ("Inc",
 * "LLC") are dropped, and only for names long enough not to be someone else's.
 *
 * Run by the "Visa sponsors" workflow (monthly; USCIS updates the data a few times a year), or by
 * hand: node src/jobs/visa-build.ts
 */
import { writeFile } from 'node:fs/promises'
import { boardKey } from './boards.ts'
import { DEFAULT_BOARDS } from './companies.ts'

const HUB =
  'https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub/h-1b-employer-data-hub-files'
const OUT = new URL('./visa.json', import.meta.url)
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 coldopen-data/1.0'

export interface VisaEntry {
  /** H-1B petitions approved (new and continuing) in that fiscal year */
  approvals: number
  /** the US government fiscal year, e.g. 2025 */
  year: number
}

/** "Stripe, Inc." and "STRIPE INC" both become "stripe" */
export function employerKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[.,'’"()]/g, ' ')
    .replace(
      /\b(inc|incorporated|llc|l l c|ltd|limited|corp|corporation|co|company|pbc|plc|lp|llp|holdings?|technologies|technology|labs?|usa|us|america|dba)\b/g,
      ' ',
    )
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** One CSV line, with quoted fields */
export function csvRow(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') q = false
      else cur += c
    } else if (c === '"') q = true
    else if (c === ',' || c === '\t') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

const num = (s: string | undefined) => Number((s ?? '').replace(/[^0-9]/g, '')) || 0

/** Approvals per employer from a Data Hub export, whatever its column names this year */
export function approvalsFrom(csv: string): Map<string, number> {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/)
  const cols = csvRow(lines[0] ?? '').map((c) => c.toLowerCase())
  const name = cols.findIndex((c) => /employer/.test(c) && !/(city|state|zip|tax|naics)/.test(c))
  const approved = cols
    .map((c, i) => (/approv/.test(c) && !/denial/.test(c) ? i : -1))
    .filter((i) => i >= 0)
  if (name < 0 || approved.length === 0)
    throw new Error(`unexpected columns: ${cols.join(', ').slice(0, 300)}`)
  const out = new Map<string, number>()
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue
    const r = csvRow(line)
    const k = employerKey(r[name] ?? '')
    if (!k) continue
    out.set(k, (out.get(k) ?? 0) + approved.reduce((n, i) => n + num(r[i]), 0))
  }
  return out
}

async function get(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,text/csv,*/*' },
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res
}

async function main() {
  const page = (
    await Promise.all(
      [HUB, 'https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub'].map((u) =>
        get(u)
          .then((r) => r.text())
          .catch(() => ''),
      ),
    )
  ).join('\n')
  if (process.env.VISA_DEBUG)
    for (const m of page.matchAll(/href="([^"]*(?:data|hub|export|20\d\d)[^"]*)"/gi)) console.log('link', m[1])
  const links = [...page.matchAll(/href="([^"]+?\.csv)"/gi)].map((m) =>
    new URL(m[1]!, HUB).toString(),
  )
  // the newest fiscal year in the link's name
  const dated = links
    .map((u) => ({ u, year: Math.max(0, ...[...u.matchAll(/20\d\d/g)].map((m) => Number(m[0]))) }))
    .filter((x) => x.year > 0)
    .sort((a, b) => b.year - a.year)
  if (dated.length === 0) throw new Error(`no CSV files on ${HUB}`)
  const latest = dated[0]!.year
  console.log(`fiscal year ${latest}: ${dated.filter((d) => d.year === latest).length} file(s)`)
  const total = new Map<string, number>()
  for (const { u } of dated.filter((d) => d.year === latest)) {
    for (const [k, n] of approvalsFrom(await (await get(u)).text()))
      total.set(k, (total.get(k) ?? 0) + n)
    console.log(`read ${u}`)
  }
  const out: Record<string, VisaEntry> = {}
  for (const b of DEFAULT_BOARDS) {
    const k = employerKey(b.name)
    // short names ("Zip", "Mesh") match too many employers to trust
    if (k.replace(/ /g, '').length < 5) continue
    const n = total.get(k)
    if (n && n > 0) out[boardKey(b)] = { approvals: n, year: latest }
  }
  await writeFile(OUT, `${JSON.stringify(out, null, 0).replace(/},"/g, '},\n"')}\n`)
  const line = `${Object.keys(out).length} of ${DEFAULT_BOARDS.length} companies had H-1B approvals in FY${latest}`
  console.log(line)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises')
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Visa sponsors\n\n${line}\n`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
