import type { BrandKit } from '../brand/types.ts'
import type { Profile, Script } from './types.ts'

export type Scene =
  | { kind: 'hook'; dur: number; text: string; sub: string }
  | { kind: 'site'; dur: number; caption: string; host: string }
  | { kind: 'insight'; dur: number; value: string | null; text: string; source: string; why: string }
  | { kind: 'pitch'; dur: number; from: string; headline: string; points: string[] }
  | { kind: 'proof'; dur: number; stats: { value: string; label: string }[] }
  | { kind: 'cta'; dur: number; line: string; contact: string; signoff: string }

export interface Storyboard {
  company: string
  sender: string
  scenes: Scene[]
  duration: number
}

/** "38% fewer late deliveries" -> { value: "38%", rest: "fewer late deliveries" } */
export function splitStat(text: string): { value: string; rest: string } | null {
  const m = text.match(/^([$€£]?\d[\d,.]*(?:%|\+|x|k|m)?\+?)\s+(.{6,})$/i)
  if (!m) return null
  return { value: m[1]!, rest: m[2]!.replace(/\.$/, '') }
}

/**
 * Deterministic assembly. The model's lines go where they belong, and everything factual
 * comes straight from its source: the quote from the site, the proof from the profile.
 */
export function buildStoryboard(kit: BrandKit, profile: Profile, script: Script): Storyboard {
  const fact = kit.facts.find((f) => f.id === script.insight.factId) ?? kit.facts[0]!
  const stat = splitStat(fact.text)
  const from = profile.sender.company
    ? `${profile.sender.name}, ${profile.sender.company}`
    : profile.sender.name
  const scenes: Scene[] = [
    { kind: 'hook', dur: 3.2, text: script.hook.replace(/[.,]$/, ''), sub: `A 30-second film for ${kit.name}` },
    { kind: 'site', dur: 5.2, caption: script.noticed, host: kit.host },
    {
      kind: 'insight',
      dur: 5.4,
      value: stat?.value ?? null,
      text: stat ? stat.rest : fact.text.replace(/^["“]|["”]$/g, ''),
      source: kit.host,
      why: script.insight.why,
    },
    { kind: 'pitch', dur: 6.0, from, headline: script.pitch.headline, points: script.pitch.points },
    {
      kind: 'proof',
      dur: 4.8,
      stats: script.proof.map((i) => profile.proof[i]!).filter(Boolean),
    },
    { kind: 'cta', dur: 4.6, line: script.cta, contact: profile.cta.contact, signoff: `Made by ${from} for ${kit.name}` },
  ]
  return {
    company: kit.name,
    sender: from,
    scenes,
    duration: Math.round(scenes.reduce((a, s) => a + s.dur, 0) * 10) / 10,
  }
}
