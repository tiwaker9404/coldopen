import { z } from 'zod'
import type { Job } from './boards.ts'
import { inUS, LEVELS, levelOf, managesOf } from './where.ts'

/**
 * Which open roles to suggest, and why. Deliberately simple and explainable, like profile
 * matching: every point of a score is something the person can see in its reasons (the title
 * matches a role they asked for, the place, how new the post is).
 */

export const SearchSchema = z.object({
  /** roles they want, in their words: "Forward Deployed Engineer", "Solutions Engineer". Empty: every role */
  roles: z.array(z.string().trim().min(2).max(60)).max(8).default([]),
  /** jobs in the US only (the default), or anywhere */
  country: z.enum(['us', 'any']).default('us'),
  /** how senior, read from the title. Empty: any level */
  levels: z.array(z.enum(LEVELS)).max(6).default([]),
  /** people managers, individual contributors, or both */
  roleType: z.enum(['any', 'ic', 'manager']).default('any'),
  /** words that rule a title out: "Sales", "Clinical" */
  excludeTitles: z.array(z.string().trim().min(2).max(40)).max(20).default([]),
  /** skills a post's requirements must name, any of them */
  skills: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  /** skills that rule a post out when its requirements name them */
  excludeSkills: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  /** leave out posts that require a security clearance */
  noClearance: z.boolean().default(false),
  /** leave out posts open to US citizens only */
  noCitizenOnly: z.boolean().default(false),
  /** full time, part time, contract, internship. Empty: any */
  types: z
    .array(z.enum(['full_time', 'part_time', 'contract', 'intern']))
    .max(4)
    .default([]),
  /** remote, hybrid, on site. Empty: any */
  workplaces: z
    .array(z.enum(['remote', 'hybrid', 'onsite']))
    .max(3)
    .default([]),
  /** leave out posts asking for more years of experience than this */
  maxYears: z.number().int().min(0).max(30).nullable().default(null),
  /** places they'd work: "San Francisco", "Bay Area", "New York". Empty: anywhere */
  locations: z.array(z.string().trim().min(2).max(40)).max(8).default([]),
  /** remote roles count too */
  remote: z.boolean().default(true),
  /** leave out staff, principal, director, head-of and manager roles */
  skipSenior: z.boolean().default(false),
  /** only YC companies */
  ycOnly: z.boolean().default(false),
  /** only companies with H-1B approvals last year */
  visaOnly: z.boolean().default(false),
  /** only companies that filed a Form D (raised a private round) in the last year */
  raisedOnly: z.boolean().default(false),
  /** best fit first, or the companies adding the most roles lately first */
  sort: z.enum(['best', 'fastest']).default('best'),
  /** only roles posted in the last week or month */
  within: z.enum(['any', 'day', '3days', 'week', 'month']).default('any'),
  /** companies to leave out, by name */
  exclude: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  /** leave out roles whose listed pay tops out below this (yearly, in dollars); unlisted pay stays */
  minPay: z.number().int().min(0).max(2_000_000).nullable().default(null),
})
export type Search = z.infer<typeof SearchSchema>

export interface Suggestion extends Job {
  score: number
  /** the company's YC batch, "W24", when it's a YC company */
  yc?: string
  /** its page on ycombinator.com (founders, and the roles it posts on Work at a Startup) */
  ycPage?: string
  /** how fast the company is hiring: open roles on its board, and how many went up in 30 days */
  hiring?: { open: number; recent: number }
  /** H-1B petitions the company had approved in the latest fiscal year */
  visa?: { approvals: number; year: number }
  /** the company's latest SEC Form D (a private round) in the last year */
  raised?: { date: string; filer: string }
  /** short reasons, shown as chips: "Forward Deployed Engineer", "San Francisco", "New this week" */
  why: string[]
}

/** Shorthand people use for roles, spelled out the way titles are */
const ALIASES: Record<string, string> = {
  fde: 'forward deployed engineer',
  se: 'solutions engineer',
  swe: 'software engineer',
  sde: 'software engineer',
  pm: 'product manager',
  tpm: 'technical program manager',
  bdr: 'business development representative',
  sdr: 'sales development representative',
  ae: 'account executive',
  csm: 'customer success manager',
  ml: 'machine learning',
  ds: 'data scientist',
  mle: 'machine learning engineer',
}

/** Words that say nothing about the job itself */
const FILLER = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'for',
  'to',
  'in',
  'at',
  'with',
  'i',
  'ii',
  'iii',
  'iv',
  '1',
  '2',
  '3',
  'new',
  'grad',
  'graduate',
  'junior',
  'jr',
  'senior',
  'sr',
  'staff',
  'principal',
  'lead',
  'entry',
  'level',
  'early',
  'career',
])

/** Same-meaning words, folded so "Solution Engineer" matches "Solutions Engineer" */
const STEM: Record<string, string> = {
  solution: 'solutions',
  engineering: 'engineer',
  engineers: 'engineer',
  developer: 'engineer',
  analytics: 'analyst',
  analysts: 'analyst',
  scientist: 'science',
  deployment: 'deployed',
  deploy: 'deployed',
  sales: 'sales',
  customers: 'customer',
  frontend: 'front end',
  backend: 'back end',
  fullstack: 'full stack',
}

export function words(s: string): string[] {
  const spelled = s
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => ALIASES[w] ?? w)
    .join(' ')
  return spelled
    .split(' ')
    .map((w) => STEM[w] ?? w)
    .join(' ')
    .split(' ')
    .filter((w) => w && !FILLER.has(w))
}

const SENIOR =
  /\b(staff|principal|director|head of|vp|vice president|chief|manager|managing|lead|leader|distinguished|architect)\b/i
// a manager or lead is senior only when they asked for something that isn't
const asksFor = (roles: string[], re: RegExp) => roles.some((r) => re.test(r))

/**
 * How well a title fits one role they asked for, from 0 to 3: every word of the role in the
 * title is 3, most of them 2, the role's main noun alone is not enough.
 */
export function titleFit(title: string, role: string): number {
  const want = [...new Set(words(role))]
  if (want.length === 0) return 0
  const have = new Set(words(title))
  const hit = want.filter((w) => have.has(w)).length
  if (hit === want.length) return 3
  // "Solutions Engineer" vs "Sales Engineer": the last word is the job, the rest the kind
  const head = want.at(-1)!
  if (want.length >= 3 && hit >= want.length - 1 && have.has(head)) return 2
  return 0
}

/** Places people write differently from how boards do */
const PLACES: Record<string, string[]> = {
  'bay area': [
    'san francisco',
    'sf',
    'oakland',
    'berkeley',
    'palo alto',
    'mountain view',
    'menlo park',
    'redwood city',
    'san mateo',
    'south san francisco',
    'sunnyvale',
    'san jose',
    'santa clara',
    'cupertino',
    'hayward',
    'fremont',
    'emeryville',
    'foster city',
    'burlingame',
    'san carlos',
    'los altos',
  ],
  'san francisco': ['san francisco', 'sf', 'south san francisco'],
  sf: ['san francisco', 'sf'],
  'new york': ['new york', 'nyc', 'brooklyn', 'manhattan'],
  nyc: ['new york', 'nyc', 'brooklyn', 'manhattan'],
  'los angeles': ['los angeles', 'la', 'santa monica', 'culver city', 'venice'],
  seattle: ['seattle', 'bellevue', 'redmond', 'kirkland'],
  boston: ['boston', 'cambridge', 'somerville'],
  'washington dc': ['washington', 'dc', 'arlington', 'reston'],
  london: ['london'],
}

/** The place they asked for that this location matches, if any */
export function placeFit(location: string, wanted: string): boolean {
  const loc = ` ${location.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  const key = wanted.toLowerCase().trim()
  const names = PLACES[key] ?? [key.replace(/[^a-z0-9]+/g, ' ').trim()]
  return names.some((n) => loc.includes(` ${n} `))
}

const DAY = 86_400_000

export function ago(iso: string | undefined, now: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : Math.max(0, (now - t) / DAY)
}

const nameKey = (n: string) =>
  n
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|labs?|ai|hq)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** "Stripe" leaves out "Stripe, Inc."; a short name has to match whole */
function sameName(key: string, company: string): boolean {
  const c = nameKey(company)
  return c === key || (key.length >= 4 && c.startsWith(`${key} `))
}

/**
 * Jobs that fit the search, best first: title fit, then where, then how new. Jobs whose title
 * fits none of the roles are left out; with no roles at all, nothing is suggested.
 */
export function rank(jobs: Job[], s: Search, now = Date.now()): Suggestion[] {
  const anyRole = s.roles.length === 0
  const wantsSenior = asksFor(s.roles, SENIOR)
  const excluded = s.exclude.map(nameKey).filter(Boolean)
  const excludedTitles = s.excludeTitles.map(
    (w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
  )
  const out: Suggestion[] = []
  const seen = new Set<string>()
  for (const j of jobs) {
    // the same post listed twice on one board (once per office) is one suggestion
    const dupe = `${j.board}|${j.title.toLowerCase()}|${j.location.toLowerCase()}`
    if (seen.has(dupe)) continue

    let fit = anyRole ? 1 : 0
    let role = ''
    for (const r of s.roles) {
      const f = titleFit(j.title, r)
      if (f > fit) {
        fit = f
        role = r
      }
    }
    if (fit === 0) continue
    if (s.country === 'us' && !inUS(j)) continue
    if (s.levels.length && !s.levels.includes(levelOf(j.title))) continue
    if (s.roleType !== 'any' && managesOf(j.title) !== (s.roleType === 'manager')) continue
    if (excludedTitles.some((w) => w.test(j.title))) continue
    if (s.types.length) {
      // a post that doesn't say is a full-time role, unless its title says intern
      const t = j.type ?? (levelOf(j.title) === 'intern' ? 'intern' : 'full_time')
      if (!s.types.includes(t)) continue
    }
    if (s.workplaces.length) {
      const w = j.workplace ?? (j.remote ? 'remote' : null)
      // a post that doesn't say could be hybrid or on site
      if (w ? !s.workplaces.includes(w) : !s.workplaces.some((x) => x !== 'remote')) continue
    }
    if (s.within !== 'any') {
      const d = ago(j.posted, now)
      const max = { day: 1, '3days': 3, week: 7, month: 31 }[s.within]
      if (d === null || d > max) continue
    }
    if (excluded.length && excluded.some((x) => sameName(x, j.company))) continue
    if (s.minPay && j.pay && j.pay.currency === 'USD' && j.pay.max < s.minPay) continue
    if (s.skipSenior && !wantsSenior && SENIOR.test(j.title)) continue
    if (
      s.skipSenior &&
      /\b(senior|sr\.?)\b/i.test(j.title) &&
      !asksFor(s.roles, /\b(senior|sr)\b/i)
    )
      continue

    const why: string[] = [role]
    let score = fit
    if (s.locations.length || !s.remote) {
      const place = s.locations.find((l) => placeFit(j.location, l))
      if (place) {
        // the office that matched, as the board names it: "San Francisco, CA", not every office
        const office = j.location.split(/\s*[|;]\s*/).find((part) => placeFit(part, place))
        why.push(office && office.length <= 32 ? office : place)
        score += 1
      } else if (s.remote && j.remote) {
        why.push('Remote')
        score += 0.5
      } else continue
    } else if (j.remote) why.push('Remote')

    // full-time roles come first; internships follow unless the search asks for them
    const wantsIntern = s.levels.includes('intern') || s.types.includes('intern')
    if (!wantsIntern && (j.type === 'intern' || levelOf(j.title) === 'intern')) score -= 1.5

    const days = ago(j.posted, now)
    if (days !== null) {
      if (days <= 7) {
        why.push('New this week')
        score += 1
      } else if (days <= 30) score += 0.5
      else if (days > 120) score -= 0.5
    }
    seen.add(dupe)
    out.push({ ...j, score, why })
  }
  return out.sort(
    (a, b) =>
      b.score - a.score ||
      (Date.parse(b.posted ?? '') || 0) - (Date.parse(a.posted ?? '') || 0) ||
      a.company.localeCompare(b.company),
  )
}

/** At most `per` suggestions from one company, so one big employer doesn't fill the list */
export function spread<T extends { board: string }>(list: T[], per: number): T[] {
  const n = new Map<string, number>()
  return list.filter((x) => {
    const c = (n.get(x.board) ?? 0) + 1
    n.set(x.board, c)
    return c <= per
  })
}

/**
 * A search to start from: every role in the US, remote included.
 */
export function defaultSearch(_role?: string): Search {
  // every role in the US, until they say what they want
  return SearchSchema.parse({})
}
