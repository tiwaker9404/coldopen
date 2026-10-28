import { isStat } from '../brand/text.ts'
import { BANNED } from '../script/taste.ts'
import type { Profile } from '../script/types.ts'

/** One thing the person did: a bullet from the résumé, and where they did it. */
export interface Entry {
  text: string
  /** employer, school, club or project heading the bullet sits under */
  org: string
  section: string
}

export interface ParsedResume {
  name: string
  email: string | null
  summary: string
  entries: Entry[]
  /** the whole résumé, whitespace collapsed: the only source a draft may quote */
  text: string
  /** exclude terms that matched nothing, usually a typo or a placeholder left in */
  unmatchedExcludes: string[]
}

const BULLET = /^\s*[•●▪◦‣∙·\-–*]\s+/
const SECTION =
  /^(summary|profile|about|objective|experience|work experience|employment|employment history|professional experience|education|projects?|selected projects|publications|research|skills|technical skills|certifications?|awards|honors|leadership|volunteering|activities)\b[:\s]*$/i
const DATES =
  /\b((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(19|20)\d{2}\s*[-–—]\s*(((jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(19|20)\d{2}|present|current|now)\b/gi

export const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Split a résumé into bullets with their context. Résumés vary wildly, so this stays
 * forgiving: a bullet is a line starting with a bullet glyph (plus its wrapped lines), and its
 * "org" is the first non-bullet line above it, minus dates and locations.
 */
export function parseResume(raw: string, exclude: string[] = []): ParsedResume {
  const lines = raw.split('\n').map((l) => l.trim())
  const email = raw.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null
  const name = titleCase(
    lines.find((l) => l && !/@|\d{3}/.test(l) && l.split(' ').length <= 5) ?? '',
  )

  const entries: Entry[] = []
  let section = ''
  let header: string[] = []
  let current: Entry | null = null
  let summary = ''
  const flush = () => {
    if (current && current.text.length > 20)
      entries.push({ ...current, text: collapse(current.text) })
    current = null
  }
  for (const line of lines) {
    if (!line) continue
    if (SECTION.test(line)) {
      flush()
      section = line.replace(/[:\s]+$/, '').toLowerCase()
      header = []
      continue
    }
    if (BULLET.test(line)) {
      flush()
      current = { text: line.replace(BULLET, ''), org: orgOf(header), section }
      continue
    }
    // a wrapped bullet continues until its sentence ends; a line with a date range never does
    if (current && !/[.;!?]$/.test(current.text.trim()) && !DATES.test(line)) {
      DATES.lastIndex = 0
      current.text += ` ${line}`
      continue
    }
    DATES.lastIndex = 0
    // the first plain line after a block of bullets starts the next job's header
    const afterBullets = current !== null
    flush()
    if (/^(summary|profile|about|objective)/.test(section)) summary = collapse(`${summary} ${line}`)
    else header = afterBullets ? [line] : [...header, line].slice(0, 3)
  }
  flush()

  const banned = exclude.map((e) => e.toLowerCase()).filter(Boolean)
  const kept = entries.filter(
    (e) => !banned.some((b) => e.org.toLowerCase().includes(b) || e.text.toLowerCase().includes(b)),
  )
  const lower = raw.toLowerCase()
  const unmatchedExcludes = exclude.filter(
    (x) => x.trim() && !lower.includes(x.trim().toLowerCase()),
  )
  return { name, email, summary, entries: kept, text: collapse(raw), unmatchedExcludes }
}

/** "Rail Inc. Mar 2026 - May 2026" -> "Rail Inc." */
function orgOf(header: string[]): string {
  const first = header[0] ?? ''
  return collapse(
    first
      .replace(DATES, '')
      .replace(/\s+[A-Z][a-zA-Z]+,\s*([A-Z]{2}|USA|India|UK)\b.*$/, '') // trailing "Durham, NC"
      .split(/\s[|·]\s|,\s/)[0]!,
  ).slice(0, 40)
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const NUMBER =
  /(?<![\w.])(?:[$€£]\s?)?\d[\d,.]*(?:\s?(?:%|\+|(?:minutes?|mins?|hours?|hrs?|days?|weeks?|gb|tb|mb|ms|qps|x|k|m|b|bn)\b))?\+?/gi

const QTY = '[$€£]?[\\d.,]+\\s?(?:%|minutes?|hours?|days?|weeks?|seconds?|ms|[kmb]\\b)?'
const CHANGE = new RegExp(
  `([a-z][\\w\\s-]{2,50}?)\\s+from\\s+(${QTY})\\s+to\\s+(?:just\\s+|only\\s+|under\\s+)?(${QTY})`,
  'i',
)
// résumé bullets lead with a verb; strip it (and a second "and <verb>") from a label
const VERBS_LEAD =
  /^((\w+ed|\w+ing|wrote|built|ran|led|made|drove|grew|won|set|took|gave|sent|sold|taught|brought)\s+)(and\s+(\w+ed|wrote|built|ran|led|made|sent|sold)\s+)?/i
const VERB_DOWN = /\b(cut|cutting|reduc\w*|lower\w*|decreas\w*|shrank|shrunk|trimm\w*)\s+/i
// "cut fresh-produce waste by 18% across 42 stores"
const BY = new RegExp(
  `\\b(cut|cutting|reduc\\w*|lower\\w*|decreas\\w*|trimm\\w*|lift\\w*|rais\\w*|increas\\w*|grew|grow\\w*|boost\\w*|improv\\w*)\\s+([\\w\\s-]{3,110}?)\\s+by\\s+(?:a full\\s+|over\\s+|nearly\\s+)?(${QTY})(.*)$`,
  'i',
)

/** A quantity in common units, so "6 hours" and "45 minutes" compare correctly. */
function amount(v: string): number {
  const n = Number.parseFloat(v.replace(/[$€£,]/g, ''))
  const unit = v.toLowerCase().match(/[a-z]+/)?.[0] ?? ''
  const per: Record<string, number> = {
    ms: 1 / 60000,
    sec: 1 / 60,
    second: 1 / 60,
    seconds: 1 / 60,
    min: 1,
    mins: 1,
    minute: 1,
    minutes: 1,
    hour: 60,
    hours: 60,
    hr: 60,
    hrs: 60,
    day: 1440,
    days: 1440,
    week: 10080,
    weeks: 10080,
    k: 1e3,
    m: 1e6,
    b: 1e9,
  }
  return n * (per[unit] ?? 1)
}

/** The most quotable number in a sentence, and the words that say what it counts. */
export function statOf(text: string): { value: string; label: string } | null {
  // "cut latency from 6 hours to just 45 minutes" -> 45 minutes, "latency, down from 6 hours"
  const change = text.match(CHANGE)
  if (change && change[3]!.length <= 12) {
    const what = change[1]!.replace(
      /^.*\b(reduc\w*|cut\w*|lower\w*|decreas\w*|improv\w*|increas\w*|grow\w*|rais\w*|boost\w*)\s+/i,
      '',
    )
    const down = amount(change[3]!) < amount(change[2]!) ? 'down' : 'up'
    const label = clipWords(`${what.trim()}, ${down} from ${change[2]!.trim()}`, 60)
    if (label.length >= 3) return { value: change[3]!.trim(), label }
  }
  const by = text.match(BY)
  if (by && by[3]!.length <= 12) {
    const tail = by[4]!.split(/[,;.]\s|\.$/)[0]!.trim()
    const down = VERB_DOWN.test(`${by[1]} `)
    const time = /(minute|hour|day|week|second|ms)/i.test(by[3]!)
    const dir = time ? (down ? 'faster' : 'slower') : down ? 'less' : 'more'
    const obj = by[2]!.trim().replace(/^(the|a|an|our|their)\s+/i, '')
    const label = clipWords(`${dir} ${obj}${tail ? ` ${tail}` : ''}`, 60)
    return { value: by[3]!.trim(), label }
  }
  if (!isStat(text)) return null
  const hits = [...text.matchAll(NUMBER)].filter(
    (m) => /\d/.test(m[0]) && !/^(19|20)\d{2}$/.test(m[0].trim()),
  )
  if (!hits.length) return null
  // bigger-looking numbers first: units and separators beat bare digits
  const best = hits.sort((a, b) => score(b[0]) - score(a[0]))[0]!
  const value = best[0]
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(\d)\s+(?=[%+])/, '$1')
  if (value.length > 12) return null
  const after = text
    .slice(best.index! + best[0].length)
    .replace(/^[\s,]*(of|in|across|to)?\s*/i, (m) =>
      /(of|in|across)/i.test(m) ? `${m.trim()} ` : '',
    )
  let label = after.split(/[,;.]\s|\.$/)[0]!.trim()
  if (label.split(' ').length < 3) {
    // the number's meaning is before it: "newsletters to 250,000 members", "saved $1.2M a year"
    const before = text
      .slice(0, best.index)
      .split(/[,;]|\bthat\b|\bwhich\b/)
      .at(-1)!
      .trim()
    const saved = /\bsav(ed|ing)$/i.test(before)
    const obj = before
      .replace(/\b(saved|saving|to|for|across|of|with)$/i, '')
      .replace(VERBS_LEAD, '')
      .trim()
    const reached = /\bto$/i.test(before)
    label = saved
      ? `saved${label ? ` ${label}` : ''}${obj ? ` via ${obj}` : ''}`
      : reached && label
        ? `${label} reached with ${obj}`
        : `${label}${obj ? `${label ? ', ' : ''}${obj}` : ''}`
  }
  label = clipWords(
    label
      .replace(/^(of|and)\s+/i, (m) => m.toLowerCase())
      .replace(/\s+(to ensure|ensuring|so that|in order to)\b.*$/i, ''),
    60,
  )
  if (label.length < 3) return null
  return { value, label }
}

function score(v: string): number {
  return (
    (/[%+x]|gb|tb|m\b|k\b/i.test(v) ? 2 : 0) + (/,/.test(v) ? 1 : 0) + Math.min(v.length, 6) / 6
  )
}

export function clipWords(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s
    .slice(0, max + 1)
    .split(' ')
    .slice(0, -1)
    .join(' ')
  return cut.replace(/[,;:]$/, '')
}

/** The start of a bullet, as a short strength: "Engineered a Python data migration script". */
function pointOf(text: string): string {
  const sentence = text.split(/(?<=\.)\s|;\s|\s[-–—]\s/)[0]!.replace(/\.$/, '')
  // stop where the bullet turns into detail: "...in Snowflake that consolidated 9 sources"
  const core = sentence.split(/\s(?:that|which|to|reducing|resulting|by|across|while)\s/)[0]!
  const w = (core.split(' ').length >= 4 ? core : sentence).split(' ').slice(0, 9)
  while (
    w.length > 3 &&
    /^(to|a|an|the|and|or|for|with|of|in|into|from|by|on|that|which)$/i.test(
      w.at(-1)!.replace(/,$/, ''),
    )
  )
    w.pop()
  return w.join(' ').replace(/,$/, '')
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  )

/** How well an entry matches the role someone is applying for. */
export function relevance(entry: Entry, role: string | undefined): number {
  if (!role) return 0
  const r = words(role)
  let n = 0
  for (const w of words(`${entry.text} ${entry.org}`)) if (r.has(w)) n++
  return n
}

/**
 * The no-model draft: proof from bullets that contain real numbers, strengths from the
 * first clause of the strongest bullets. Plain, but every word is from the résumé.
 */
export function deterministicDraft(
  resume: ParsedResume,
  opts: { role?: string; contact?: string } = {},
): Profile {
  const ranked = [...resume.entries].sort(
    (a, b) => relevance(b, opts.role) - relevance(a, opts.role),
  )
  const proof: Profile['proof'] = []
  for (const e of ranked) {
    const st = statOf(e.text)
    if (!st || proof.some((p) => p.value === st.value)) continue
    proof.push({ ...st, ...(e.org.length >= 2 ? { where: e.org } : {}) })
    if (proof.length === 8) break
  }
  const points = ranked
    .map((e) => pointOf(e.text))
    .filter((p, i, all) => p.split(' ').length >= 3 && all.indexOf(p) === i)
    .filter((p) => !BANNED.some((b) => p.toLowerCase().includes(b)))
    .slice(0, 4)
  const offer = clipWords(
    resume.summary.split(/(?<=\.)\s/)[0]?.replace(/\.$/, '') ||
      `${opts.role ?? 'Professional'} with hands-on, measurable results`,
    120,
  )
  return {
    preset: 'candidate',
    sender: { name: resume.name || 'Your name', ...(opts.role ? { role: opts.role } : {}) },
    offer: offer.length >= 3 ? offer : 'Hands-on, measurable results',
    points:
      points.length >= 2
        ? points
        : [...points, 'Delivers measurable results', 'Works closely with stakeholders'].slice(0, 2),
    proof: proof.length ? proof : [{ value: '1', label: 'résumé to turn into proof points' }],
    cta: {
      line: 'Could we talk this week?',
      contact: opts.contact ?? resume.email ?? 'you@example.com',
    },
  }
}
