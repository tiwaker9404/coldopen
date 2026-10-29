import type { BrandKit } from '../brand/types.ts'
import type { Profile, Script } from './types.ts'

export type Scene =
  | { kind: 'hook'; dur: number; text: string; sub: string }
  | {
      kind: 'site'
      dur: number
      caption: string
      host: string
      /** the fact the caption is about, to point at on the page (the headline when unknown) */
      focus?: string
    }
  | {
      kind: 'insight'
      dur: number
      value: string | null
      text: string
      source: string
      why: string
    }
  | { kind: 'pitch'; dur: number; from: string; headline: string; points: string[] }
  | { kind: 'proof'; dur: number; stats: { value: string; label: string; where?: string }[] }
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

const SKIP = new Set(
  'your their the and for with from that this what about homepage site page shows says leads opens'.split(
    ' ',
  ),
)
/** words that carry meaning, plural or not ("trucks" and "truck" match) */
const contentWords = (t: string, skip: Set<string> = SKIP) =>
  (t.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? [])
    .filter((w) => !skip.has(w))
    .map((w) => w.replace(/(?<=[a-z]{3})s$/, ''))
const numbers = (t: string) => (t.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]/g, ''))

/**
 * Which fact on the page the "noticed" line is about, so the homepage scene can point at it.
 * A number in the line decides it ("93,000 vendors"); otherwise the fact sharing the most
 * words with it. Only facts the film can show (on the first screen, or with a close-up).
 */
export function noticedFact(kit: BrandKit, noticed: string) {
  const showable = kit.facts.filter(
    (f) => f.shot || (f.box && f.box.y + f.box.h <= kit.screenshot.height),
  )
  const nums = numbers(noticed).filter((n) => n.length > 0 && n !== '0')
  if (nums.length) {
    const hit = showable.find((f) => nums.some((n) => numbers(f.text).includes(n)))
    if (hit) return hit
  }
  // their own name is in most lines, so it says nothing about which one
  const skip = new Set([...SKIP, ...kit.name.toLowerCase().split(/\s+/)])
  const words = new Set(contentWords(noticed, skip))
  if (words.size === 0) return null
  let best: { fact: (typeof showable)[number]; score: number } | null = null
  for (const f of showable) {
    const shared = new Set(contentWords(f.text, skip).filter((w) => words.has(w))).size
    const score = shared / words.size
    if (score >= 0.5 && (!best || score > best.score)) best = { fact: f, score }
  }
  return best?.fact ?? null
}

/** "Could we talk this week" is a question; the end card shouldn't lose its question mark */
export function asked(line: string): string {
  const t = line.trim().replace(/[.!]+$/, '')
  return /^(could|can|would|will|shall|should|do|does|did|are|is|may|might|want|open to|free)\b/i.test(
    t,
  ) && !t.endsWith('?')
    ? `${t}?`
    : line.trim()
}

/**
 * Deterministic assembly. The model's lines go where they belong, and everything factual
 * comes straight from its source: the quote from the site, the proof from the profile.
 */
export function buildStoryboard(kit: BrandKit, profile: Profile, script: Script): Storyboard {
  const fact = kit.facts.find((f) => f.id === script.insight.factId) ?? kit.facts[0]!
  // a requirement is their words, shown as a quote even when it has a number in it
  const stat = fact.kind === 'requirement' ? null : splitStat(fact.text)
  const from = profile.sender.company
    ? `${profile.sender.name}, ${profile.sender.company}`
    : profile.sender.name
  const scenes: Scene[] = [
    {
      kind: 'hook',
      dur: 3.2,
      text: script.hook.replace(/[.,]$/, ''),
      sub: kit.job ? `For your ${kit.job.title} role` : `A 30-second film for ${kit.name}`,
    },
    (() => {
      const focus = noticedFact(kit, script.noticed)
      return {
        kind: 'site' as const,
        dur: 5.2,
        caption: script.noticed.replace(/\.$/, ''),
        host: kit.host,
        ...(focus ? { focus: focus.id } : {}),
      }
    })(),
    {
      kind: 'insight',
      dur: 5.4,
      value: stat?.value ?? null,
      text: stat ? stat.rest : fact.text.replace(/^["“]|["”]$/g, ''),
      // a requirement is quoted from the job post, not the homepage
      source: fact.kind === 'requirement' && kit.job ? `your ${kit.job.title} post` : kit.host,
      why: script.insight.why.replace(/\.$/, ''),
    },
    {
      kind: 'pitch',
      dur: 6.0,
      from,
      headline: script.pitch.headline.replace(/\.$/, ''),
      points: script.pitch.points.map((x) => x.replace(/\.$/, '')),
    },
    {
      kind: 'proof',
      dur: 4.8,
      stats: script.proof.map((i) => profile.proof[i]!).filter(Boolean),
    },
    {
      kind: 'cta',
      dur: 4.6,
      line: asked(script.cta),
      contact: profile.cta.contact,
      signoff: `Made for ${kit.name} by ${profile.sender.name}${profile.sender.company ? ` at ${profile.sender.company}` : ''}`,
    },
  ]
  return {
    company: kit.name,
    sender: from,
    scenes,
    duration: Math.round(scenes.reduce((a, s) => a + s.dur, 0) * 10) / 10,
  }
}
