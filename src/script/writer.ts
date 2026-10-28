import type { BrandKit, Fact } from '../brand/types.ts'
import type { ChatMessage } from '../llm/types.ts'
import { checkScript, clampScript, words } from './checks.ts'
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

export function buildMessages(kit: BrandKit, profile: Profile): ChatMessage[] {
  const facts = kit.facts
    .slice(0, 30)
    .map((f) => `${f.id} [${f.kind}] ${f.text}`)
    .join('\n')
  const proof = profile.proof.map((p, i) => `${i}: ${p.value} ${p.label}`).join('\n')
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
Call to action: ${profile.cta.line}`
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
    messages.push(
      { role: 'assistant', content: JSON.stringify(script) },
      {
        role: 'user',
        content: `Revise the script. Fix every problem below and change nothing else:\n${v.map((x) => `- ${x}`).join('\n')}\nReply with only the corrected JSON.`,
      },
    )
  }

  // keep every line the model got right; swap only the lines it couldn't fix
  const clamped = clampScript(script!, profile)
  const { script: repaired, replaced } = repair(
    clamped,
    deterministicScript(kit, profile),
    kit,
    profile,
  )
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
    [...kit.facts].filter((f) => f.kind !== 'headline').sort((a, b) => score(b) - score(a))[0] ??
    kit.facts[0]!
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
