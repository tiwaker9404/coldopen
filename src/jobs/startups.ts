import { readFileSync } from 'node:fs'
import { YC_BOARDS } from './companies.ts'
import type { Startup } from './startups-build.ts'

/**
 * Every active YC startup, hiring or not, from src/jobs/startups.json (rebuilt weekly). For
 * reaching founders before a role is posted: plenty of startups never post one.
 */
const ALL: Startup[] = (() => {
  try {
    const raw = JSON.parse(readFileSync(new URL('./startups.json', import.meta.url), 'utf8'))
    return Array.isArray(raw) ? (raw as Startup[]) : []
  } catch {
    return []
  }
})()

/** companies whose open roles Jobs for you already reads */
const WITH_BOARD = new Set(YC_BOARDS.map((b) => b.slug))

export interface StartupQuery {
  q?: string | undefined
  industry?: string | undefined
  /** batches from this year on */
  since?: number | undefined
  /** at most this many people */
  maxTeam?: number | undefined
  /** 'hiring': hiring on YC; 'yc-only': hiring, but only on YC's Work at a Startup (not in Jobs); 'quiet': not posting roles */
  hiring?: 'any' | 'hiring' | 'yc-only' | 'quiet' | undefined
  /** only startups with people in the US (the default) */
  us?: boolean | undefined
  limit?: number | undefined
  offset?: number | undefined
}

export interface StartupRow {
  name: string
  slug: string
  website: string | null
  batch: string
  oneLiner: string | null
  team: number | null
  industry: string | null
  sub: string | null
  hiring: boolean
  /** its open roles are in Jobs for you */
  inJobs: boolean
  /** its page on YC, which names the founders */
  yc: string
  /** its jobs on Work at a Startup, when it's hiring */
  ycJobs: string | null
}

const row = (s: Startup): StartupRow => ({
  name: s.n,
  slug: s.s,
  website: s.w ?? null,
  batch: s.b,
  oneLiner: s.o ?? null,
  team: s.t ?? null,
  industry: s.i ?? null,
  sub: s.u ?? null,
  hiring: s.h,
  inJobs: WITH_BOARD.has(s.s),
  yc: `https://www.ycombinator.com/companies/${s.s}`,
  ycJobs: s.h ? `https://www.ycombinator.com/companies/${s.s}/jobs` : null,
})

export function searchStartups(query: StartupQuery): {
  data: StartupRow[]
  total: number
  industries: { name: string; count: number }[]
} {
  const q = query.q?.trim().toLowerCase()
  const us = query.us ?? true
  const base = ALL.filter((s) => !us || s.us)
  const match = base.filter(
    (s) =>
      (!q ||
        s.n.toLowerCase().includes(q) ||
        (s.o ?? '').toLowerCase().includes(q) ||
        (s.u ?? '').toLowerCase().includes(q)) &&
      (!query.industry || s.i === query.industry || s.u === query.industry) &&
      (!query.since || s.y >= query.since) &&
      (!query.maxTeam || (s.t !== undefined && s.t <= query.maxTeam)) &&
      (query.hiring !== 'hiring' || s.h) &&
      (query.hiring !== 'yc-only' || (s.h && !WITH_BOARD.has(s.s))) &&
      (query.hiring !== 'quiet' || !s.h),
  )
  const counts = new Map<string, number>()
  for (const s of base) if (s.i) counts.set(s.i, (counts.get(s.i) ?? 0) + 1)
  const offset = query.offset ?? 0
  return {
    data: match.slice(offset, offset + (query.limit ?? 30)).map(row),
    total: match.length,
    industries: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
  }
}

const hostOf = (url: string | null | undefined) => {
  try {
    return new URL(/^https?:\/\//.test(url ?? '') ? url! : `https://${url}`).hostname
      .toLowerCase()
      .replace(/^www\./, '')
  } catch {
    return ''
  }
}
const BY_HOST = new Map(ALL.filter((s) => s.w).map((s) => [hostOf(s.w), s]))
const BY_SLUG = new Map(ALL.map((s) => [s.s, s]))

/**
 * The YC company behind a website (or a YC slug), hiring or not, with its team size: who to
 * reach first depends on how many people work there.
 */
export function startupOf(by: {
  site?: string | null | undefined
  slug?: string | null | undefined
}): { slug: string; batch: string; team: number | null } | null {
  const s = (by.slug && BY_SLUG.get(by.slug)) || (by.site && BY_HOST.get(hostOf(by.site))) || null
  return s ? { slug: s.s, batch: s.b, team: s.t ?? null } : null
}
