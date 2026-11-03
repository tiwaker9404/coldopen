#!/usr/bin/env node
/**
 * Builds src/jobs/startups.json: every active YC company, hiring or not, from yc-oss (a daily
 * copy of YC's own directory). Plenty of startups never post a role; the Startups page lists them
 * so people can reach the founders before a job exists.
 *
 * Run weekly by the "YC boards" workflow, or by hand: node src/jobs/startups-build.ts
 */
import { writeFile } from 'node:fs/promises'
import { shortBatch } from './yc-build.ts'

const SOURCE = process.env.YC_SOURCE ?? 'https://yc-oss.github.io/api/companies/all.json'
const OUT = new URL('./startups.json', import.meta.url)

/** One startup, with short keys: the file ships with the app */
export interface Startup {
  /** name */
  n: string
  /** YC slug: ycombinator.com/companies/<slug> */
  s: string
  /** website */
  w?: string
  /** batch, short: "W24" */
  b: string
  /** when the batch was, for sorting: 2024.0 (winter) to 2024.75 (fall) */
  y: number
  /** one-liner */
  o?: string
  /** team size */
  t?: number
  /** industry, and the narrower one: "B2B", "Analytics" */
  i?: string
  u?: string
  /** hiring on YC's Work at a Startup */
  h: boolean
  /** has people or an office in the US */
  us: boolean
}

interface Raw {
  name?: string
  slug?: string
  website?: string
  batch?: string
  one_liner?: string
  team_size?: number | null
  industry?: string
  subindustry?: string
  isHiring?: boolean
  status?: string
  regions?: string[]
}

const SEASON: Record<string, number> = { winter: 0, spring: 0.25, summer: 0.5, fall: 0.75 }

export function toStartup(c: Raw): Startup | null {
  if (!c.name || !c.slug || c.status !== 'Active') return null
  const m = /^(winter|spring|summer|fall)\s+(\d{4})$/i.exec(c.batch?.trim() ?? '')
  const y = m ? Number(m[2]) + (SEASON[m[1]!.toLowerCase()] ?? 0) : 0
  let w: string | undefined
  try {
    w = c.website ? new URL(c.website).toString().replace(/^http:/, 'https:') : undefined
  } catch {}
  const sub = c.subindustry?.split('->').pop()?.trim()
  const regions = c.regions ?? []
  return {
    n: c.name.slice(0, 80),
    s: c.slug,
    ...(w ? { w } : {}),
    b: shortBatch(c.batch),
    y,
    ...(c.one_liner ? { o: c.one_liner.replace(/\s+/g, ' ').trim().slice(0, 140) } : {}),
    ...(c.team_size ? { t: c.team_size } : {}),
    ...(c.industry && c.industry !== 'Unspecified' ? { i: c.industry } : {}),
    ...(sub && sub !== c.industry ? { u: sub } : {}),
    h: c.isHiring === true,
    us:
      regions.includes('United States of America') ||
      regions.includes('America / Canada') ||
      regions.length === 0,
  }
}

async function main() {
  const res = await fetch(SOURCE, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`yc-oss returned HTTP ${res.status}`)
  const all = ((await res.json()) as Raw[]).flatMap((c) => {
    const s = toStartup(c)
    return s ? [s] : []
  })
  all.sort((a, b) => b.y - a.y || a.n.localeCompare(b.n))
  await writeFile(OUT, `[\n${all.map((s) => JSON.stringify(s)).join(',\n')}\n]\n`)
  console.log(`${all.length} active YC startups, ${all.filter((s) => s.h).length} hiring on YC`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
