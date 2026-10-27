import type { BrandKit } from '../brand/types.ts'
import { BANNED, LIMITS } from './taste.ts'
import type { Profile, Script } from './types.ts'

export const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

const NUMBER = /\d[\d,.]*\s?(%|x|k|m|min|minutes|hours|days)?/gi

function numbersIn(s: string): string[] {
  return (s.match(NUMBER) ?? []).map((n) => n.replace(/[,\s]/g, '').toLowerCase().replace(/\.$/, ''))
}

/**
 * Every rule from the taste list, as code. Returns human-readable violations that are fed
 * back to the model verbatim, so they double as revision instructions.
 */
export function checkScript(script: Script, kit: BrandKit, profile: Profile): string[] {
  const v: string[] = []
  const lines: [string, string, number][] = [
    ['hook', script.hook, LIMITS.hook],
    ['noticed', script.noticed, LIMITS.noticed],
    ['insight.why', script.insight.why, LIMITS.why],
    ['pitch.headline', script.pitch.headline, LIMITS.headline],
    ...script.pitch.points.map((p, i) => [`pitch.points[${i}]`, p, LIMITS.point] as [string, string, number]),
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
    const shouty = text.match(/\b[A-Z]{5,}\b/g)?.filter((w) => !kit.name.toUpperCase().includes(w) && !allSourceText(kit, profile).includes(w))
    if (shouty?.length) v.push(`${field} uses ALL CAPS ("${shouty[0]}")`)
  }

  // grounding: every number must exist in a source
  const sources = numbersIn(allSourceText(kit, profile))
  for (const [field, text] of lines) {
    for (const n of numbersIn(text)) {
      if (!sources.some((s) => s === n || s.startsWith(n) || n.startsWith(s))) {
        v.push(`${field} mentions "${n}", which is not in the company facts or the sender profile`)
      }
    }
  }

  if (!kit.facts.some((f) => f.id === script.insight.factId)) {
    v.push(`insight.factId "${script.insight.factId}" is not one of the fact ids (${kit.facts.slice(0, 12).map((f) => f.id).join(', ')}, ...)`)
  }
  for (const i of script.proof) {
    if (i >= profile.proof.length) v.push(`proof index ${i} is out of range (0-${profile.proof.length - 1})`)
  }
  if (new Set(script.proof).size !== script.proof.length) v.push('proof indices repeat')

  const nameWord = kit.name.split(/\s+/)[0]!.toLowerCase()
  if (!`${script.hook} ${script.noticed}`.toLowerCase().includes(nameWord)) {
    v.push(`hook or noticed must use the company's name ("${kit.name}")`)
  }
  return v
}

function allSourceText(kit: BrandKit, profile: Profile): string {
  return [
    kit.name,
    kit.headline,
    kit.description,
    ...kit.facts.map((f) => f.text),
    profile.offer,
    ...profile.points,
    ...profile.proof.map((p) => `${p.value} ${p.label}`),
    profile.cta.line,
    profile.cta.contact,
    profile.sender.name,
    profile.sender.company ?? '',
  ].join(' ')
}

/** Last resort after the revision budget: enforce limits mechanically, never ship a violation. */
export function clampScript(script: Script, profile: Profile): Script {
  const cut = (s: string, n: number) => {
    const w = s.replace(/!/g, '.').trim().split(/\s+/)
    return w.length <= n ? w.join(' ') : `${w.slice(0, n).join(' ').replace(/[,;:]$/, '')}`
  }
  return {
    hook: cut(script.hook, LIMITS.hook),
    noticed: cut(script.noticed, LIMITS.noticed),
    insight: { factId: script.insight.factId, why: cut(script.insight.why, LIMITS.why) },
    pitch: {
      headline: cut(script.pitch.headline, LIMITS.headline),
      points: script.pitch.points.slice(0, 3).map((p) => cut(p, LIMITS.point)),
    },
    proof: [...new Set(script.proof.filter((i) => i < profile.proof.length))].slice(0, 3),
    cta: cut(script.cta, LIMITS.cta),
  }
}
