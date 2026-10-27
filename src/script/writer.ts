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
  const facts = kit.facts.slice(0, 30).map((f) => `${f.id} [${f.kind}] ${f.text}`).join('\n')
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
  const max = opts.maxRounds ?? 3
  const messages = buildMessages(kit, profile)
  const history: string[][] = []
  let script: Script | null = null

  for (let round = 1; round <= max; round++) {
    script = await opts.complete(`script-${round}`, messages)
    const v = checkScript(script, kit, profile)
    history.push(v)
    if (v.length === 0) return { script, meta: { model: opts.model, rounds: round, violations: history, usedFallback: false } }
    messages.push(
      { role: 'assistant', content: JSON.stringify(script) },
      {
        role: 'user',
        content: `Revise the script. Fix every problem below and change nothing else:\n${v.map((x) => `- ${x}`).join('\n')}\nReply with only the corrected JSON.`,
      },
    )
  }

  const clamped = clampScript(script!, profile)
  const remaining = checkScript(clamped, kit, profile)
  if (remaining.length === 0) {
    return { script: clamped, meta: { model: opts.model, rounds: max, violations: history, usedFallback: false } }
  }
  return {
    script: deterministicScript(kit, profile),
    meta: { model: opts.model, rounds: max, violations: [...history, remaining], usedFallback: true },
  }
}

/* ------------------------------------------------- deterministic writer */

const clip = (s: string, n: number) => s.trim().split(/\s+/).slice(0, n).join(' ').replace(/[.,;:]$/, '')

function bestFact(kit: BrandKit, profile: Profile): Fact {
  const vocab = new Set(
    `${profile.offer} ${profile.points.join(' ')}`
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 4),
  )
  const score = (f: Fact) =>
    (f.kind === 'stat' ? 3 : f.kind === 'quote' ? 2 : 0) +
    f.text.toLowerCase().split(/\W+/).filter((w) => vocab.has(w)).length -
    (f.text.length > 120 ? 2 : 0)
  return [...kit.facts].filter((f) => f.kind !== 'headline').sort((a, b) => score(b) - score(a))[0] ?? kit.facts[0]!
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
    noticed: clip(`${first} leads with one clear promise. I took it seriously.`, LIMITS.noticed),
    insight: {
      factId: fact.id,
      why: clip(
        candidate
          ? 'That is the kind of outcome I want to help build.'
          : `That is the kind of result ${profile.sender.company ?? 'we'} help${profile.sender.company ? 's' : ''} teams prove.`,
        LIMITS.why,
      ),
    },
    pitch: {
      headline: clip(candidate ? `What I would bring to ${name}` : profile.offer, LIMITS.headline),
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
