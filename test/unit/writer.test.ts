import { describe, expect, it } from 'vitest'
import type { BrandKit } from '../../src/brand/types.ts'
import { checkScript, words } from '../../src/script/checks.ts'
import type { Script } from '../../src/script/types.ts'
import { deterministicScript, HEADLINES, HOOKS, variant, WHY } from '../../src/script/writer.ts'
import { profile } from '../helpers/index.ts'

const NAMES = ['Northwind Freight', 'Lumen Health', 'Parcelpine']

function kit(name: string, stat: boolean): BrandKit {
  const host = `${name.toLowerCase().replace(/\s+/g, '')}.com`
  return {
    url: `https://${host}/`,
    host,
    name,
    title: name,
    description: '',
    headline: 'Freight that tells you where it is',
    subheads: [],
    nav: [],
    facts: [
      { id: 'f0', kind: 'headline', text: 'Freight that tells you where it is' },
      stat
        ? { id: 'f1', kind: 'stat', text: '98% of loads arrive on time' }
        : { id: 'f1', kind: 'quote', text: 'Every shipment tracked from dock to door' },
    ],
    colors: {
      background: '#ffffff',
      text: '#1a1a1a',
      primary: '#2f6bff',
      accent: '#ff6b2c',
      dark: '#0b1530',
      swatches: [{ hex: '#2f6bff', weight: 1 }],
    },
    fonts: {
      display: { family: 'Fraunces', category: 'serif', weight: 600, faces: [] },
      body: { family: 'Inter', category: 'sans', weight: 400, faces: [] },
    },
    logo: null,
    screenshot: {
      file: 'site.jpg',
      width: 1440,
      height: 900,
      headlineBox: { x: 120, y: 240, w: 800, h: 140 },
    },
    extractedAt: '2026-11-09T00:00:00.000Z',
  } as BrandKit
}

describe('the built-in writer varies by company', () => {
  it('picks the same lines for the same company every time', () => {
    for (const n of NAMES) {
      const k = kit(n, true)
      expect(deterministicScript(k, profile('sales'))).toEqual(
        deterministicScript(k, profile('sales')),
      )
      expect(variant(n, 'hook', HOOKS)).toBe(variant(`  ${n.toUpperCase()} `, 'hook', HOOKS))
    }
  })

  it('gives the three fixture companies different greetings and pivots', () => {
    for (const preset of ['sales', 'candidate'] as const) {
      const scripts = NAMES.map((n) => deterministicScript(kit(n, true), profile(preset)))
      expect(new Set(scripts.map((s) => s.hook)).size).toBe(3)
      expect(new Set(scripts.map((s) => s.insight.why)).size).toBe(3)
    }
    const heads = NAMES.map(
      (n) => deterministicScript(kit(n, true), profile('candidate')).pitch.headline,
    )
    expect(new Set(heads).size).toBe(3)
  })

  it('keeps every variant inside the taste rules, for every preset and fact kind', () => {
    for (const n of NAMES)
      for (const preset of ['sales', 'candidate'] as const)
        for (const stat of [true, false]) {
          const k = kit(n, stat)
          const p = profile(preset)
          const base = deterministicScript(k, p)
          const who = p.sender.company ? `${p.sender.company} helps` : 'We help'
          // a job seeker's line under the fact is built from the fact and their first idea
          const whys =
            preset === 'candidate'
              ? [base.insight.why]
              : (stat ? WHY.salesStat : WHY.salesClaim).map((f) => f(who))
          const tries: Script[] = [
            ...HOOKS.map((h) => h(n))
              .filter((h) => words(h) <= 6)
              .map((hook) => ({ ...base, hook })),
            ...whys.map((why) => ({ ...base, insight: { ...base.insight, why } })),
            ...(preset === 'candidate'
              ? HEADLINES.map((h) => ({ ...base, pitch: { ...base.pitch, headline: h(n) } }))
              : []),
          ]
          for (const s of tries)
            expect(checkScript(s, k, p), `${n}/${preset}: ${JSON.stringify(s.hook)}`).toEqual([])
        }
  })
})
