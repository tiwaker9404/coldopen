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

/** Places on the sender's profile: employers and schools, for "who shares my background". */
function backgrounds(profile: Profile | undefined): string[] {
  const out: string[] = []
  for (const p of profile?.proof ?? []) {
    const w = p.where?.trim()
    if (w && !out.some((x) => x.toLowerCase() === w.toLowerCase())) out.push(w)
  }
  return out.slice(0, 2)
}

export function peopleSearches(
  company: string,
  opts: { jobTitle?: string | undefined; profile?: Profile | undefined } = {},
): PeopleSearch[] {
  const out: PeopleSearch[] = [
    {
      label: 'Recruiters',
      hint: 'They read every message about open roles',
      url: linkedin(`recruiter ${company}`),
    },
    {
      label: 'Talent acquisition',
      hint: 'Sourcers and talent partners',
      url: linkedin(`talent acquisition ${company}`),
    },
  ]
  const manager = managerFor(opts.jobTitle)
  if (manager)
    out.push({
      label: 'Hiring manager',
      hint: `The ${manager} this role likely reports to`,
      url: linkedin(`${manager} ${company}`),
    })
  else if (opts.profile?.preset !== 'candidate')
    out.push({
      label: 'Decision makers',
      hint: 'Founders and heads of the team you sell to',
      url: linkedin(`founder OR head ${company}`),
    })
  for (const b of backgrounds(opts.profile))
    out.push({
      label: `${b} people`,
      hint: `Shares your ${b} background`,
      url: linkedin(`${b} ${company}`),
    })
  return out
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
