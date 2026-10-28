import { describe, expect, it } from 'vitest'
import type { BrandKit } from '../../src/brand/types.ts'
import { checkScript, clampScript } from '../../src/script/checks.ts'
import { buildStoryboard, splitStat } from '../../src/script/storyboard.ts'
import type { Script } from '../../src/script/types.ts'
import { buildMessages, deterministicScript, writeScript } from '../../src/script/writer.ts'
import { profile } from '../helpers/index.ts'

const kit = {
  name: 'Northwind Freight',
  host: 'northwindfreight.example',
  headline: "Every pallet, visible before it's late.",
  description: 'Northwind gives mid-size shippers live visibility into every pallet.',
  facts: [
    { id: 'f1', text: "Every pallet, visible before it's late.", kind: 'headline' },
    { id: 'f2', text: '38% fewer late deliveries in the first quarter', kind: 'stat' },
    {
      id: 'f3',
      text: '"We stopped finding out about late trucks from our customers."',
      kind: 'quote',
    },
  ],
} as unknown as BrandKit

const good: Script = {
  hook: 'Hi Northwind Freight team',
  noticed: 'Northwind promises every pallet is visible before it runs late.',
  insight: {
    factId: 'f2',
    why: 'Retention data shows which shippers stay after that first quarter.',
  },
  pitch: {
    headline: 'Know which features keep your shippers',
    points: [
      'See which features drive retention',
      'Ask questions in plain English',
      'Set up in a day',
    ],
  },
  proof: [0, 2],
  cta: 'Worth a 15-minute look?',
}

describe('taste checks', () => {
  const sales = profile('sales')

  it('passes a clean script', () => {
    expect(checkScript(good, kit, sales)).toEqual([])
  })

  it('catches slop, shouting, punctuation and length', () => {
    const v = checkScript(
      {
        ...good,
        hook: 'Hey Northwind, we revolutionize SHIPPING forever!',
        cta: 'Let us unlock seamless growth for your whole team today please',
      },
      kit,
      sales,
    )
    const all = v.join('\n')
    expect(all).toContain('banned phrase "revolutionize"')
    expect(all).toContain('banned phrase "unlock"')
    expect(all).toContain('ALL CAPS')
    expect(all).toContain('exclamation')
    expect(all).toContain('cta has 11 words')
  })

  it('refuses invented numbers, unknown facts and out-of-range proof', () => {
    const v = checkScript(
      {
        ...good,
        noticed: 'Northwind cut late deliveries by 52% last year.',
        insight: { factId: 'f9', why: 'ok' },
        proof: [7],
      },
      kit,
      sales,
    ).join('\n')
    expect(v).toContain('"52%"')
    expect(v).toContain('factId "f9"')
    expect(v).toContain('proof index 7')
  })

  it('asks for a stat when the site has one, and accepts a quote when it has none', () => {
    const quoted = { ...good, insight: { factId: 'f3', why: good.insight.why } }
    expect(checkScript(quoted, kit, sales).join(' ')).toContain(
      'pick one of the stats instead (f2)',
    )
    const noStats = { ...kit, facts: kit.facts.filter((f) => f.kind !== 'stat') } as BrandKit
    expect(checkScript(quoted, noStats, sales)).toEqual([])
  })

  // the shape of what qwen2.5:7b wrote for linear.app, cal.com and ramp.com before these rules
  it('rejects lines that restate what is already on screen', () => {
    const lazy: Script = {
      ...good,
      hook: 'Northwind Freight',
      noticed: "Every pallet, visible before it's late",
      insight: { factId: 'f2', why: '38% fewer late deliveries in the first quarter' },
      pitch: { ...good.pitch, headline: 'Drive growth' },
      proof: [0],
    }
    const v = checkScript(lazy, kit, sales).join('\n')
    expect(v).toContain('hook "Northwind Freight" is too bare')
    expect(v).toContain('noticed repeats their headline')
    expect(v).toContain('insight.why repeats the fact')
    expect(v).toContain('pitch.headline "Drive growth" is too generic')
    expect(v).toContain('banned phrase "drive growth"')
    expect(v).toContain('proof needs at least 2 items')
    // quoting their headline, framed as a quote, is fine
    const quoted = {
      ...good,
      noticed: 'Northwind leads with “Every pallet, visible before it’s late”',
    }
    expect(checkScript(quoted, kit, sales)).toEqual([])
  })

  it('accepts numbers that exist in sources', () => {
    expect(
      checkScript(
        { ...good, noticed: 'Northwind cut late deliveries 38% in a quarter.' },
        kit,
        sales,
      ),
    ).toEqual([])
  })

  it('requires the company name', () => {
    expect(
      checkScript(
        { ...good, hook: 'Hi there', noticed: 'Your homepage makes one promise.' },
        kit,
        sales,
      ).join(),
    ).toContain("company's name")
  })

  it('clamps lengths as a last resort', () => {
    const c = clampScript(
      { ...good, cta: 'one two three four five six seven eight nine ten!' },
      sales,
    )
    expect(c.cta.split(' ')).toHaveLength(8)
    expect(c.cta).not.toContain('!')
  })
})

describe('writer', () => {
  it('feeds violations back and accepts the revision', async () => {
    const calls: string[] = []
    const r = await writeScript({
      kit,
      profile: profile('sales'),
      model: 'fake',
      complete: async (key, messages) => {
        calls.push(key)
        if (key === 'script-1') return { ...good, hook: 'We revolutionize Northwind!' }
        expect(messages.at(-1)!.content).toContain('banned phrase "revolutionize"')
        return good
      },
    })
    expect(calls).toEqual(['script-1', 'script-2'])
    expect(r.meta).toMatchObject({ rounds: 2, usedFallback: false })
    expect(r.meta.violations[0]!.length).toBeGreaterThan(0)
    expect(r.script).toEqual(good)
  })

  it('falls back to the deterministic writer when the model never complies', async () => {
    const r = await writeScript({
      kit,
      profile: profile('sales'),
      model: 'fake',
      maxRounds: 2,
      complete: async () => ({ ...good, insight: { factId: 'nope', why: 'x' } }),
    })
    expect(r.meta.usedFallback).toBe(true)
    expect(checkScript(r.script, kit, profile('sales'))).toEqual([])
  })

  it('deterministic scripts always pass the checks, in both presets', () => {
    for (const p of [profile('sales'), profile('candidate')]) {
      expect(checkScript(deterministicScript(kit, p), kit, p)).toEqual([])
    }
  })

  it('prompts cite facts by id and include the taste rules', () => {
    const [sys, user] = buildMessages(kit, profile('candidate'))
    expect(sys!.content).toContain('Never invent numbers')
    expect(user!.content).toContain('f2 [stat] 38% fewer late deliveries')
    expect(user!.content).toContain('job candidate')
  })
})

describe('storyboard', () => {
  it('splits stats into number and label', () => {
    expect(splitStat('38% fewer late deliveries')).toEqual({
      value: '38%',
      rest: 'fewer late deliveries',
    })
    expect(splitStat('1,400+ shippers track freight')).toEqual({
      value: '1,400+',
      rest: 'shippers track freight',
    })
    expect(splitStat('Shippers love it')).toBeNull()
  })

  it('shows the fact and proof verbatim, never the model’s paraphrase', () => {
    const p = profile('sales')
    const b = buildStoryboard(kit, p, good)
    const insight = b.scenes.find((s) => s.kind === 'insight')
    expect(insight).toMatchObject({
      value: '38%',
      text: 'fewer late deliveries in the first quarter',
    })
    const proof = b.scenes.find((s) => s.kind === 'proof')
    expect(proof).toMatchObject({ stats: [p.proof[0], p.proof[2]] })
    expect(b.duration).toBeGreaterThan(25)
    expect(b.duration).toBeLessThan(32)
  })
})
