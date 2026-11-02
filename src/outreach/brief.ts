import { ANSWERED, bestAnswer } from '../job/fit.ts'
import type { Profile } from '../script/types.ts'

/**
 * When they reply: a one-page brief for the call, from what the film already read. What the
 * company says it does, the facts worth knowing, how your record answers the role, what to brush
 * up on, and three questions to ask. Built from the film's own research, so it costs nothing and
 * says nothing the site or post doesn't.
 */

export interface Brief {
  company: string
  /** their own one-line pitch */
  what: string | null
  /** numbers and claims from their site, word for word */
  facts: string[]
  role: {
    title: string
    /** what they ask, and what in your record answers it */
    matches: { asks: string; you: string }[]
    /** what they ask that your profile doesn't show yet: worth an answer before the call */
    prepare: string[]
  } | null
  /** your story in two lines: what you offer, backed by your strongest numbers */
  pitch: string
  questions: string[]
}

interface KitLike {
  name?: string
  headline?: string
  description?: string
  facts?: { text: string; kind: string }[]
}

interface PostLike {
  title?: string
  requirements?: string[]
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

export function briefOf(
  company: string,
  kit: KitLike | null,
  post: PostLike | null,
  profile: Profile | undefined,
): Brief {
  const what = clean(kit?.description) || clean(kit?.headline) || null
  const seen = new Set<string>()
  const facts = (kit?.facts ?? [])
    .filter((f) => f.kind === 'stat' || f.kind === 'claim' || f.kind === 'quote')
    .map((f) => clean(f.text))
    .filter((t) => t.length >= 12 && t.length <= 200 && !seen.has(t) && seen.add(t))
    .slice(0, 4)

  let role: Brief['role'] = null
  if (post?.title) {
    const matches: { asks: string; you: string }[] = []
    const prepare: string[] = []
    for (const r of post.requirements ?? []) {
      const top = profile ? bestAnswer(profile, r) : { score: 0, with: '' }
      if (top.score >= ANSWERED) matches.push({ asks: clip(r, 160), you: top.with })
      else prepare.push(clip(r, 160))
    }
    role = { title: post.title, matches: matches.slice(0, 3), prepare: prepare.slice(0, 3) }
  }

  const proof = (profile?.proof ?? [])
    .slice(0, 2)
    .map((p) => `${p.value} ${p.label}${p.where ? ` at ${p.where}` : ''}`)
  const pitch = profile
    ? `${profile.offer}${proof.length ? `. For example: ${proof.join('; ')}.` : '.'}`
    : ''

  const questions: string[] = []
  const stat = facts[0]
  if (stat)
    questions.push(
      `Your site says “${clip(stat, 90)}”. What does the team need to get to the next milestone on that?`,
    )
  questions.push(
    role
      ? `What does a great first 90 days look like for the ${role.title}?`
      : `What is the team's biggest priority for the next 90 days?`,
  )
  questions.push(
    role?.prepare[0]
      ? `How much of the day-to-day is “${clip(role.prepare[0], 70)}”, and how do new people ramp up on it?`
      : 'What separates someone who is good in this role from someone who is great?',
  )
  return { company, what: what ? clip(what, 240) : null, facts, role, pitch, questions }
}
