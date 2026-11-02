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
  'the and for with that this your you our are was from into have has its their they them than what when which who will able strong skills skill experience years year work working build building built end data team teams across using use own owning ensure great good new high help plus etc including such other well'.split(
    ' ',
  ),
)
const stem = (w: string) => (w.length > 4 ? w.replace(/(es|s)$/, '') : w)
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

/** A job post's requirements against someone's profile */
export function fitOf(requirements: string[], profile: Profile): Fit | null {
  if (requirements.length === 0) return null
  let answered = 0
  let best: { requirement: string; with: string; score: number } | null = null
  for (const r of requirements) {
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
