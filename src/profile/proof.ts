/**
 * What makes a proof card read well to a stranger who has never seen the résumé: the number,
 * what changed (before → after when the bullet gives both), what the sender did to get there,
 * and where. readableProof() checks a card against the bullet it came from; the drafter uses
 * it to ask for one rewrite, then falls back to proofFromBullet(), which builds the card from
 * the bullet's own words.
 */

export interface ProofCard {
  value: string
  label: string
  did?: string
  where?: string
}

export const PROOF_LIMITS = { value: 12, label: 60, didMin: 12, didMax: 90, where: 40 } as const

export const CHECKS = [
  'has_action',
  'has_result',
  'keeps_before_after',
  'has_where',
  'numbers_from_resume',
  'no_excluded_employer',
  'within_limits',
] as const
export type ProofCheck = (typeof CHECKS)[number]

/** "1,500+" -> "1,500"; "6h" -> "6" */
export const numbersIn = (s: string) =>
  (s.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, ''))

/**
 * A proof as a message quotes it, saying each number once. A change card's value ("6h → 45m")
 * is already in its label ("report prep, from 6 hours to 45 minutes"), so the label goes alone;
 * any other card reads value then label ("40% faster month-end close"). Where is the caller's.
 */
export function proofPhrase(p: { value: string; label: string }): string {
  const said = numbersIn(p.label)
  const change =
    /→|->/.test(p.value) ||
    (numbersIn(p.value).length > 0 && numbersIn(p.value).every((n) => said.includes(n)))
  return change ? p.label : `${p.value} ${p.label}`
}

/* ------------------------------------------------------------- before → after */

const UNIT: Record<string, { short: string; one: string; many: string; mins: number }> = {
  second: { short: 's', one: 'second', many: 'seconds', mins: 1 / 60 },
  minute: { short: 'm', one: 'minute', many: 'minutes', mins: 1 },
  hour: { short: 'h', one: 'hour', many: 'hours', mins: 60 },
  day: { short: 'd', one: 'day', many: 'days', mins: 1440 },
  week: { short: 'w', one: 'week', many: 'weeks', mins: 10080 },
}
const unitOf = (u: string | undefined) => {
  const w = (u ?? '').toLowerCase().replace(/s$/, '')
  return w === 'min' ? 'minute' : w === 'hr' ? 'hour' : w in UNIT ? w : ''
}

export interface Change {
  /** the starting and ending figures, as the label says them ("6 hours", "45 minutes") */
  before: string
  after: string
  /** the number on the card: "6h → 45m", "5 → 3 days", "$48 → $31" */
  value: string
  /** what changed, in the bullet's words: "daily client data synchronization cycles" */
  what: string
  /**
   * The bullet states the change, not the end ("by 2 full days ... against the 5-day
   * baseline"), so the ending figure is worked out. Only this number may be on the card
   * without appearing in the bullet.
   */
  derived?: string
}

const FIG = '([$€£]?\\d[\\d,.]*)\\s?(%|seconds?|minutes?|mins?|hours?|hrs?|days?|weeks?)?'
const FROM_TO = new RegExp(`\\bfrom\\s+${FIG}\\s+to\\s+(?:just\\s+|only\\s+|under\\s+)?${FIG}`, 'i')
const BY_FROM_BASE =
  /\bby\s+(?:a\s+full\s+|over\s+|nearly\s+)?(\d[\d.]*)\s+(?:full\s+)?(seconds?|minutes?|hours?|days?|weeks?)\b.*?\b(\d[\d.]*)[-\s](second|minute|hour|day|week)s?\s+baseline/i
const DOWN = /\b(cut|cutting|reduc\w*|lower\w*|decreas\w*|shrank|shrunk|trimm\w*|shorten\w*)\b/i
const LEAD_VERB =
  /^.*?\b(accelerat\w*|reduc\w*|cut\w*|lower\w*|decreas\w*|improv\w*|increas\w*|rais\w*|grow\w*|grew|boost\w*|lift\w*|shorten\w*|speed\w*|sped)\s+/i

const say = (n: string, unit: string) =>
  unit ? `${n} ${Number(n.replace(/,/g, '')) === 1 ? UNIT[unit]!.one : UNIT[unit]!.many}` : n

/** The before and after in a bullet, when it gives both (or the change and the baseline). */
export function changeOf(text: string): Change | null {
  const m = text.match(FROM_TO)
  if (m) {
    const [, b, bu, a, au] = m
    // "from 3.1% to 4.6%", "from $48 to $31", "from 6 hours to 45 minutes", "from 6 to 9 days"
    const pct = bu === '%' || au === '%'
    const ua = unitOf(au)
    const ub = unitOf(bu) || ua
    const before = pct ? `${b}%` : say(b!, ub)
    const after = pct ? `${a}%` : say(a!, ua)
    const value = pct
      ? `${b}% → ${a}%`
      : ub && ua && ub !== ua
        ? `${b}${UNIT[ub]!.short} → ${a}${UNIT[ua]!.short}`
        : ub
          ? shortest(
              `${b} → ${a} ${UNIT[ub]!.many}`,
              `${b}${UNIT[ub]!.short} → ${a}${UNIT[ub]!.short}`,
            )
          : `${b} → ${a}`
    const what = whatOf(text.slice(0, m.index))
    if (value.length <= 12 && what) return { before, after, value, what }
  }
  const by = text.match(BY_FROM_BASE)
  if (by) {
    const [, change, cu, base, bu] = by
    const u = unitOf(cu)
    if (u && u === unitOf(bu)) {
      const c = Number(change)
      const b = Number(base)
      const a = DOWN.test(text.slice(0, by.index)) ? b - c : b + c
      if (a > 0 && Number.isInteger(a)) {
        const reducer = text.slice(0, by.index).match(DOWN)
        const what = whatOf(
          reducer ? text.slice(reducer.index! + reducer[0].length, by.index) : '',
          true,
        )
        const value = shortest(
          `${b} → ${a} ${UNIT[u]!.many}`,
          `${b}${UNIT[u]!.short} → ${a}${UNIT[u]!.short}`,
        )
        if (what)
          return {
            before: say(String(b), u),
            after: say(String(a), u),
            value,
            what,
            derived: `${a}`,
          }
      }
    }
  }
  return null
}

const shortest = (long: string, short: string) => (long.length <= 12 ? long : short)

// long words a card can say shorter without changing what they mean
const SHORTER: [RegExp, string][] = [
  [/\bsynchroni[sz]ation\b/gi, 'sync'],
  [/\bconfiguration\b/gi, 'config'],
  [/\binfrastructure\b/gi, 'infra'],
  [/\bapplications?\b/gi, 'app'],
  [/\bdocumentation\b/gi, 'docs'],
]
const shorten = (s: string) => SHORTER.reduce((t, [re, w]) => t.replace(re, w), s)

/** "Architected ETL workflows, accelerating daily client data synchronization cycles" -> "daily client data sync cycles" */
function whatOf(before: string, alreadyAfterVerb = false): string {
  const clause = before
    .split(/[,;]\s/)
    .at(-1)!
    .trim()
  const lead = clause.match(LEAD_VERB)
  let what = alreadyAfterVerb ? clause : lead ? clause.slice(lead[0].length) : ''
  what = what
    .replace(/^(the|a|an|our|their)\s+/i, '')
    .replace(/\s+(for|across)\s.*$/i, '')
    .replace(/\s+and\s.*$/i, '')
    .trim()
  return shorten(what)
}

/* ------------------------------------------------------------------- the act */

// verbs that sound like a résumé, and the plain word a stranger would use
const PLAIN_VERB: Record<string, string> = {
  engineered: 'Built',
  architected: 'Built',
  developed: 'Built',
  're-architected': 'Rebuilt',
  rearchitected: 'Rebuilt',
  orchestrated: 'Led',
  spearheaded: 'Led',
  directed: 'Led',
  championed: 'Led',
  leveraged: 'Used',
  utilized: 'Used',
  authored: 'Wrote',
  pioneered: 'Built',
  facilitated: 'Ran',
}
// words that add length, not meaning
const PADDING =
  /\b(custom|comprehensive|production-ready|robust|scalable|seamless(ly)?|cutting-edge|highly|world-class|best-in-class|localized|state-of-the-art)\b,?\s*/gi
/** phrases a card never needs: they tell a stranger nothing */
export const PADDING_PHRASES = [
  'leveraged',
  'orchestrated',
  'spearheaded',
  'utilized',
  'synergi',
  'relative to',
  'baseline',
  'compared to',
  'measured against',
  'against initial planning',
]

const IRREGULAR: Record<string, string> = {
  building: 'Built',
  writing: 'Wrote',
  running: 'Ran',
  leading: 'Led',
  making: 'Made',
  setting: 'Set',
  shipping: 'Shipped',
  rebuilding: 'Rebuilt',
  using: 'Used',
  cutting: 'Cut',
  bringing: 'Brought',
  teaching: 'Taught',
  selling: 'Sold',
}
const PAST_IRREGULAR = new Set(
  [
    'built',
    'rebuilt',
    'led',
    'wrote',
    'ran',
    'made',
    'set',
    'cut',
    'grew',
    'won',
    'took',
    'drove',
    'taught',
    'sold',
    'brought',
    'began',
    'gave',
    'sent',
    'shipped',
    'put',
    'met',
    'kept',
    'found',
    'got',
    'held',
    'spoke',
    'split',
    'shot',
    'spun',
    'stood',
    'rewrote',
  ].map((w) => w.toLowerCase()),
)

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "implementing" -> "Implemented", "structuring" -> "Structured" */
function past(ing: string): string {
  const w = ing.toLowerCase()
  if (IRREGULAR[w]) return IRREGULAR[w]!
  return cap(`${w.replace(/ing$/, '')}ed`)
}

/** Does this line start with what someone did ("Built", "Migrated", "Led")? */
export function startsWithVerb(s: string): boolean {
  const first =
    s
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z-]/g, '') ?? ''
  if (!first) return false
  // "speed", "need", "seed" end in -ed without being past tense
  return PAST_IRREGULAR.has(first) || (/^[a-z-]{3,}ed$/.test(first) && !/eed$/.test(first))
}

const RESULT_LEAD =
  /^(reduc|decreas|cut|lower|increas|improv|rais|boost|lift|grew|grow|achiev|accelerat|sav)/i

/**
 * What the sender did, in the bullet's own words: its opening verb (made plain) and the thing
 * it built, stopping where the bullet turns into detail. A bullet that leads with the result
 * ("Reduced errors by 85% ... by implementing schema checks") gets the act from its "by" part.
 */
export function didOf(text: string, max: number = PROOF_LIMITS.didMax): string {
  let s = text.replace(/\.$/, '').replace(PADDING, '')
  s = s.replace(/\ba ([aeiou])/gi, 'an $1')
  const byAct = s.match(/\bby\s+([a-z]+ing)\s+(.+)$/i)
  if (RESULT_LEAD.test(s) && byAct) s = `${past(byAct[1]!)} ${byAct[2]}`
  const [first, ...rest] = s.split(' ')
  const plain = PLAIN_VERB[first!.toLowerCase()]
  s = [plain ?? cap(first!), ...rest].join(' ')
  // where the bullet turns into detail: a comma, a "that/which", a trailing -ing clause
  const strong = s.split(/,\s|;\s|\s(?:that|which|while|by|ensuring|resulting)\s/)[0]!
  const words = strong.split(' ')
  // "...pipeline migrating 1.5M records": an -ing word followed by a number or "a/the" starts
  // detail; "scoping syncs" or "staging servers" are still the thing that was built
  const ing = words.findIndex(
    (w, i) =>
      i >= 3 &&
      /^[a-z]+ing$/.test(w) &&
      w !== 'using' &&
      /^(\d|[$€£]|a$|an$|the$|all$|over$|more$|its$|their$|our$)/.test(words[i + 1] ?? ''),
  )
  let act = (ing > 0 ? words.slice(0, ing) : words).join(' ')
  // "...via Docker and orchestrated zero-downtime deploys": a second act, once the first is whole
  const second = act.match(/^(\S+(?:\s\S+){3,}?)\s+and\s+[a-z]+ed\s/)
  if (second) act = second[1]!
  // "...migration engine to map": an infinitive with nothing after it says nothing
  act = act.replace(/\s+to\s+[a-z]+$/i, '')
  act = shorten(act)
  if (act.length > max) {
    // a long one stops at a weaker break, keeping the longest start that fits
    const parts = act.split(/(?=\s(?:to|with|for|into|on|across|in)\s)/)
    let keep = parts[0]!
    for (const p of parts.slice(1)) {
      if ((keep + p).length > max) break
      keep += p
    }
    act = keep.length <= max ? keep : clip(keep, max)
  }
  return trimTail(act)
}

const TAIL =
  /\s+(to|a|an|the|and|or|for|with|of|in|into|from|by|on|at|via|across|compared|measured|verified)$/i
function trimTail(s: string): string {
  let t = s.trim().replace(/[,;:]$/, '')
  while (TAIL.test(t)) t = t.replace(TAIL, '')
  return t
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s
  return trimTail(
    s
      .slice(0, max + 1)
      .split(' ')
      .slice(0, -1)
      .join(' '),
  )
}

/* ------------------------------------------------------------ the whole card */

/** a label without résumé padding or a dangling end: "less overhead compared to" -> "less overhead" */
export function unpad(label: string): string {
  const cut = label.split(
    /\s(?:relative to|compared to|compared with|measured against|against|versus|vs\.?)\b/i,
  )[0]!
  return trimTail(shorten(cut))
}

/**
 * How impressive a card is to a stranger: a before → after change first, then big scale
 * (thousands, millions, gigabytes), then everything else. Ties keep the number's size.
 */
export function impressive(p: { value: string }): number {
  if (p.value.includes('→')) return 3_000
  const m = p.value.match(/(\d[\d,.]*)\s?([kKmMbB]|GB|TB)?/)
  if (!m) return 0
  const n = Number(m[1]!.replace(/,/g, ''))
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[(m[2] ?? '').toLowerCase()] ?? 1
  const big = n * scale >= 1000 || /GB|TB/i.test(m[2] ?? '')
  return big ? 2_000 + Math.min(999, Math.log10(n * scale) * 50) : 0
}

/* ------------------------------------------------------------------- checks */

export interface Readable {
  ok: boolean
  checks: Record<ProofCheck, boolean>
  /** what's wrong, worded for the model's rewrite */
  problems: string[]
}

/** Every number the card may use: the bullet's own, plus a worked-out ending figure. */
export function allowedNumbers(bullet: string): Set<string> {
  const ok = new Set(numbersIn(bullet))
  const ch = changeOf(bullet)
  if (ch?.derived) ok.add(ch.derived)
  return ok
}

const VAGUE = new Set([
  'this',
  'that',
  'things',
  'stuff',
  'work',
  'some',
  'many',
  'with',
  'from',
  'into',
])
const DANGLING =
  /\b(to|a|an|the|and|or|for|with|of|in|into|from|by|on|at|via|compared|against|than|relative)$/i

/**
 * Does this card read as a complete, impressive line to someone who never saw the résumé?
 * Each check is about one thing a stranger needs: what was done, what changed, where, and
 * that every number is really on the résumé (and no excluded employer is named).
 */
export function readableProof(
  p: ProofCard,
  bullet: string,
  opts: { exclude?: string[] } = {},
): Readable {
  const problems: string[] = []
  const did = (p.did ?? '').trim()
  const label = p.label.trim()
  const lower = `${did} ${label}`.toLowerCase()

  const padded = PADDING_PHRASES.filter((x) => lower.includes(x))
  // after the verb, a real thing: "Built it all" names nothing, "Built ETL with Docker" does
  const thing = did
    .split(/\s+/)
    .slice(1)
    .some((w) => /^[A-Z]{2,}/.test(w) || (w.length >= 4 && !VAGUE.has(w.toLowerCase())))
  const hasAction =
    did.length >= PROOF_LIMITS.didMin &&
    startsWithVerb(did) &&
    did.split(/\s+/).length >= 3 &&
    thing
  if (!did)
    problems.push('did is missing: say what was done and what was built, starting with a verb')
  else if (!startsWithVerb(did))
    problems.push(`did "${did}" should start with a verb ("Built", "Migrated", "Led")`)
  else if (!hasAction) problems.push(`did "${did}" should name what was built, not just the verb`)
  const didPadded = padded.filter((x) => did.toLowerCase().includes(x))
  if (didPadded.length) problems.push(`did uses résumé padding ("${didPadded.join('", "')}")`)

  const labelWords = label.split(/\s+/).filter(Boolean)
  const labelPadded = padded.filter((x) => label.toLowerCase().includes(x))
  const hasResult =
    /\d/.test(p.value) && labelWords.length >= 2 && !DANGLING.test(label) && !labelPadded.length
  if (!/\d/.test(p.value)) problems.push(`value "${p.value}" has no number`)
  if (labelWords.length < 2) problems.push(`label "${label}" should say what the number counts`)
  if (DANGLING.test(label)) problems.push(`label "${label}" stops mid-phrase`)
  if (labelPadded.length) problems.push(`label uses résumé padding ("${labelPadded.join('", "')}")`)

  const ch = changeOf(bullet)
  let keeps = true
  if (ch) {
    const nums = (s: string) => numbersIn(s)
    const [b] = nums(ch.before)
    const [a] = nums(ch.after)
    const valueOk = p.value.includes('→')
    const labelOk = nums(label).includes(b!) && nums(label).includes(a!)
    keeps = valueOk && labelOk
    if (!valueOk)
      problems.push(
        `the bullet goes from ${ch.before} to ${ch.after}: value should be the change ("${ch.value}"), never the starting or ending figure alone`,
      )
    if (!labelOk) problems.push(`label should say both: "from ${ch.before} to ${ch.after}"`)
  }

  const where = (p.where ?? '').trim()
  const hasWhere = where.length >= 2
  if (!hasWhere) problems.push('where is missing: the employer, school or project')

  const ok = allowedNumbers(bullet)
  const stray = [p.value, label, did].flatMap(numbersIn).filter((n) => !ok.has(n))
  if (stray.length) problems.push(`uses "${stray.join('", "')}", which isn't in the bullet`)

  const all = `${p.value} ${label} ${did} ${where}`.toLowerCase()
  const named = (opts.exclude ?? []).filter((x) => x.trim() && all.includes(x.trim().toLowerCase()))
  const placeholder = /[[\]]|left out|redacted/.test(all)
  if (named.length) problems.push(`mentions "${named.join('", "')}", which must stay out`)
  if (placeholder)
    problems.push('copies a redaction placeholder ("[...]", "left out"); say "Current <role> role"')

  const limits =
    p.value.length <= PROOF_LIMITS.value &&
    label.length >= 3 &&
    label.length <= PROOF_LIMITS.label &&
    (!did || (did.length >= PROOF_LIMITS.didMin && did.length <= PROOF_LIMITS.didMax)) &&
    where.length <= PROOF_LIMITS.where
  if (p.value.length > PROOF_LIMITS.value)
    problems.push(`value is over ${PROOF_LIMITS.value} characters`)
  if (label.length > PROOF_LIMITS.label)
    problems.push(`label is over ${PROOF_LIMITS.label} characters`)
  if (did.length > PROOF_LIMITS.didMax)
    problems.push(`did is over ${PROOF_LIMITS.didMax} characters`)
  if (where.length > PROOF_LIMITS.where)
    problems.push(`where is over ${PROOF_LIMITS.where} characters`)

  const checks: Record<ProofCheck, boolean> = {
    has_action: hasAction && !didPadded.length,
    has_result: hasResult,
    keeps_before_after: keeps,
    has_where: hasWhere,
    numbers_from_resume: stray.length === 0,
    no_excluded_employer: !named.length && !placeholder,
    within_limits: limits,
  }
  return { ok: CHECKS.every((c) => checks[c]), checks, problems }
}
