import type { Profile } from '../script/types.ts'

/**
 * How well someone's record answers a job post's requirements. The film's own writer uses the
 * same matching to pick which requirement to feature, so a job's fit and its film agree.
 *
 * Deliberately simple: shared, meaningful words between a requirement and a line of their record
 * (a proof item or one of their points). Every match is something they can see.
 */

// words every job post and résumé share; matching on them says nothing
const VAGUE = new Set(
  'the and for with that this your you our are was from into have has its their they them than what when which who will able strong skills skill experience years year work working build building built end data team teams across using use own owning ensure great good new high help plus etc including such other well optimize optimizing optimise improve improving workflow workflows outcome outcomes directly understand understanding deliver delivering drive driving support supporting manage managing closely partner partners'.split(
    ' ',
  ),
)
const stem = (w: string) => (w.length > 4 ? w.replace(/(es|s)$/, '') : w)
/** the form a word is matched in: "Kubernetes" -> "kubernete" */
export const stemOf = (w: string) => stem(w.trim().toLowerCase())
export const terms = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9+#\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !VAGUE.has(w))
      .map(stem),
  )

/** How well a line of the sender's record answers a requirement, 0 to 1: shared, meaningful words. */
export function answers(record: string, requirement: string): number {
  const a = terms(record)
  const b = terms(requirement)
  if (!a.size || !b.size) return 0
  let n = 0
  for (const w of a) if (b.has(w)) n++
  return n / Math.min(a.size, b.size)
}

type ProofItem = Profile['proof'][number]
export const proofText = (p: ProofItem) => `${p.value} ${p.label} ${p.where ?? ''}`

/** a requirement counts as answered from this much overlap on (the writer's "plainly matches") */
export const ANSWERED = 0.34

export interface Fit {
  /** strong: answers half or more of what they ask; good: a quarter or more; stretch: less */
  level: 'strong' | 'good' | 'stretch'
  answered: number
  of: number
  /** the requirement your record answers best, and what answers it; null when none plainly does */
  best: { requirement: string; with: string } | null
}

/** The line of their record that answers a requirement best, and how well (0 to 1) */
export function bestAnswer(profile: Profile, r: string): { score: number; with: string } {
  let top = { score: 0, with: '' }
  for (const p of profile.proof) {
    const f = answers(proofText(p), r)
    if (f > top.score)
      top = { score: f, with: `${p.value} ${p.label}${p.where ? `, ${p.where}` : ''}` }
  }
  for (const p of profile.points) {
    // a point is a claim, a proof item is evidence: weigh claims a little less
    const f = 0.85 * answers(p, r)
    if (f > top.score) top = { score: f, with: p }
  }
  // a skill they listed answers a requirement that names it
  const req = terms(r)
  for (const k of profile.skills ?? []) {
    const t = terms(k)
    if (t.size && [...t].every((w) => req.has(w)) && top.score < 0.6) top = { score: 0.6, with: k }
  }
  return top
}

/** A job post's requirements against someone's profile */
export function fitOf(requirements: string[], profile: Profile): Fit | null {
  if (requirements.length === 0) return null
  let answered = 0
  let best: { requirement: string; with: string; score: number } | null = null
  for (const r of requirements) {
    const top = bestAnswer(profile, r)
    if (top.score >= ANSWERED) answered++
    // the film quotes requirements up to 160 characters; prefer one it could show
    const score = top.score - (r.length > 160 ? 0.2 : 0)
    if (top.score > 0 && (!best || score > best.score))
      best = { requirement: r, with: top.with, score }
  }
  const share = answered / requirements.length
  return {
    level: share >= 0.5 ? 'strong' : share >= 0.25 ? 'good' : 'stretch',
    answered,
    of: requirements.length,
    best:
      best && best.score >= ANSWERED - 0.01
        ? { requirement: best.requirement, with: best.with }
        : null,
  }
}

/** Words in requirements that say little about a skill, on top of the vague ones */
const GENERIC = new Set(
  'ai computer science engineering engineer statistic statistics mathematic mathematics math physics quantitative operation operations research saas b2b b2c enterprise software platform cloud data analytic analytics knowledge ability abilitie familiarity familiar proficiency proficient understanding excellent communication written verbal degree bachelor master related field equivalent minimum preferred required requirement environment fast paced startup customer customers stakeholder stakeholders problem problems solving solve technical technology technologie product products company companies role roles candidate candidates opportunity passion passionate demonstrated proven track record ideally comfortable want like love must need needs ownership independently collaborate collaborative collaboration excited interest interested deep hands complex scale scaling various multiple least more most business client clients partner partners self motivated detail oriented attention organizational travel time based us u s english plus bonus similar part full also any all can may one two three four five six seven eight nine ten 1 2 3 4 5 6 7 8 9 10'.split(
    ' ',
  ),
)

export interface Gap {
  /** the stem used to match, "kubernete" */
  term: string
  /** how the posts spell it, "Kubernetes" */
  label: string
  /** how many of the jobs ask for it without the profile showing it */
  jobs: number
  /** one requirement that asks for it */
  example: string
}

/**
 * The skills that come up again and again in requirements the profile doesn't answer, across
 * these jobs: what to add to the profile (if they have it) to fit more of them.
 */
export function gapsOf(
  jobs: { id: string; requirements: string[] }[],
  profile: Profile,
  opts: { ignore?: string[]; min?: number; limit?: number } = {},
): Gap[] {
  const ignore = new Set((opts.ignore ?? []).map((t) => t.toLowerCase()))
  const record = terms(
    [
      ...profile.points,
      ...profile.proof.map(proofText),
      ...(profile.skills ?? []),
      profile.offer,
      profile.sender.role ?? '',
    ].join(' '),
  )
  const seen = new Map<string, { jobs: Set<string>; spell: Map<string, number>; example: string }>()
  for (const j of jobs)
    for (const r of j.requirements) {
      if (bestAnswer(profile, r).score >= ANSWERED) continue
      const words = r.split(/[^A-Za-z0-9+#.]+/).filter(Boolean)
      for (const [i, raw] of words.entries()) {
        const word = raw.replace(/\.+$/, '')
        // a sentence's first word is capitalized anyway: only a name or acronym counts there
        if (i === 0 && /^[A-Z][a-z]+$/.test(word) && !KNOWN_LOWER.has(stem(word.toLowerCase())))
          continue
        const t = stem(word.toLowerCase())
        if (word.length < 2 || t.length < 2 || /^\d/.test(t)) continue
        if (VAGUE.has(word.toLowerCase()) || GENERIC.has(t) || GENERIC.has(word.toLowerCase()))
          continue
        if (record.has(t) || ignore.has(t)) continue
        // skills are named, not described: a capital, a symbol or an acronym ("SQL", "C++", "dbt" aside)
        if (!/[A-Z+#]/.test(word.slice(1)) && !/^[A-Z]/.test(word) && !KNOWN_LOWER.has(t)) continue
        const g = seen.get(t) ?? { jobs: new Set(), spell: new Map(), example: r }
        g.jobs.add(j.id)
        g.spell.set(word, (g.spell.get(word) ?? 0) + 1)
        seen.set(t, g)
      }
    }
  return [...seen.entries()]
    .filter(([, g]) => g.jobs.size >= (opts.min ?? 2))
    .map(([term, g]) => ({
      term,
      label: [...g.spell.entries()].sort((a, b) => b[1] - a[1])[0]![0],
      jobs: g.jobs.size,
      example: g.example.length > 160 ? `${g.example.slice(0, 157)}…` : g.example,
    }))
    .sort((a, b) => b.jobs - a.jobs || a.label.localeCompare(b.label))
    .slice(0, opts.limit ?? 6)
}

/** tools people write in lower case */
const KNOWN_LOWER = new Set([
  'dbt',
  'kafka',
  'python',
  'react',
  'node',
  'golang',
  'rust',
  'java',
  'typescript',
  'javascript',
  'kubernete',
  'docker',
  'terraform',
  'spark',
  'airflow',
  'snowflake',
  'excel',
  'tableau',
  'looker',
])
