import type { Profile } from '../script/types.ts'

/**
 * Who to send a film to. coldopen never scrapes LinkedIn or messages anyone: it builds the
 * searches a person would type, and matches the company against the connections export they
 * downloaded themselves (LinkedIn → Settings → Data privacy → Get a copy of your data →
 * Connections).
 */

export interface PeopleSearch {
  /** what the search finds, e.g. "Recruiters" */
  label: string
  /** why this one, in a few words */
  hint: string
  url: string
}

/** a group of people to reach, with when to write to them and what to ask */
export type GroupId = 'founders' | 'warm' | 'doing' | 'manager' | 'recruiting'

export interface PeopleGroup {
  id: GroupId
  /** "People doing the job" */
  label: string
  /** when to write to them, in one line */
  why: string
  /** what to ask them, in one line */
  ask: string
  searches: PeopleSearch[]
  /** warm paths only: people you're connected to there, from your Connections.csv */
  known?: Connection[]
}

export interface Connection {
  name: string
  url: string | null
  company: string
  position: string | null
  connectedOn: string | null
}

const linkedin = (keywords: string) =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(keywords)}&origin=GLOBAL_SEARCH_HEADER`

/** "Forward Deployed Engineer" → "engineering manager"; the person a role likely reports to */
export function managerFor(title: string | undefined): string | null {
  if (!title) return null
  const t = title.toLowerCase()
  const rules: [RegExp, string][] = [
    [/data|analytic|scientist|machine learning|\bml\b|\bai\b/, 'head of data'],
    [
      /engineer|developer|software|sre|devops|platform|backend|frontend|full.?stack/,
      'engineering manager',
    ],
    [/product manager|\bpm\b|product owner/, 'director of product'],
    [/design|ux|ui\b/, 'design manager'],
    [/sales|account executive|\bsdr\b|\bbdr\b|business development/, 'head of sales'],
    [/market|growth|brand|content/, 'head of marketing'],
    [/operations|strategy|bizops|chief of staff/, 'head of operations'],
    [/finance|fp&a|account(ant|ing)/, 'head of finance'],
    [/customer success|support|solutions/, 'head of customer success'],
    [/recruit|talent|people|hr\b/, 'head of people'],
  ]
  return rules.find(([re]) => re.test(t))?.[1] ?? null
}

/**
 * Warm paths: the sender's schools and past employers, for "who shares my background". People
 * answer someone from their own school or old team far more often than a stranger.
 */
export function backgrounds(
  profile: Profile | undefined,
): { name: string; kind: 'school' | 'employer' }[] {
  const out: { name: string; kind: 'school' | 'employer' }[] = []
  const add = (name: string | undefined, kind: 'school' | 'employer') => {
    const n = name?.trim()
    if (n && !out.some((x) => x.name.toLowerCase() === n.toLowerCase())) out.push({ name: n, kind })
  }
  for (const s of (profile?.schools ?? []).slice(0, 2)) add(s, 'school')
  for (const p of profile?.proof ?? []) add(p.where, 'employer')
  // the current employer stays out of every search
  const now = profile?.sender.company?.trim().toLowerCase()
  return out.filter((x) => x.name.toLowerCase() !== now).slice(0, 5)
}

/** "Senior Forward Deployed Engineer, Platform (Remote)" → "forward deployed engineer" */
function bareTitle(title: string): string {
  return title
    .split(/\s[-–—|]\s|,|\(|\//)[0]!
    .toLowerCase()
    .replace(
      /\b(senior|sr\.?|junior|jr\.?|staff|principal|lead|founding|associate|intern|ii|iii|iv|i)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The titles people doing this kind of work go by. A Forward Deployed Engineer's peers are
 * often called solutions or customer engineers, so one search per title finds more of them.
 */
const FAMILIES: [RegExp, [keywords: string, label: string][]][] = [
  [
    /forward deployed|deployment|solutions? (engineer|architect|consultant)|sales engineer|customer engineer|implementation/,
    [
      ['forward deployed engineer', 'Forward deployed engineers'],
      ['solutions engineer', 'Solutions engineers'],
      ['customer engineer', 'Customer engineers'],
    ],
  ],
  [
    /\bgtm\b|go.to.market|account executive|\bae\b|growth|\bsdr\b|\bbdr\b|business development/,
    [
      ['GTM engineer', 'GTM engineers'],
      ['account executive', 'Account executives'],
      ['growth', 'Growth team'],
    ],
  ],
  [
    /software|backend|back.end|frontend|front.end|full.?stack|\bswe\b|\bsde\b|developer|engineer/,
    [['software engineer', 'Software engineers']],
  ],
]

/** The searches for people doing the job: its family's usual titles, or the title itself */
export function doingTheJob(title: string | undefined): [keywords: string, label: string][] {
  const t = title ? bareTitle(title) : ''
  if (!t) return []
  const family = FAMILIES.find(([re]) => re.test(t))?.[1]
  if (family) return family
  return [[t, `${t.charAt(0).toUpperCase()}${t.slice(1)}s`.replace(/ss$/, 's')]]
}

/** Who replies most at a company this size goes first: founders at a startup, warm paths at scale */
const ORDER: Record<'small' | 'mid' | 'large', GroupId[]> = {
  small: ['founders', 'warm', 'doing', 'recruiting'],
  mid: ['warm', 'manager', 'founders', 'doing', 'recruiting'],
  large: ['warm', 'manager', 'doing', 'recruiting', 'founders'],
}

/** under 20 people, 20 to 200, and over 200 or not known */
export function sizeOf(team: number | null | undefined): 'small' | 'mid' | 'large' {
  if (team == null || !Number.isFinite(team) || team <= 0) return 'large'
  return team < 20 ? 'small' : team <= 200 ? 'mid' : 'large'
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Who to reach at a company, grouped the way networking works and ordered by who's most likely
 * to reply at its size: founders, warm paths (alumni, old colleagues, people you know there),
 * people doing the job, the hiring manager, and recruiting. Each group says when to write and
 * what to ask. Groups with nothing in them are left out, and the current employer is never
 * searched.
 */
export function peopleSearches(
  company: string,
  opts: {
    jobTitle?: string | undefined
    profile?: Profile | undefined
    /** the YC company it is, when it's one: its YC page lists the founders by name */
    yc?: { batch: string; slug: string } | null | undefined
    /** how many people work there, when known (YC's team size) */
    team?: number | null | undefined
    /** people you're connected to there, from your Connections.csv */
    known?: Connection[] | undefined
    /**
     * the roles the sender wants, when the film has no job link: their saved job search's roles
     * first, then their profile's role (targetRoles() in src/jobs/targets.ts)
     */
    roles?: string[] | undefined
  } = {},
): PeopleGroup[] {
  const size = sizeOf(opts.team)
  const people = opts.team && opts.team > 0 ? `${opts.team} people` : null
  const groups: Record<GroupId, PeopleGroup> = {
    founders: {
      id: 'founders',
      label: 'Founders',
      why:
        size === 'small'
          ? `${people ? `At ${people}` : 'At a startup this size'} the founders read their own email and make every call.`
          : size === 'mid'
            ? 'They still read notes about their product, but write to the team first.'
            : 'Hard to reach at this size: write once you know someone on the team.',
      ask: 'What they’re building next and what’s hard about it.',
      searches: [
        // a YC startup's founders are named on its YC page
        ...(opts.yc
          ? [
              {
                label: 'YC page',
                hint: `Names the founders${opts.yc.batch ? ` (${opts.yc.batch})` : ''}`,
                url: `https://www.ycombinator.com/companies/${encodeURIComponent(opts.yc.slug)}`,
              },
            ]
          : []),
        {
          label: 'Founders',
          hint: 'Message the founder directly',
          url: linkedin(`founder ${company}`),
        },
        { label: 'CEO', hint: 'Sets what the company works on', url: linkedin(`CEO ${company}`) },
        { label: 'CTO', hint: 'Runs the team that builds it', url: linkedin(`CTO ${company}`) },
      ],
    },
    warm: {
      id: 'warm',
      label: 'Warm paths',
      why: 'People from your school or old team answer people like them, and can tell you how it really is.',
      ask: 'How they found it there; they answer people like them.',
      searches: backgrounds(opts.profile).map((b) =>
        b.kind === 'school'
          ? {
              label: `${b.name} alumni`,
              hint: `Went to ${b.name} like you`,
              url: linkedin(`"${b.name}" ${company}`),
            }
          : {
              label: `${b.name} people`,
              hint: `Worked at ${b.name} like you`,
              url: linkedin(`"${b.name}" ${company}`),
            },
      ),
      ...(opts.known?.length ? { known: opts.known } : {}),
    },
    doing: {
      id: 'doing',
      label: 'People doing the job',
      why: 'They, and new grads who just landed it, reply most and can refer you.',
      ask: 'What their first 90 days looked like.',
      searches: [],
    },
    manager: {
      id: 'manager',
      label: 'Hiring manager',
      why: '',
      ask: 'What the team is working on this quarter.',
      searches: [],
    },
    recruiting: {
      id: 'recruiting',
      label: 'Recruiting',
      why: 'They read every note, so keep it short; best once you know which team you want.',
      ask: 'A short note, the film, and the one area you’re interested in.',
      searches: [
        {
          label: 'Recruiters',
          hint: 'Read every message about open roles',
          url: linkedin(`recruiter ${company}`),
        },
        {
          label: 'Talent acquisition',
          hint: 'Run hiring across teams',
          url: linkedin(`talent acquisition ${company}`),
        },
        {
          label: 'Talent partners',
          hint: 'Work with one team’s managers',
          url: linkedin(`talent partner ${company}`),
        },
        {
          label: 'Sourcers',
          hint: 'Find people before roles are posted',
          url: linkedin(`sourcer ${company}`),
        },
        // at a small company the head of people often does the hiring too
        ...(opts.team && opts.team > 0 && opts.team < 50
          ? [
              {
                label: 'Head of people',
                hint: 'Often does the hiring at this size',
                url: linkedin(`head of people ${company}`),
              },
            ]
          : []),
      ],
    },
  }

  // the job's own title; with no job link, the roles a job seeker wants (two at most)
  const titles = opts.jobTitle
    ? [opts.jobTitle]
    : opts.profile?.preset === 'candidate'
      ? (opts.roles?.length ? opts.roles : [opts.profile.sender.role ?? '']).slice(0, 2)
      : []
  const doing = titles
    .flatMap((t) => doingTheJob(t || undefined))
    .filter(([k], i, all) => all.findIndex(([x]) => x === k) === i)
  if (doing.length)
    groups.doing.searches = [
      ...doing.map(([k, label]) => ({
        label,
        hint: `Doing the work at ${company} now`,
        url: linkedin(`${k} ${company}`),
      })),
      {
        label: 'New grads',
        hint: 'Just landed it, and remember how',
        url: linkedin(`new grad ${company}`),
      },
    ]

  const manager = managerFor(opts.jobTitle)
  if (manager) {
    groups.manager.why = `The ${manager} this role likely reports to; they get far fewer messages than recruiters.`
    groups.manager.searches = [
      {
        label: `${manager.charAt(0).toUpperCase()}${manager.slice(1)}`,
        hint: 'Decides who joins the team',
        url: linkedin(`${manager} ${company}`),
      },
    ]
  } else if (opts.profile && opts.profile.preset !== 'candidate')
    // sellers pitch the heads of the team they sell to
    groups.founders.searches.push({
      label: 'Decision makers',
      hint: 'Heads of the team you sell to',
      url: linkedin(`founder OR head ${company}`),
    })

  // the current employer stays out of every search, even when it's the company itself
  const employer = opts.profile?.sender.company?.trim()
  const mentions = employer
    ? new RegExp(`(^|[^a-z0-9])${escapeRe(employer.toLowerCase())}([^a-z0-9]|$)`)
    : null
  const seen = new Set<string>()
  const keep = (s: PeopleSearch) => {
    const text = decodeURIComponent(s.url).toLowerCase()
    if (mentions?.test(text) || seen.has(s.url)) return false
    seen.add(s.url)
    return true
  }
  return ORDER[size]
    .map((id) => ({ ...groups[id], searches: groups[id].searches.filter(keep) }))
    .filter((g) => g.searches.length > 0 || (g.known?.length ?? 0) > 0)
}

/** Every search the groups hold, in order: the old flat list, kept for one release */
export function flatSearches(groups: PeopleGroup[]): PeopleSearch[] {
  return groups.flatMap((g) => g.searches)
}

/* --------------------------------------------------------------- connections */

const SUFFIX =
  /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|gmbh|plc|sa|ag|bv|pvt|private|technologies|technology|tech|labs?|hq|group|holdings|software|systems|ai|io|app)\b\.?/g

/** "Stripe, Inc." and "stripe.com" both become "stripe" */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\.(com|io|ai|co|org|net|dev|app|so|xyz|tech)(\/.*)?$/, '')
    .replace(/&/g, ' and ')
    .replace(SUFFIX, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Is someone who works at `theirs` at the company with key `key`? */
export function sameCompany(key: string, theirs: string): boolean {
  const k = companyKey(theirs)
  if (!k || !key) return false
  if (k === key) return true
  // "Google DeepMind" at "google", or "Meta" when the company is "Meta Platforms"
  const [short, long] = k.length < key.length ? [k, key] : [key, k]
  return short.length >= 4 && new RegExp(`^${short}\\b`).test(long)
}

/** One CSV line, with quoted fields and doubled quotes. */
function csvRow(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}

/**
 * Reads LinkedIn's Connections.csv. It starts with a few lines of notes before the header,
 * and leaves Email blank for most people; emails aren't kept either way.
 */
export function parseConnections(csv: string, max = 30_000): Connection[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/)
  const head = lines.findIndex((l) => /first name/i.test(l) && /company/i.test(l))
  if (head < 0)
    throw new Error(
      "that doesn't look like LinkedIn's Connections.csv: it needs First Name, Last Name and Company columns",
    )
  const cols = csvRow(lines[head]!).map((c) => c.toLowerCase())
  const at = (name: string) => cols.indexOf(name)
  const [first, last, url, company, position, on] = [
    at('first name'),
    at('last name'),
    at('url'),
    at('company'),
    at('position'),
    at('connected on'),
  ]
  const out: Connection[] = []
  for (const line of lines.slice(head + 1)) {
    if (!line.trim()) continue
    const r = csvRow(line)
    const co = r[company] ?? ''
    const name = `${r[first] ?? ''} ${r[last] ?? ''}`.trim()
    if (!co || !name) continue
    out.push({
      name: name.slice(0, 120),
      url: url >= 0 && /^https:\/\/(www\.)?linkedin\.com\//.test(r[url] ?? '') ? r[url]! : null,
      company: co.slice(0, 120),
      position: position >= 0 && r[position] ? r[position]!.slice(0, 160) : null,
      connectedOn: on >= 0 && r[on] ? r[on]!.slice(0, 20) : null,
    })
    if (out.length >= max) break
  }
  return out
}

/** Connections at the company, recruiters and likely managers first. */
export function knownAt(
  connections: Connection[],
  company: string,
  host?: string | null,
  jobTitle?: string,
): Connection[] {
  const keys = [companyKey(company), host ? companyKey(host) : ''].filter(Boolean)
  const manager = managerFor(jobTitle)
  const rank = (c: Connection) => {
    const p = (c.position ?? '').toLowerCase()
    if (/recruit|talent|sourc/.test(p)) return 0
    if (manager && p.includes(manager)) return 1
    if (/head|director|manager|lead|vp|chief|founder/.test(p)) return 2
    return 3
  }
  return connections
    .filter((c) => keys.some((k) => sameCompany(k, c.company)))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}
