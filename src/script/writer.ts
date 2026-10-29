import type { BrandKit, Fact } from '../brand/types.ts'
import type { ChatMessage } from '../llm/types.ts'
import { checkScript, clampScript, overlap, words } from './checks.ts'
import { LIMITS, TASTE_RULES } from './taste.ts'
import type { Profile, Script, ScriptMeta } from './types.ts'

export const SYSTEM_PROMPT = `You write the script for a 30-second personalized video that a sender makes for one specific company.
The film plays as six short scenes: a hook greeting the company, what the sender noticed on their homepage (shown over a screenshot of it), one real fact from their site with why it matters, the pitch, the sender's proof, and a call to action.

${TASTE_RULES}

Reply with only a JSON object of this exact shape:
{"hook": string, "noticed": string, "insight": {"factId": string, "why": string}, "pitch": {"headline": string, "points": [string, string, string]}, "proof": [number, ...], "cta": string}`

const PRESETS: Record<Profile['preset'], string> = {
  sales:
    'The sender sells the offer below to companies like this one. The film has one job: earn a reply by proving the sender understood this business. Talk about their customers and outcomes, not your features.',
  candidate:
    'The sender is a job candidate who wants to work at this company. Show that they understand what the company builds and who it serves, and connect their strengths to it. The call to action asks for a conversation, never for a job. Write in the first person ("I").',
}

const JOB_BRIEF = (title: string) =>
  `This film answers a job post: ${title}. The insight scene quotes one of the job's requirements word for word (pick its id, j1, j2...), and insight.why answers it in the first person with something you have already done, taken from your points or proof. Pick the proof that answers the requirements best. The pitch headline may name the role. Numbers in your lines must come from your profile; the job post's numbers are what they want, not what you have done.`

export function buildMessages(kit: BrandKit, profile: Profile): ChatMessage[] {
  const facts = kit.facts
    .filter((f) => f.kind !== 'requirement')
    .slice(0, 24)
    .map((f) => `${f.id} [${f.kind}] ${f.text.length > 220 ? `${f.text.slice(0, 220)}…` : f.text}`)
    .join('\n')
  const reqs = kit.facts.filter((f) => f.kind === 'requirement')
  const job = kit.job
    ? `

THE JOB: ${kit.job.title}
Requirements from the post (cite by id; feature one that is under 160 characters):
${reqs.map((f) => `${f.id} ${f.text}`).join('\n')}

${JOB_BRIEF(kit.job.title)}`
    : ''
  const proof = profile.proof
    .map((p, i) => `${i}: ${p.value} ${p.label}${p.where ? ` (${p.where})` : ''}`)
    .join('\n')
  const user = `${PRESETS[profile.preset]}

COMPANY
Name: ${kit.name}
Website: ${kit.host}
Homepage headline: ${kit.headline}
Description: ${kit.description}

FACTS FROM THEIR SITE (cite by id)
${facts}

SENDER
Name: ${profile.sender.name}${profile.sender.company ? `, ${profile.sender.company}` : ''}${profile.sender.role ? ` (${profile.sender.role})` : ''}
Offer: ${profile.offer}
Points you may tailor:
${profile.points.map((p) => `- ${p}`).join('\n')}
Proof (pick by index; shown verbatim):
${proof}
Call to action: ${profile.cta.line}${job}`
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ]
}

export type Complete = (key: string, messages: ChatMessage[]) => Promise<Script>

/**
 * Write -> check -> revise. The model gets the exact violations back and rewrites, up to
 * `maxRounds`. If it still can't comply, limits are enforced mechanically, and if that's
 * still not clean, a deterministic writer takes over. A film never ships with a violation.
 */
export async function writeScript(opts: {
  kit: BrandKit
  profile: Profile
  complete: Complete
  model: string
  maxRounds?: number
}): Promise<{ script: Script; meta: ScriptMeta }> {
  const { kit, profile } = opts
  const max = opts.maxRounds ?? 4
  const messages = buildMessages(kit, profile)
  const history: string[][] = []
  let script: Script | null = null

  for (let round = 1; round <= max; round++) {
    script = await opts.complete(`script-${round}`, messages)
    const v = checkScript(script, kit, profile)
    history.push(v)
    if (v.length === 0)
      return {
        script,
        meta: {
          model: opts.model,
          rounds: round,
          violations: history,
          usedFallback: false,
          replaced: [],
        },
      }
    // only the latest draft and its problems go back: resending every round would grow each
    // request past a free tier's tokens-per-minute limit
    messages.splice(
      2,
      messages.length,
      { role: 'assistant', content: JSON.stringify(script) },
      {
        role: 'user',
        content: `Revise the script. Fix every problem below and change nothing else:\n${v.map((x) => `- ${x}`).join('\n')}\nReply with only the corrected JSON.`,
      },
    )
  }

  // keep every line the model got right; swap only the lines it couldn't fix. Swapping comes
  // before clamping, so a line is never shipped cut off mid-sentence.
  const fallback = deterministicScript(kit, profile)
  const fixed = repair(script!, fallback, kit, profile)
  const second = checkScript(fixed.script, kit, profile).length
    ? repair(clampScript(fixed.script, profile), fallback, kit, profile)
    : fixed
  const repaired = second.script
  const replaced = [...new Set([...fixed.replaced, ...second.replaced])]
  const remaining = checkScript(repaired, kit, profile)
  if (remaining.length === 0) {
    return {
      script: repaired,
      meta: { model: opts.model, rounds: max, violations: history, usedFallback: false, replaced },
    }
  }
  return {
    script: deterministicScript(kit, profile),
    meta: {
      model: opts.model,
      rounds: max,
      violations: [...history, remaining],
      usedFallback: true,
      replaced: [...FIELDS],
    },
  }
}

const FIELDS = [
  'hook',
  'noticed',
  'insight',
  'pitch.headline',
  'pitch.points',
  'proof',
  'cta',
] as const

function withField(s: Script, from: Script, f: (typeof FIELDS)[number]): Script {
  if (f === 'pitch.headline') return { ...s, pitch: { ...s.pitch, headline: from.pitch.headline } }
  if (f === 'pitch.points') return { ...s, pitch: { ...s.pitch, points: from.pitch.points } }
  return { ...s, [f]: from[f] }
}

/** Greedily swap in deterministic lines, keeping a swap only when it removes violations. */
function repair(
  script: Script,
  fallback: Script,
  kit: BrandKit,
  profile: Profile,
): { script: Script; replaced: string[] } {
  let current = script
  let count = checkScript(current, kit, profile).length
  const replaced: string[] = []
  for (const f of FIELDS) {
    if (count === 0) break
    const next = withField(current, fallback, f)
    const n = checkScript(next, kit, profile).length
    if (n < count) {
      current = next
      count = n
      replaced.push(f)
    }
  }
  return { script: current, replaced }
}

/* ------------------------------------------------- deterministic writer */

const clip = (s: string, n: number) =>
  s
    .trim()
    .split(/\s+/)
    .slice(0, n)
    .join(' ')
    .replace(/[.,;:]$/, '')

function bestFact(kit: BrandKit, profile: Profile): Fact {
  const vocab = new Set(
    `${profile.offer} ${profile.points.join(' ')}`
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 4),
  )
  const score = (f: Fact) =>
    (f.kind === 'stat' ? 3 : f.kind === 'quote' ? 2 : 0) +
    f.text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => vocab.has(w)).length -
    (f.text.length > 120 ? 2 : 0) -
    // release badges and link labels are on the page, but aren't about the business
    (/\blaunch(es|ed)?\b|announcing|introducing|^new\b|read more|learn more|\braise[sd]?\b|funding|series [a-f]\b/i.test(
      f.text,
    )
      ? 3
      : 0) -
    (f.text.length < 25 ? 1 : 0)
  return (
    [...kit.facts]
      .filter((f) => f.kind !== 'headline' && f.kind !== 'requirement')
      .sort((a, b) => score(b) - score(a))[0] ?? kit.facts[0]!
  )
}

/** Quote their own headline when it's short enough to read on screen; it's the most personal line we have. */
function noticedLine(kit: BrandKit, first: string): string {
  const h = kit.headline
    .replace(/[.!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const quoted = `${first} leads with \u201c${h}\u201d`
  if (h && words(quoted) <= LIMITS.noticed && !h.includes('!')) return quoted
  // too long to quote: point at the highlighted headline instead of paraphrasing it
  return clip(`The first thing ${first} promises on its homepage`, LIMITS.noticed)
}

/** One honest sentence tying the featured fact to the sender, without claiming anything new. */
function whyLine(fact: Fact, candidate: boolean, company: string | undefined): string {
  const numeric = fact.kind === 'stat'
  if (candidate)
    return numeric
      ? 'I want to help move a number like this one'
      : 'That is the kind of outcome I want to help build'
  const who = company ? `${company} helps` : 'We help'
  return numeric
    ? `${who} teams measure what moves a number like this`
    : `${who} teams turn a claim like this into proof`
}

/**
 * A rule-based writer used as the stand-in model (tests, CI, the no-key demo) and as the
 * final fallback. Plainer than a good LLM, but always on-brief and always grounded.
 */
export function deterministicScript(kit: BrandKit, profile: Profile): Script {
  if (kit.job) return jobScript(kit, profile, kit.job.title)
  const name = kit.name
  const first = name.split(/\s+/)[0]!
  const fact = bestFact(kit, profile)
  const candidate = profile.preset === 'candidate'
  const hook = words(`Hi ${name} team`) <= LIMITS.hook ? `Hi ${name} team` : `Hi ${first} team`
  return {
    hook,
    noticed: noticedLine(kit, first),
    insight: {
      factId: fact.id,
      why: clip(whyLine(fact, candidate, profile.sender.company), LIMITS.why),
    },
    pitch: {
      headline: clip(
        candidate
          ? `What I would bring to ${name}`
          : words(profile.offer) >= 4
            ? profile.offer
            : `${profile.offer.replace(/[.]$/, '')}, made for ${first}`,
        LIMITS.headline,
      ),
      // prefer points that already fit, so nothing is cut mid-phrase
      points: [...profile.points]
        .sort((a, b) => Number(words(a) > LIMITS.point) - Number(words(b) > LIMITS.point))
        .slice(0, 3)
        .map((p) => clip(p, LIMITS.point)),
    },
    proof: profile.proof.slice(0, 3).map((_, i) => i),
    cta: clip(profile.cta.line, LIMITS.cta),
  }
}

/* --------------------------------------------- answering a job post */

type ProofItem = Profile['proof'][number]
const proofText = (p: ProofItem) => `${p.value} ${p.label} ${p.where ?? ''}`

// words every job post and résumé share; matching on them says nothing
const VAGUE = new Set(
  'the and for with that this your you our are was from into have has its their they them than what when which who will able strong skills skill experience years year work working build building built end data team teams across using use own owning ensure great good new high help plus etc including such other well'.split(
    ' ',
  ),
)
const stem = (w: string) => (w.length > 4 ? w.replace(/(es|s)$/, '') : w)
const terms = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9+#\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !VAGUE.has(w))
      .map(stem),
  )

/** How well a line of the sender's record answers a requirement: shared, meaningful words. */
function answers(record: string, requirement: string): number {
  const a = terms(record)
  const b = terms(requirement)
  if (!a.size || !b.size) return 0
  let n = 0
  for (const w of a) if (b.has(w)) n++
  return n / Math.min(a.size, b.size)
}

/** Shortens a phrase at a natural break ("..., via X", "... using Y") so it still reads whole. */
function trimAtBreak(text: string, max: number): string | null {
  if (words(text) <= max) return text
  const breaks = [
    ',',
    ' via ',
    ' using ',
    ' with ',
    ' through ',
    ' across ',
    ' for ',
    ' by ',
    ' in ',
  ]
  let best: string | null = null
  for (const b of breaks) {
    let at = text.indexOf(b)
    while (at > 0) {
      const head = text
        .slice(0, at)
        .trim()
        .replace(/[,;:]$/, '')
      if (words(head) <= max && (!best || head.length > best.length)) best = head
      at = text.indexOf(b, at + 1)
    }
  }
  return best && words(best) >= 3 ? best : null
}

/** "Turns messy data into pipelines" -> "I turn messy data into pipelines"; null if unsure. */
function firstPerson(point: string): string | null {
  const [verb, ...rest] = point.trim().split(/\s+/)
  if (!verb || !/^[A-Z][a-z]{2,}s$/.test(verb) || /ss$/.test(verb)) return null
  const base = /(ch|sh|x|ss)es$/.test(verb) ? verb.slice(0, -2) : verb.slice(0, -1)
  const line = `I ${base.toLowerCase()} ${rest.join(' ')}`.replace(/[.,;]$/, '')
  return words(line) <= LIMITS.why ? line : (trimAtBreak(line, LIMITS.why) ?? null)
}

/** The one-line answer: the proof item that answers it, and where it happened. */
function answerLine(p: ProofItem, direct: boolean): string {
  const done = `${p.value} ${p.label}`.replace(/\.$/, '')
  // "I did this" only when the proof plainly matches the requirement; otherwise say less
  // "On GitHub", "At Duke" already carry their preposition
  const at = p.where
    ? /^(on|at|in|for|with)\s/i.test(p.where)
      ? ` ${p.where[0]!.toLowerCase()}${p.where.slice(1)}`
      : ` at ${p.where}`
    : ''
  const prefix = direct
    ? p.where
      ? `I did this${at}:`
      : 'I have done this:'
    : p.where
      ? `My closest match,${at}:`
      : 'My closest match:'
  for (const pre of [prefix, direct ? 'I did this:' : 'My closest match:']) {
    const rest = trimAtBreak(done, LIMITS.why - words(pre))
    if (rest) return `${pre} ${rest}`
  }
  return clip(`${prefix} ${done}`, LIMITS.why)
}

/**
 * The deterministic writer for a job post: feature the requirement the sender's record answers
 * best, answer it with the matching proof, and lead the proof scene with what fits the role.
 */
function jobScript(kit: BrandKit, profile: Profile, title: string): Script {
  const name = kit.name
  const first = name.split(/\s+/)[0]!
  const reqs = kit.facts.filter((f) => f.kind === 'requirement')
  const quotable = reqs.filter((f) => f.text.length <= 160)
  const allReqs = reqs.map((f) => f.text).join(' ')
  const byFit = (texts: string[], against: string) =>
    texts.map((t, i) => ({ i, f: answers(t, against) })).sort((a, b) => b.f - a.f || a.i - b.i)
  // for each requirement: the proof item and the point that answer it best
  const options = (quotable.length ? quotable : reqs).map((r, ri) => {
    const proof = byFit(profile.proof.map(proofText), r.text)[0]!
    const point = byFit(profile.points, r.text)[0] ?? { i: -1, f: 0 }
    // a requirement one of the sender's own points already claims is theirs to answer
    return { r, ri, proof, point, score: proof.f + 0.7 * point.f }
  })
  options.sort((a, b) => b.score - a.score || a.ri - b.ri)
  const best = options[0]!
  const req = best.r
  const answer = best.proof.i
  // say "I did this" only about something on the record that plainly matches
  // (a point that claims it plus proof that touches it counts; so does a point alone, said
  // in the first person, as long as it isn't just their requirement read back to them)
  const claim = best.point.i >= 0 ? firstPerson(profile.points[best.point.i]!) : null
  const why =
    best.proof.f >= 0.34 || (best.point.f >= 0.34 && best.proof.f > 0)
      ? answerLine(profile.proof[answer]!, true)
      : best.point.f >= 0.34 && claim && overlap(claim, req.text) <= 0.6
        ? claim
        : answerLine(profile.proof[answer]!, false)
  const rest = byFit(profile.proof.map(proofText), allReqs)
    .map((x) => x.i)
    .filter((i) => i !== answer)
  const hook = words(`Hi ${name} team`) <= LIMITS.hook ? `Hi ${name} team` : `Hi ${first} team`
  return {
    hook,
    noticed: noticedLine(kit, first),
    insight: { factId: req.id, why },
    pitch: {
      headline: clip(
        words(`Why I fit your ${title} role`) <= LIMITS.headline
          ? `Why I fit your ${title} role`
          : 'Why I fit the role you posted',
        LIMITS.headline,
      ),
      points: byFit(profile.points, allReqs)
        .map((x) => profile.points[x.i]!)
        .sort((a, b) => Number(words(a) > LIMITS.point) - Number(words(b) > LIMITS.point))
        .slice(0, 3)
        .map((p) => clip(p, LIMITS.point)),
    },
    proof: [answer, ...rest].slice(0, 3),
    cta: clip(profile.cta.line, LIMITS.cta),
  }
}
