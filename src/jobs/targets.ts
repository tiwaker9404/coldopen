import { ANSWERED, terms } from '../job/fit.ts'
import { companyKey, sameCompany } from '../outreach/people.ts'
import type { Profile } from '../script/types.ts'
import type { Job } from './boards.ts'
import { ago, type Search, titleFit } from './rank.ts'
import type { Startup } from './startups-build.ts'
import { inUS } from './where.ts'

/**
 * Which companies to write to this week: companies, not jobs. A 6-person YC startup in the
 * sender's space with no opening today is often the best warm lead, so an opening is one signal
 * among several, never a requirement. Pure and dated by `now`, like rank(): every point of a
 * score is something the card says in its reasons, and every reason is true of the data.
 *
 *   fit        what they do (one-liner, industry) shares words with the sender's skills and
 *              points, or a role they post matches a role the sender wants
 *   reachable  small teams first (under 20, the founders read their own inbox; then 20–200),
 *              plus people the sender already knows there (Connections.csv)
 *   timing     raised in the last 90 days, a matching role posted in the last 14, hiring fast
 *
 * Left out: companies filmed or messaged in the last 60 days, ones the sender hid, and the
 * sender's current employer.
 */

export interface TargetInput {
  profile: Profile | undefined
  search: Search
  /** open roles from the job boards' cache; only ones with a company website count */
  jobs: Pick<Job, 'company' | 'site' | 'title' | 'posted' | 'location' | 'country' | 'remote'>[]
  /** every YC startup, from src/jobs/startups.json */
  startups: Startup[]
  /** each company's latest SEC Form D, by website host */
  raised: Record<string, { date: string; amount?: number }>
  /** the sender's LinkedIn connections */
  connections: { name: string; company: string }[]
  /** their films: the company's host or name, when it was made, and when it was sent */
  films: { host: string | null; company: string | null; at: string; sentAt: string | null }[]
  /** hosts they said "Not for me" to */
  hidden: string[]
  /** with FIT_SEMANTIC on: each one-liner's closest line of their record, on the keyword scale */
  meaning?: Map<string, { score: number; with: string }> | undefined
}

export interface Target {
  company: string
  /** the company's website: "Make the film" starts from it, and "Not for me" hides it */
  site: string
  oneLiner: string | null
  teamSize: number | null
  score: number
  /** plain and true of the data, most telling first; never empty */
  reasons: string[]
  /** its YC batch and page, when it's a YC company */
  yc?: { batch: string; slug: string }
}

const DAY = 86_400_000
/** a film or a sent message this recent means they've already written to them */
export const RECENT_DAYS = 60
const RAISED_DAYS = 90
const POSTED_DAYS = 14
/** this many roles up in 30 days counts as hiring fast */
const FAST = 5

/** "https://www.Acme.com/about" → "acme.com"; a bare host works too */
export function hostOf(site: string | null | undefined): string {
  if (!site) return ''
  try {
    return new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`).hostname
      .toLowerCase()
      .replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** The roles they want: the saved job search's first, then the profile's own role */
export function targetRoles(search: Pick<Search, 'roles'>, profile: Profile | undefined): string[] {
  const out: string[] = []
  for (const r of [...search.roles, profile?.sender.role ?? ''])
    if (r.trim() && !out.some((o) => o.toLowerCase() === r.trim().toLowerCase())) out.push(r.trim())
  return out
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The current employer, matched as a whole word, as people.ts does for searches */
function employerRule(profile: Profile | undefined): RegExp | null {
  const e = profile?.sender.company?.trim().toLowerCase()
  return e ? new RegExp(`(^|[^a-z0-9])${escapeRe(e)}([^a-z0-9]|$)`) : null
}

// words in a sender's points that say nothing about what a company does
const GENERIC = new Set(
  [
    ...'ship ships shipped turn turns explain explains learn learns week one off non messy production technical trade engineer engineers customer customers company companies business product products platform tool tools software solution solutions service services people world time real free open source based powered modern simple easy best fast faster better first every more most make makes made help helps run runs actually want wants need needs lead leads idea ideas thing things way ways day days hour hours minute minutes second seconds result results line lines number numbers code working work'.split(
      ' ',
    ),
  ].flatMap((w) => [...terms(w)]),
)

/** what the sender knows, as words a company's one-liner might share */
function senderWords(profile: Profile | undefined, search: Search) {
  const skills = [...(profile?.skills ?? []), ...search.skills]
    .map((name) => ({ name: name.trim(), words: [...terms(name)] }))
    .filter((s) => s.name && s.words.length)
  const taken = new Set(skills.flatMap((s) => s.words))
  // each point word, in the form the sender wrote it, so a reason can quote it
  const points = new Map<string, string>()
  for (const p of profile?.points ?? [])
    for (const raw of p.toLowerCase().split(/[^a-z0-9+#]+/)) {
      const [w] = [...terms(raw)]
      if (w && w.length >= 4 && !GENERIC.has(w) && !taken.has(w) && !points.has(w))
        points.set(w, raw)
    }
  return { skills, points }
}

/** "a", "a and b", "a, b and c" */
const listOf = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`

const MONTHS =
  'January February March April May June July August September October November December'.split(' ')
const monthOf = (iso: string) => MONTHS[new Date(iso).getUTCMonth()]!

/** "$29M", "$1.2M", or null under a million (Form D amounts are what was sold so far) */
function money(amount: number | undefined): string | null {
  if (!amount || amount < 1_000_000) return null
  const m = amount / 1_000_000
  return `$${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}M`
}

const daysAgo = (d: number) => (d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.floor(d)} days ago`)

/**
 * "Senior Forward Deployed Engineer, Platform (Remote)" → "Senior Forward Deployed Engineer":
 * the shortest start of the title that still names the role, so "Delivery Partner Manager, FDE"
 * keeps its ", FDE" and the reason stays true
 */
function shortTitle(t: string, roles: string[]): string {
  const cuts = [
    t.split(/\s[-–—|]\s|,|\(|\//)[0]!,
    t.split(/\s[-–—|]\s|\(/)[0]!,
    t.split(/\(/)[0]!,
    t,
  ].map((x) => x.trim())
  const named = cuts.find((c) => roles.some((r) => titleFit(c, r) >= 2)) ?? t.trim()
  return named.length <= 70 ? named : `${named.slice(0, 69).trimEnd()}…`
}
const article = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a')

const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? n

interface Entry {
  name: string
  host: string
  site: string
  oneLiner: string | null
  industry: string | null
  sub: string | null
  team: number | null
  yc?: { batch: string; slug: string }
  jobs: TargetInput['jobs']
}

/**
 * The companies most worth a film and a warm message right now, best first. `limit` cuts the
 * list (10 for Today); leave it out for every company that scored.
 */
export function targets(input: TargetInput, now = Date.now(), limit?: number): Target[] {
  const { profile, search } = input
  const roles = targetRoles(search, profile)
  const employer = employerRule(profile)
  const { skills, points } = senderWords(profile, search)
  const hidden = new Set(input.hidden.map(hostOf).filter(Boolean))
  const recent = input.films.filter((f) => {
    const at = Math.max(Date.parse(f.at) || 0, Date.parse(f.sentAt ?? '') || 0)
    return now - at <= RECENT_DAYS * DAY
  })
  const filmedHosts = new Set(recent.map((f) => hostOf(f.host)).filter(Boolean))
  const filmedNames = new Set(recent.map((f) => companyKey(f.company ?? '')).filter(Boolean))

  // every company once, by its website: YC's list first, then the companies whose boards we read
  const all = new Map<string, Entry>()
  for (const s of input.startups) {
    if (search.country === 'us' && !s.us) continue
    const host = hostOf(s.w)
    if (!host || all.has(host)) continue
    all.set(host, {
      name: s.n,
      host,
      site: s.w!,
      oneLiner: s.o ?? null,
      industry: s.i ?? null,
      sub: s.u ?? null,
      team: s.t ?? null,
      yc: { batch: s.b, slug: s.s },
      jobs: [],
    })
  }
  for (const j of input.jobs) {
    const host = hostOf(j.site)
    if (!host) continue
    const e =
      all.get(host) ??
      ({
        name: j.company,
        host,
        site: j.site!,
        oneLiner: null,
        industry: null,
        sub: null,
        team: null,
        jobs: [],
      } satisfies Entry)
    e.jobs.push(j)
    all.set(host, e)
  }

  const out: Target[] = []
  for (const e of all.values()) {
    if (hidden.has(e.host) || filmedHosts.has(e.host) || filmedNames.has(companyKey(e.name)))
      continue
    if (employer && (employer.test(e.name.toLowerCase()) || employer.test(e.host))) continue

    let score = 0
    const lead: string[] = []
    const after: string[] = []

    // fit: their open roles, then what they do
    const matching = e.jobs
      .filter((j) => search.country !== 'us' || inUS(j))
      .filter((j) => roles.some((r) => titleFit(j.title, r) >= 2))
      .sort((a, b) => (Date.parse(b.posted ?? '') || 0) - (Date.parse(a.posted ?? '') || 0))
    let fit = 0
    if (matching.length) fit += 1.5
    const text = terms([e.oneLiner, e.industry, e.sub].filter(Boolean).join(' '))
    const skillHits = skills.filter((s) => s.words.every((w) => text.has(w))).map((s) => s.name)
    const pointHits = [...points].filter(([w]) => text.has(w)).map(([, raw]) => raw)
    const words = [...new Set([...skillHits, ...pointHits])]
    const keyword = Math.min(2, 0.75 * skillHits.length + 0.5 * pointHits.length)
    fit += keyword
    const close = e.oneLiner ? input.meaning?.get(e.oneLiner) : undefined
    const near = !!close && close.score >= ANSWERED
    if (near) fit += 1
    if (fit === 0) continue
    score += fit

    // reachable: who reads the note
    if (e.team && e.team > 0) {
      const people = `${e.team} ${e.team === 1 ? 'person' : 'people'}`
      if (e.team < 20) {
        score += 2
        lead.push(`${people}, so the founders read their own email`)
      } else if (e.team <= 200) {
        score += 1
        lead.push(`${people}, so a note reaches the team that builds it`)
      }
    }

    // timing: a role up lately, a round, a burst of hiring
    const newest = matching[0]
    const days = newest ? ago(newest.posted, now) : null
    if (newest && days !== null && days <= POSTED_DAYS) {
      score += 0.75
      const t = shortTitle(newest.title, roles)
      lead.push(`posted ${article(t)} ${t} role ${daysAgo(days)}`)
    } else if (newest) {
      const t = shortTitle(newest.title, roles)
      after.push(`has ${article(t)} ${t} role open`)
    }
    const round = input.raised[e.host]
    if (
      round &&
      now - Date.parse(round.date) <= RAISED_DAYS * DAY &&
      Date.parse(round.date) <= now
    ) {
      score += 1
      const size = money(round.amount)
      lead.push(`raised ${size ?? 'a round'} in ${monthOf(round.date)}`)
    }
    const lately = new Set(
      e.jobs
        .filter((j) => {
          const d = ago(j.posted, now)
          return d !== null && d <= 30
        })
        .map((j) => `${j.title.toLowerCase()}|${j.location.toLowerCase()}`),
    ).size
    if (lately >= FAST) {
      score += 0.5
      after.push(`added ${lately} roles in the last 30 days`)
    }

    // warm paths: people they already know there
    const key = companyKey(e.name)
    const hostKey = companyKey(e.host)
    const known = input.connections.filter(
      (c) => sameCompany(key, c.company) || (hostKey && sameCompany(hostKey, c.company)),
    )
    if (known.length) {
      score += known.length >= 3 ? 1.5 : 1
      const names = known.slice(0, 2).map((c) => firstName(c.name))
      lead.push(
        known.length === 1
          ? `you know ${names[0]} there`
          : known.length === 2
            ? `you know ${names[0]} and ${names[1]} there`
            : `you know ${names[0]} and ${known.length - 1} others there`,
      )
    }

    if (words.length)
      after.push(`what they do mentions ${listOf(words.slice(0, 3))}, all in your profile`)
    else if (near && close.with.length <= 60) after.push(`what they do is close to “${close.with}”`)
    else if (near) after.push('what they do is close to your own work')

    const reasons = [...lead, ...after]
      .slice(0, 5)
      .map((r) => r.charAt(0).toUpperCase() + r.slice(1))
    out.push({
      company: e.name,
      site: e.site,
      oneLiner: e.oneLiner,
      teamSize: e.team,
      score: Math.round(score * 100) / 100,
      reasons,
      ...(e.yc ? { yc: e.yc } : {}),
    })
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      (a.teamSize ?? Number.POSITIVE_INFINITY) - (b.teamSize ?? Number.POSITIVE_INFINITY) ||
      a.company.localeCompare(b.company),
  )
  return limit === undefined ? out : out.slice(0, limit)
}

/** the 10-a-week target runs on Pacific time, so Sunday evening still counts for that week */
export const WEEK_ZONE = 'America/Los_Angeles'

/** Minutes `zone` is ahead of UTC at instant `t` (negative west of Greenwich) */
function zoneOffset(t: number, zone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(t)
      .map((x) => [x.type, x.value]),
  )
  const wall = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!)
  return Math.round((wall - Math.floor(t / 1000) * 1000) / 60_000)
}

/**
 * Monday 00:00 in `zone` (Pacific by default) of the week `now` is in: the week the
 * 10-a-week target counts. Works across daylight saving changes.
 */
export function weekStart(now: number, zone = WEEK_ZONE): Date {
  const local = new Date(now + zoneOffset(now, zone) * 60_000)
  const day = (local.getUTCDay() + 6) % 7
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - day)
  // midnight is wall-clock time; shift by the zone's offset at that moment (twice, for DST edges)
  let t = midnight - zoneOffset(midnight, zone) * 60_000
  t = midnight - zoneOffset(t, zone) * 60_000
  return new Date(t)
}

/**
 * Network this week's "x of 10": the companies reached since Monday, by a film made or a
 * message marked sent, each company once however many films or edits it got.
 */
export function reachedThisWeek(
  films: { host: string | null; company: string | null; at: string; sentAt: string | null }[],
  now: number,
): number {
  const from = weekStart(now).getTime()
  const seen = new Set<string>()
  for (const f of films) {
    const made = Date.parse(f.at)
    const sent = Date.parse(f.sentAt ?? '')
    if (!(made >= from && made <= now) && !(sent >= from && sent <= now)) continue
    const key = hostOf(f.host) || (f.company ?? '').trim().toLowerCase()
    if (key) seen.add(key)
  }
  return seen.size
}

/** the recruiter's playbook: 10 people a week, 40 a month */
export const WEEKLY_TARGET = 10
