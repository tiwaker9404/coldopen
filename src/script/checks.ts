import type { BrandKit, Fact } from '../brand/types.ts'
import { jobWordsIn } from '../outreach/voice.ts'
import { rankProof, relevance } from '../profile/proof.ts'
import { aboutText, notAnIdea, pitchAsIdeas } from './ideas.ts'
import { BANNED, LIMITS } from './taste.ts'
import type { Profile, Script } from './types.ts'

export const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

const NUMBER = /\d[\d,.]*\s?(%|x|k|m|min|minutes|hours|days)?/gi

export function numbersIn(s: string): string[] {
  return (s.match(NUMBER) ?? []).map((n) =>
    n.replace(/[,\s]/g, '').toLowerCase().replace(/\.$/, ''),
  )
}

const STOP = new Set(
  'the and for with that this your you our are was from into have has its their they them than what when which who will just about over more most only also like'.split(
    ' ',
  ),
)
// words that appear in any pitch and so can't show a real connection to the sender
const GENERIC = new Set(
  'show shows help helps team teams make makes give gives work works better faster every real using user users people companies company business growth grow'.split(
    ' ',
  ),
)
const content = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  )
/** Share of a line's content words that also appear in a source: 1 means a pure restatement. */
export function overlap(line: string, source: string): number {
  const a = content(line)
  if (a.size === 0) return 0
  const b = content(source)
  let n = 0
  for (const w of a) if (b.has(w)) n++
  return n / a.size
}

/* --------------------------------------------- a fact a stranger can read */

const DANGLING =
  /^(this|that|these|those|it|it's|its|they|they're|their|them|he|she|his|her|such|also|and|but|or|so|here|there|the above)\b/i
const JUNK =
  /\b(click here|learn more|read more|find out more|see more|see how|cookies?|privacy policy|terms of (service|use)|all rights reserved|sign up|sign in|log ?in|subscribe|unsubscribe|accept all|skip to)\b|©|\bcopyright\b/i
// words any company says, so sharing one with their homepage doesn't show the line is about them
const COMMON = new Set([
  ...GENERIC,
  ...'customer customers team teams every more time today new now product products platform world first best great easy simple built build'.split(
    ' ',
  ),
])
/** content words, plural or not ("exchanges" and "exchange" match) */
const stems = (s: string) =>
  new Set(
    (s.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? [])
      .filter((w) => !STOP.has(w) && !COMMON.has(w))
      .map((w) => w.replace(/'s$/, '').replace(/(?<=[a-z]{3})(es|s)$/, '')),
  )

/** What the line is about, to tell whether a fact is about them: their name and what they say they do */
export interface FactContext {
  name: string
  headline?: string
  description?: string
}

/**
 * Why a fact can't be quoted on its own, or null when it can. The fact scene shows one line with
 * nothing around it but a caption ("From their changelog, Oct 2026"), so it has to read whole to
 * someone who has never seen the page: a full sentence of 6 to 25 words, about what this company
 * does, not leaning on a line before it ("It also…"), and not a link, a legal line or a question.
 */
export function notAlone(fact: Pick<Fact, 'text'>, company: FactContext): string | null {
  const t = fact.text
    .trim()
    .replace(/^["“‘']+|["”’']+$/g, '')
    .trim()
  const n = words(t)
  if (n < 6) return `it has ${n} words; a line needs 6 to make sense on its own`
  if (n > 25) return `it has ${n} words; at most 25 fit on screen and read at a glance`
  if (/\?/.test(t)) return "it's a question"
  if (/(…|\.\.\.)$/.test(t)) return 'it was cut off mid-sentence'
  if (/[:;,–—-]$/.test(t)) return 'it ends mid-sentence'
  if (!/^[A-Z0-9$€£]/.test(t)) return "it doesn't start like a sentence"
  if (DANGLING.test(t))
    return `it starts with "${t.match(DANGLING)![0]}", which points at something not on screen`
  const loose = loosePronoun(t)
  if (loose) return `"${loose}" points at something that isn't in the line`
  if (JUNK.test(t)) return 'it reads like a link, cookie or legal line'
  // "Dana Ruiz, VP Operations at Fieldstone Foods": names and menus, not a sentence
  const alpha = t
    .split(/\s+/)
    .slice(1)
    .filter((w) => /^[A-Za-z]/.test(w))
  const capped = alpha.filter((w) => /^[A-Z]/.test(w)).length
  if (alpha.length >= 4 && capped / alpha.length >= 0.7) return 'it reads like a heading or a menu'
  const lower = t.toLowerCase()
  const first = company.name.trim().split(/\s+/)[0]!.toLowerCase()
  const named =
    first.length >= 2 && new RegExp(`\\b${first.replace(/[^a-z0-9]/g, '.')}`).test(lower)
  const ours = /\b(we|we're|we've|we'll|our|us)\b/i.test(t)
  const about = stems(`${company.name} ${company.headline ?? ''} ${company.description ?? ''}`)
  // "returners" is about "returns": one word may start the other, when it's 5 letters or more
  const kin = (a: string, b: string) =>
    a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)))
  const shares = [...stems(t)].some((w) => [...about].some((a) => kin(w, a)))
  // "11 minutes saved per visit on documentation": a measured result on their own page is theirs
  const measured = /^[$€£]?\d/.test(t)
  if (!named && !ours && !shares && !measured)
    return `it doesn't name ${company.name} or what it does`
  return null
}

const POINTERS = new Set([
  'it',
  "it's",
  'its',
  'this',
  'that',
  "that's",
  'these',
  'those',
  'they',
  "they're",
  'them',
])
// "this week", "that tool": a determiner with its own noun, not a pointer
const DETERMINERS = new Set(['this', 'that', 'these', 'those'])
// words before a pronoun that it can't be pointing back to
const NOT_THINGS = new Set(
  "we we'll we're we've we'd our ours us i i'm i've i'll you you'll you're your yours he she him her his and but or nor so yet the a an with for to of in on at by from into onto up out off over about than then now just also very really still even only all any some each every can can't could will won't would should shall may might must do does did don't doesn't didn't is isn't are aren't was wasn't were be been being has have had not no yes here there when while where how why what which who whom whose if because as".split(
    ' ',
  ),
)
// verbs, whose object a pronoun usually is ("We'll show it live")
const VERBS = new Set(
  'show see try build make ship run use get give take watch check love like need want find launch join demo share send start keep help let put bring turn open read write learn test fix set grow scale sell buy book call meet ask tell hear say know think feel'.split(
    ' ',
  ),
)
const baseVerb = (w: string) =>
  [w, w.replace(/s$/, ''), w.replace(/ed$/, ''), w.replace(/ing$/, ''), w.replace(/es$/, '')].some(
    (x) => VERBS.has(x),
  )
const isNoun = (w: string) => /^[a-z]+$/.test(w) && !NOT_THINGS.has(w) && !baseVerb(w)

/**
 * A pronoun in the middle of a line that has nothing before it in the same line to point at:
 * "We'll show it live in 20 minutes" (show what?). The line is quoted alone, so "it" has to be
 * something on screen. Returns the pronoun, or null. "this week" and "that tool" are fine, and
 * so is "Our dashboard makes it easy" (it is the dashboard).
 */
export function loosePronoun(text: string): string | null {
  const raw = text.split(/\s+/).filter(Boolean)
  const toks = raw.map((w) =>
    w
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, ''),
  )
  for (let i = 1; i < toks.length; i++) {
    const w = toks[i]!
    if (!POINTERS.has(w)) continue
    const next = toks[i + 1]
    if (DETERMINERS.has(w) && next && isNoun(next)) continue
    const before = toks.slice(0, i)
    const named =
      before.some((b) => b.length >= 3 && isNoun(b)) ||
      raw.slice(1, i).some((r) => /^[A-Z][a-zA-Z]/.test(r)) ||
      before.some((b) => /\d/.test(b))
    if (!named) return raw[i]!.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '')
  }
  return null
}

/* --------------------------------------------- a builder's take, not an application */

const ESC = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The words in a job seeker's line that read like a job pitch: the JOB_WORDS from voice.ts, and
 * "hire me" or "interview". Quoted text is theirs (a requirement or a fact read back in
 * quotation marks), and so is the company's own name ("Hiring Hub"), so neither counts.
 */
export function jobPitchIn(text: string, company = ''): string[] {
  // their name, and the short form lines use ("Hiring" for Hiring Hub)
  const names = company.trim() ? [company.trim(), company.trim().split(/\s+/)[0]!] : []
  const t = names.reduce((acc, n) => acc.replace(new RegExp(`\\b${ESC(n)}\\b`, 'gi'), ' '), text)
  const asks = [/\bhire me\b/i, /\binterview(s|ed|ing)?\b/i]
    .map((re) =>
      t
        .replace(/"[^"\n]*"|“[^”\n]*”/g, ' ')
        .match(re)?.[0]
        ?.toLowerCase(),
    )
    .filter((w): w is string => Boolean(w))
  return [...jobWordsIn(t), ...asks]
}

/** A fact the film may quote: it makes sense to someone seeing it with no other context. */
export const standsAlone = (fact: Pick<Fact, 'text'>, company: FactContext) =>
  notAlone(fact, company) === null

/**
 * The facts a script may feature: those that stand alone. A job post's requirements are its own
 * words, quoted as such ("From your Operations Analyst post"), so they're offered as they are.
 * When nothing on the site stands alone, everything is offered: a film beats none.
 */
export function quotableFacts(
  kit: Pick<BrandKit, 'name' | 'headline' | 'description' | 'facts'>,
): Fact[] {
  const ok = kit.facts.filter((f) => f.kind === 'requirement' || standsAlone(f, kit))
  return ok.some((f) => f.kind !== 'requirement') ? ok : kit.facts
}

/**
 * Every rule from the taste list, as code. Returns human-readable violations that are fed
 * back to the model verbatim, so they double as revision instructions.
 */
export function checkScript(
  script: Script,
  kit: BrandKit,
  profile: Profile,
  opts: { semantic?: ReadonlyMap<number, number> } = {},
): string[] {
  const v: string[] = []
  // a job seeker's pitch is ideas for their product, when their site and the profile allow it
  const ideas = profile.preset === 'candidate' && pitchAsIdeas(kit, profile)
  const pointMax = ideas ? LIMITS.idea : LIMITS.point
  const lines: [string, string, number][] = [
    ['hook', script.hook, LIMITS.hook],
    ['noticed', script.noticed, LIMITS.noticed],
    ['insight.why', script.insight.why, LIMITS.why],
    ['pitch.headline', script.pitch.headline, LIMITS.headline],
    ...script.pitch.points.map(
      (p, i) => [`pitch.points[${i}]`, p, pointMax] as [string, string, number],
    ),
    ['cta', script.cta, LIMITS.cta],
  ]

  for (const [field, text, max] of lines) {
    const n = words(text)
    if (n === 0) v.push(`${field} is empty`)
    if (n > max) v.push(`${field} has ${n} words; the limit is ${max}`)
    const lower = text.toLowerCase()
    for (const b of BANNED) if (lower.includes(b)) v.push(`${field} uses the banned phrase "${b}"`)
    if (text.includes('!')) v.push(`${field} uses an exclamation mark`)
    if (/\p{Extended_Pictographic}/u.test(text)) v.push(`${field} uses an emoji`)
    if (/#\w/.test(text)) v.push(`${field} uses a hashtag`)
    const shouty = text
      .match(/\b[A-Z]{5,}\b/g)
      ?.filter(
        (w) => !kit.name.toUpperCase().includes(w) && !allSourceText(kit, profile).includes(w),
      )
    if (shouty?.length) v.push(`${field} uses ALL CAPS ("${shouty[0]}")`)
  }

  // grounding: every number must exist in a source. With a job post, lines about the sender
  // may only use the sender's own numbers: "5+ years" in the post is not five years on the résumé.
  const sources = numbersIn(allSourceText(kit, profile))
  const ownNumbers = numbersIn(profileText(profile))
  const aboutSender = (field: string) => !!kit.job && !/^(hook|noticed)$/.test(field)
  // the ask may repeat the sender's own ask ("Could we talk for 15 minutes?")
  const askNumbers = numbersIn(profile.cta.line)
  for (const [field, text] of lines) {
    const pool =
      field === 'cta'
        ? [...(aboutSender(field) ? ownNumbers : sources), ...askNumbers]
        : aboutSender(field)
          ? ownNumbers
          : sources
    for (const n of numbersIn(text)) {
      if (!pool.some((s) => s === n || s.startsWith(n) || n.startsWith(s))) {
        v.push(
          aboutSender(field)
            ? `${field} mentions "${n}", which is not in your profile; numbers from the job post are what they want, not what you've done`
            : `${field} mentions "${n}", which is not in the company facts or the sender profile`,
        )
      }
    }
  }

  if (!kit.facts.some((f) => f.id === script.insight.factId)) {
    v.push(
      `insight.factId "${script.insight.factId}" is not one of the fact ids (${kit.facts
        .slice(0, 12)
        .map((f) => f.id)
        .join(', ')}, ...)`,
    )
  }
  const chosen = kit.facts.find((f) => f.id === script.insight.factId)
  const reqs = kit.facts.filter((f) => f.kind === 'requirement' && f.text.length <= 160)
  // made from a job post: the featured line is a requirement, answered with the sender's record
  // a hiring film leads with the company, not with what it asks of applicants
  const hiring = profile.preset === 'hiring'
  if (!hiring && kit.job && chosen && chosen.kind !== 'requirement' && reqs.length) {
    v.push(
      `insight.factId "${chosen.id}" is from their homepage; feature one of the job's requirements instead (${reqs
        .slice(0, 8)
        .map((f) => f.id)
        .join(', ')}), the one your proof answers best`,
    )
  }
  if (kit.job && chosen?.kind === 'requirement' && chosen.text.length > 160)
    v.push(
      `insight.factId "${chosen.id}" is too long to show on screen; pick a shorter requirement`,
    )
  // the fact is shown with nothing around it but where it's from, so it has to read on its own
  const offered = quotableFacts(kit)
  if (chosen && !offered.includes(chosen)) {
    const why = notAlone(chosen, kit)
    v.push(
      `insight.factId "${chosen.id}" doesn't make sense out of context${why ? ` (${why})` : ''}; pick one that reads whole on its own (${offered
        .filter((f) => f.kind !== 'headline')
        .slice(0, 6)
        .map((f) => f.id)
        .join(', ')})`,
    )
  }
  // a number lands harder than a sentence; insist on one when the site offers a readable stat
  const stats = offered.filter((f) => f.kind === 'stat' && f.text.length <= 160)
  if ((!kit.job || hiring) && chosen && chosen.kind !== 'stat' && stats.length) {
    v.push(
      `insight.factId "${chosen.id}" is a ${chosen.kind}; pick one of the stats instead (${stats
        .slice(0, 6)
        .map((f) => f.id)
        .join(', ')})`,
    )
  }
  for (const i of script.proof) {
    if (i >= profile.proof.length)
      v.push(`proof index ${i} is out of range (0-${profile.proof.length - 1})`)
  }
  if (new Set(script.proof).size !== script.proof.length) v.push('proof indices repeat')

  // the lines have jobs; restating what's already on screen does none of them
  if (words(script.hook) < 3)
    v.push(`hook "${script.hook}" is too bare; greet them in 3 to ${LIMITS.hook} words`)
  if (kit.headline && overlap(script.noticed, kit.headline) > 0.8 && !/["“”]/.test(script.noticed))
    v.push(
      'noticed repeats their headline; say what you noticed about it, or quote it inside quotation marks',
    )
  if (chosen && overlap(script.insight.why, chosen.text) > 0.6)
    v.push(
      `insight.why repeats the fact, which is already on screen; say why it matters to them given what ${profile.sender.company ?? 'you'} offer${profile.sender.company ? 's' : ''}`,
    )
  // the reason it matters has to point at the sender, or it's just a compliment
  const sender = `${profile.sender.company ?? ''} ${profile.offer} ${profile.points.join(' ')}`
  const firstPerson = /\b(i|i'm|i've|my|me)\b/i.test(script.insight.why)
  // answering a requirement means pointing at something on the record, not just "I can"
  const onRecord = [...content(script.insight.why)].some(
    (w) => !GENERIC.has(w) && content(profileText(profile)).has(w),
  )
  if (kit.job && firstPerson && !onRecord)
    v.push(
      'insight.why must answer the requirement with something from your profile or proof (a result, a place, a skill it names); "I can do this" is not evidence',
    )
  // a recruiter's film answers the requirement with the candidate's record, said to them
  const secondPerson = /\b(you|your|you've|you're)\b/i.test(script.insight.why)
  if (profile.preset === 'recruiter' && kit.job && secondPerson && !onRecord)
    v.push(
      "insight.why must point at something on the candidate's record (a result, a place, a skill it names); a compliment is not evidence",
    )
  if (profile.preset === 'recruiter' && firstPerson)
    v.push(
      'insight.why speaks as "I"; in a recruiter\'s film, speak to the candidate as "you" and about the company as "we"',
    )
  const connects =
    profile.preset === 'candidate'
      ? firstPerson
      : profile.preset === 'recruiter' || hiring
        ? secondPerson || /\b(we|our|us)\b/i.test(script.insight.why)
        : /\b(we|our|us)\b/i.test(script.insight.why) ||
          [...content(script.insight.why)].some((w) => !GENERIC.has(w) && content(sender).has(w))
  if (!connects)
    v.push(
      profile.preset === 'candidate'
        ? 'insight.why must connect the fact to you (use "I" or "my"); a compliment alone is filler'
        : profile.preset === 'recruiter' || hiring
          ? 'insight.why must connect it to the person watching (use "you" or "your"); a compliment alone is filler'
          : `insight.why must connect the fact to what ${profile.sender.company ?? 'the sender'} offers (name it, or the problem it solves); a compliment alone is filler`,
    )
  // a job seeker's film reads like a builder's take on their product, not an application: the
  // hook, noticed, why, headline and ask never say role, job, hiring or "hire me"
  if (profile.preset === 'candidate') {
    const said: [string, string][] = [
      ['hook', script.hook],
      ['noticed', script.noticed],
      ['insight.why', script.insight.why],
      ['pitch.headline', script.pitch.headline],
      ['cta', script.cta],
    ]
    for (const [field, text] of said) {
      const pitch = jobPitchIn(text, kit.name)
      if (pitch.length)
        v.push(
          `${field} says "${pitch[0]}", which reads like a job pitch (not_job_pitch); talk about their product and what you'd try with it instead`,
        )
    }
  }
  // the pitch may be tailored to them, but it can't claim things the profile doesn't say
  // (deel.com: a job seeker's film pitched "AI agent platform for global payroll")
  // naming the company you're writing to is tailoring, not a claim; for a job seeker, so is
  // naming the fact the film quotes and what they'd try or build with it
  const builder =
    profile.preset === 'candidate'
      ? ` ${chosen?.kind === 'requirement' ? '' : (chosen?.text ?? '')} try trying first next build building prototype take where`
      : ''
  const own = `${profile.offer} ${profile.points.join(' ')} ${profile.sender.role ?? ''} ${kit.name} ${kit.job?.title ?? ''} role`
  if (overlap(script.pitch.headline, own + builder) < 0.3)
    v.push(
      `pitch.headline "${script.pitch.headline}" claims things the profile doesn't say; build it from the offer: "${profile.offer}"`,
    )
  script.pitch.points.forEach((p, i) => {
    // a job seeker's idea rests on one thing they did, checked by pitch_is_idea below
    if (ideas) {
      const why = notAnIdea(p, kit, profile)
      if (why) v.push(`pitch.points[${i}] "${p}" ${why} (pitch_is_idea)`)
    } else if (overlap(p, own) < 0.5)
      v.push(
        `pitch.points[${i}] "${p}" adds claims the profile doesn't make; reword one of the profile's points instead`,
      )
  })
  // a job seeker's proof: the one closest to their business is on screen when one is close at all
  if (profile.preset === 'candidate' && profile.proof.length > 1) {
    const about = aboutText(kit)
    const top = rankProof(profile.proof, about, opts.semantic)[0]!
    const p = profile.proof[top]!
    const close = relevance(p, about, opts.semantic?.get(top)) > 0 && p.did && p.where
    if (close && !script.proof.includes(top))
      v.push(
        `proof leaves out ${top} ("${p.value} ${p.label}"), the proof closest to ${kit.name}'s business; show it first`,
      )
  }
  if (words(script.pitch.headline) < 4)
    v.push(
      `pitch.headline "${script.pitch.headline}" is too generic; say what you offer in 4 to ${LIMITS.headline} words`,
    )
  // a hiring film's proof is the company's own numbers, and a site may have one or none
  const minProof = hiring ? 0 : Math.min(2, profile.proof.length)
  if (script.proof.length < minProof)
    v.push(`proof needs at least ${minProof} items from the profile; one stat alone looks empty`)

  const nameWord = kit.name.split(/\s+/)[0]!.toLowerCase()
  if (!`${script.hook} ${script.noticed}`.toLowerCase().includes(nameWord)) {
    v.push(`hook or noticed must use the company's name ("${kit.name}")`)
  }
  return v
}

/** Everything the sender has said about themselves. */
function profileText(profile: Profile): string {
  return [
    profile.offer,
    ...profile.points,
    ...profile.proof.map((p) => `${p.value} ${p.label} ${p.where ?? ''} ${p.did ?? ''}`),
    profile.sender.role ?? '',
    profile.sender.company ?? '',
  ].join(' ')
}

function allSourceText(kit: BrandKit, profile: Profile): string {
  return [
    kit.name,
    kit.headline,
    kit.description,
    ...kit.facts.map((f) => f.text),
    profile.offer,
    ...profile.points,
    ...profile.proof.map((p) => `${p.value} ${p.label} ${p.where ?? ''} ${p.did ?? ''}`),
    profile.cta.line,
    profile.cta.contact,
    profile.sender.name,
    profile.sender.company ?? '',
  ].join(' ')
}

/** A line written as an idea for their product ("I'd … — like …") */
const ideaLine = (p: string) => /^I(?:'d|’d| would)\s.+\blike\b/i.test(p.trim())

/** Last resort after the revision budget: enforce limits mechanically, never ship a violation. */
export function clampScript(script: Script, profile: Profile): Script {
  const cut = (s: string, n: number) => {
    const w = s.replace(/!/g, '.').trim().split(/\s+/)
    return w.length <= n
      ? w.join(' ')
      : `${w
          .slice(0, n)
          .join(' ')
          .replace(/[,;:]$/, '')}`
  }
  return {
    hook: cut(script.hook, LIMITS.hook),
    noticed: cut(script.noticed, LIMITS.noticed),
    insight: { factId: script.insight.factId, why: cut(script.insight.why, LIMITS.why) },
    pitch: {
      headline: cut(script.pitch.headline, LIMITS.headline),
      points: script.pitch.points
        .slice(0, 3)
        .map((p) =>
          cut(p, profile.preset === 'candidate' && ideaLine(p) ? LIMITS.idea : LIMITS.point),
        ),
    },
    proof: [...new Set(script.proof.filter((i) => i < profile.proof.length))].slice(0, 3),
    cta: cut(script.cta, LIMITS.cta),
  }
}

/**
 * The rules a person's own edit must still pass: lines fit on screen, nothing is empty, and
 * every number comes from their profile or the company's site. Taste rules are theirs to break.
 */
export function editViolations(script: Script, kit: BrandKit, profile: Profile): string[] {
  return checkScript(script, kit, profile).filter((v) =>
    /mentions "|words; the limit|is empty|out of range|proof indices repeat/.test(v),
  )
}

/** "40,000+" may stand for "40,000", and "15minutes" for "15", but "12x" may not stand for "1" */
export const sameNumber = (a: string, b: string) => {
  const [long, short] = a.length >= b.length ? [a, b] : [b, a]
  return long.startsWith(short) && !/\d/.test(long.slice(short.length))
}

/** The lines a person can rewrite before re-rendering, by name. */
export const EDITABLE = ['hook', 'noticed', 'why', 'headline', 'points', 'cta'] as const
export interface ScriptEdit {
  hook?: string
  noticed?: string
  why?: string
  headline?: string
  points?: string[]
  cta?: string
}

/** Applies an edit to a script; lines left out stay as they were. */
export function applyEdit(script: Script, e: ScriptEdit): Script {
  const t = (v: string | undefined, was: string) => (v === undefined ? was : v.trim())
  return {
    ...script,
    hook: t(e.hook, script.hook),
    noticed: t(e.noticed, script.noticed),
    insight: { ...script.insight, why: t(e.why, script.insight.why) },
    pitch: {
      headline: t(e.headline, script.pitch.headline),
      points: e.points ? e.points.map((p) => p.trim()).filter(Boolean) : script.pitch.points,
    },
    cta: t(e.cta, script.cta),
  }
}

/**
 * What can be checked before a film is re-rendered, without the company's site at hand:
 * lengths, and numbers that appear nowhere the person or the original film got them from.
 * The renderer checks again against the full site.
 */
export function precheckEdit(script: Script, profile: Profile, known: string): string[] {
  const v: string[] = []
  const lines: [string, string, number][] = [
    ['The greeting', script.hook, LIMITS.hook],
    ['What you noticed', script.noticed, LIMITS.noticed],
    ['Why it matters', script.insight.why, LIMITS.why],
    ['The headline', script.pitch.headline, LIMITS.headline],
    ...script.pitch.points.map(
      (p, i) =>
        [
          `Point ${i + 1}`,
          p,
          profile.preset === 'candidate' && ideaLine(p) ? LIMITS.idea : LIMITS.point,
        ] as [string, string, number],
    ),
    ['The ask', script.cta, LIMITS.cta],
  ]
  if (script.pitch.points.length < 2) v.push('Keep at least 2 points')
  if (script.pitch.points.length > 3) v.push('Use at most 3 points')
  const pool = numbersIn(
    `${known} ${profileText(profile)} ${profile.cta.line} ${profile.cta.contact}`,
  )
  for (const [name, text, max] of lines) {
    const n = words(text)
    if (n === 0) v.push(`${name} is empty`)
    else if (n > max) v.push(`${name} has ${n} words; it fits ${max} on screen`)
    // "40,000+" may stand for "40,000", but "12x" may not stand for "1"
    for (const num of numbersIn(text))
      if (!pool.some((s) => sameNumber(s, num)))
        v.push(
          `${name} says "${num}", which isn't in your profile or the film. Numbers have to come from one of those`,
        )
  }
  return v
}
