import { describe, expect, it } from 'vitest'
import type { BrandKit } from '../../src/brand/types.ts'
import { JOB_WORDS } from '../../src/outreach/voice.ts'
import { rankProof, relevance } from '../../src/profile/proof.ts'
import {
  checkScript,
  clampScript,
  jobPitchIn,
  notAlone,
  standsAlone,
} from '../../src/script/checks.ts'
import { aboutText, ideaOf, theirThings } from '../../src/script/ideas.ts'
import { buildStoryboard, captionFor, splitStat } from '../../src/script/storyboard.ts'
import { LIMITS } from '../../src/script/taste.ts'
import type { Script } from '../../src/script/types.ts'
import {
  buildMessages,
  CTAS,
  deterministicScript,
  HEADLINES,
  topicOf,
  writeScript,
} from '../../src/script/writer.ts'
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

  it('rejects a pitch that claims what the profile never says (deel.com)', () => {
    const cand = profile('candidate')
    const base = deterministicScript(kit, cand)
    const invented = {
      ...base,
      pitch: {
        headline: 'AI agent platform for global payroll',
        points: [cand.points[0]!, 'Runs payroll compliance for every country'],
      },
    }
    const v = checkScript(invented, kit, cand).join('\n')
    expect(v).toContain("claims things the profile doesn't say")
    expect(v).toContain('pitch.points[1]')
    // a job seeker's pitch is ideas for their product: the profile point copied over fails too
    expect(v).toMatch(/pitch\.points\[0\].*copied over.*pitch_is_idea/)
    // a seller's own point is still fine
    const sales = profile('sales')
    const sold = {
      ...invented,
      pitch: {
        ...invented.pitch,
        points: [sales.points[0]!, 'Runs payroll compliance for every country'],
      },
    }
    const w = checkScript(sold, kit, sales).join('\n')
    expect(w).toContain('pitch.points[1]')
    expect(w).not.toContain('pitch.points[0]')
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

  it('sends only the latest draft back, so requests stay the same size round after round', async () => {
    const sizes: number[] = []
    await writeScript({
      kit,
      profile: profile('sales'),
      model: 'fake',
      maxRounds: 4,
      complete: async (_key, messages) => {
        sizes.push(messages.length)
        return { ...good, hook: 'We revolutionize Northwind!' }
      },
    })
    expect(sizes).toEqual([2, 4, 4, 4])
  })

  it('swaps in built-in lines only where the model never complied, keeping its good lines', async () => {
    const r = await writeScript({
      kit,
      profile: profile('sales'),
      model: 'fake',
      maxRounds: 2,
      complete: async () => ({ ...good, insight: { factId: 'nope', why: 'x' } }),
    })
    expect(r.meta.usedFallback).toBe(false)
    expect(r.meta.replaced).toEqual(['insight'])
    expect(r.script.noticed).toBe(good.noticed)
    expect(r.script.pitch).toEqual(good.pitch)
    expect(checkScript(r.script, kit, profile('sales'))).toEqual([])
  })

  it('requires the reason to point at the sender, not compliment the company', () => {
    const compliment = {
      ...good,
      insight: { factId: 'f2', why: 'That shows the real reach of your platform.' },
    }
    expect(checkScript(compliment, kit, profile('sales')).join(' ')).toContain(
      'insight.why must connect',
    )
    // a sender with no company name still passes with the built-in writer ("We help teams…")
    const solo = { ...profile('sales'), sender: { name: 'Sam' }, offer: 'Bookkeeping for clinics' }
    expect(checkScript(deterministicScript(kit, solo), kit, solo)).toEqual([])
    const cand = profile('candidate')
    const candGood = { ...deterministicScript(kit, cand) }
    expect(checkScript(candGood, kit, cand)).toEqual([])
    const candBad = {
      ...candGood,
      insight: { ...candGood.insight, why: 'A strong result for any team' },
    }
    expect(checkScript(candBad, kit, cand).join(' ')).toContain('use "I" or "my"')
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
    expect(user!.content).toContain('curious builder')
    expect(user!.content).not.toContain('connect their strengths')
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

describe('the ask on the end card', () => {
  it('keeps a question a question', async () => {
    const { asked } = await import('../../src/script/storyboard.ts')
    expect(asked('Could we talk this week')).toBe('Could we talk this week?')
    expect(asked('Open to a 15-minute call.')).toBe('Open to a 15-minute call?')
    expect(asked('Could we talk this week?')).toBe('Could we talk this week?')
    expect(asked('Let’s talk this week')).toBe('Let’s talk this week')
  })
})

/* ------------------------------------------------ facts a stranger can read */

describe('standsAlone: a fact the film may quote with nothing around it', () => {
  const parcelpine = {
    name: 'Parcelpine',
    headline: 'Returns that keep the customer.',
    description:
      'Parcelpine turns returns into exchanges for Shopify brands, with instant store credit, QR drop-offs and fraud checks built in.',
  }
  const ok = (text: string) => standsAlone({ text }, parcelpine)

  it('quotes a full sentence about what they do, a measured result, or their own "we"', () => {
    expect(
      ok(
        'When a shopper sends something back for fit, Parcelpine now offers the next size up before the refund.',
      ),
    ).toBe(true)
    expect(ok('61% of returns become exchanges or store credit')).toBe(true)
    expect(
      ok('Serial returners and wardrobing patterns are flagged before a label is issued.'),
    ).toBe(true)
    expect(ok('Our team walks through how 4 in 10 fit returns became exchanges.')).toBe(true)
    expect(ok('"We stopped losing size swaps to refunds after the first week."')).toBe(true)
  })

  it('never quotes a line that leans on the one before it', () => {
    expect(ok('It also works for colors and every other variant in the store.')).toBe(false)
    expect(ok('This means fewer refunds and happier customers for your store.')).toBe(false)
    expect(ok('They see the exchange offer before the refund is issued.')).toBe(false)
    expect(ok('These checks run on every return before a label is printed.')).toBe(false)
    expect(ok('The above applies to every Parcelpine plan with exchanges on.')).toBe(false)
    expect(
      notAlone({ text: 'It also works for colors and every other variant.' }, parcelpine),
    ).toMatch(/starts with "It"/)
  })

  it('never quotes links, cookie or legal text, menus, questions or fragments', () => {
    expect(ok('Learn more about our platform')).toBe(false)
    expect(ok('Learn more about how Parcelpine turns returns into exchanges.')).toBe(false)
    expect(ok('Click here to see how exchanges work for Shopify brands.')).toBe(false)
    expect(ok('We use cookies to make returns and exchanges work better.')).toBe(false)
    expect(ok('© 2026 Parcelpine Inc. All rights reserved for returns.')).toBe(false)
    expect(ok('Exchanges Drop-off Fraud Checks Pricing Install On Shopify')).toBe(false)
    expect(ok('Dana Ruiz, VP Operations at Fieldstone Foods')).toBe(false)
    expect(ok('Are your returns turning into exchanges or refunds today?')).toBe(false)
    expect(ok('3,100 Shopify brands use Parcelpine')).toBe(false) // 5 words
    expect(ok('Parcelpine turns returns into exchanges for Shopify brands, with instant…')).toBe(
      false,
    )
    expect(ok('and turns every return into an exchange for Shopify brands.')).toBe(false)
  })

  it('never quotes a line that says nothing about them', () => {
    expect(
      ok('Route planning now reroutes trucks around live traffic before a delivery runs late.'),
    ).toBe(false)
    expect(ok('Dark mode is here, and it looks great on every screen.')).toBe(false)
  })

  it('keeps between 6 and 25 words', () => {
    expect(ok(`Parcelpine ${'turns returns into exchanges and '.repeat(5)}more.`)).toBe(false)
  })
})

describe('which fact the film features', () => {
  const sales = profile('sales')
  const candidate = profile('candidate')
  const base = {
    name: 'Parcelpine',
    host: 'parcelpine.example',
    headline: 'Returns that keep the customer.',
    description:
      'Parcelpine turns returns into exchanges for Shopify brands, with instant store credit, QR drop-offs and fraud checks built in.',
  }
  const claim = {
    id: 'f2',
    text: 'Shoppers see in-stock alternatives and bonus credit first, so a size swap stays an exchange.',
    kind: 'claim',
    source: { kind: 'homepage' },
  }
  const shipped = {
    id: 'hx1',
    text: 'When a shopper sends something back for fit, Parcelpine now offers the next size up.',
    kind: 'quote',
    source: {
      kind: 'changelog',
      title: 'Next size up',
      url: 'https://parcelpine.example/c/1',
      date: '2026-10-06',
    },
  }
  const stat = { id: 'f3', text: '61% of returns become exchanges or store credit', kind: 'stat' }
  const kitOf = (facts: unknown[]) => ({ ...base, facts }) as unknown as BrandKit

  it('prefers a stat that stands alone, then a recent changelog line, then a homepage claim', () => {
    for (const p of [sales, candidate]) {
      expect(deterministicScript(kitOf([claim, shipped, stat]), p).insight.factId).toBe('f3')
      expect(deterministicScript(kitOf([claim, shipped]), p).insight.factId).toBe('hx1')
      expect(deterministicScript(kitOf([claim]), p).insight.factId).toBe('f2')
    }
  })

  it('skips a stat that does not stand alone', () => {
    const bare = { id: 'f4', text: '3,100 Shopify brands', kind: 'stat' }
    expect(deterministicScript(kitOf([bare, shipped]), sales).insight.factId).toBe('hx1')
  })

  it('offers the model only facts that stand alone, with where each is from', () => {
    const dangling = {
      id: 'f5',
      text: 'It also works for colors and every other variant.',
      kind: 'claim',
    }
    const user = buildMessages(kitOf([claim, shipped, stat, dangling]), sales)[1]!.content
    expect(user).toContain('hx1 [quote] (changelog, Oct 2026) When a shopper')
    expect(user).toContain('f3 [stat] 61% of returns')
    expect(user).not.toContain('f5')
    expect(user).toMatch(/Pick in this order: a \[stat\], then one of those lines/)
    // a homepage-only site gets the same prompt as before
    expect(buildMessages(kitOf([claim, stat]), sales)[1]!.content).not.toContain(
      'Pick in this order',
    )
  })

  it('sends back a model pick that does not stand alone', () => {
    const dangling = {
      id: 'f5',
      text: 'It also works for colors and every other variant.',
      kind: 'claim',
    }
    const k = kitOf([claim, dangling])
    const s = {
      ...deterministicScript(k, sales),
      insight: { factId: 'f5', why: 'Parcelpine helps teams back a promise like this with data' },
    }
    expect(checkScript(s, k, sales).join('\n')).toMatch(/"f5" doesn't make sense out of context/)
  })

  it('still makes a film when nothing on the site stands alone', () => {
    const k = kitOf([{ id: 'f1', text: 'Returns, sorted.', kind: 'claim' }])
    expect(deterministicScript(k, sales).insight.factId).toBe('f1')
    expect(checkScript(deterministicScript(k, sales), k, sales).join('\n')).not.toMatch(
      /out of context/,
    )
  })
})

describe('the caption under the quote', () => {
  it('says where the fact is from, with the month only when the source gives a date', () => {
    expect(captionFor({ kind: 'stat', source: { kind: 'homepage' } })).toBe('From their homepage')
    expect(captionFor({ kind: 'stat' })).toBe('From their homepage')
    expect(captionFor({ kind: 'quote', source: { kind: 'changelog', date: '2026-10-06' } })).toBe(
      'From their changelog, Oct 2026',
    )
    expect(captionFor({ kind: 'stat', source: { kind: 'podcast', date: '2026-09-22' } })).toBe(
      'From their podcast, episode notes, Sep 2026',
    )
    expect(captionFor({ kind: 'quote', source: { kind: 'docs' } })).toBe('From their docs')
    expect(captionFor({ kind: 'quote', source: { kind: 'engineering', date: '2026-01-02' } })).toBe(
      'From their engineering blog, Jan 2026',
    )
    expect(captionFor({ kind: 'requirement' }, { job: 'Operations Analyst' })).toBe(
      'From your Operations Analyst post',
    )
    expect(captionFor({ kind: 'stat' }, { own: true })).toBe('From our homepage')
  })

  it('goes on the fact scene, with the source link when it is https', () => {
    const k = {
      ...kit,
      facts: [
        ...kit.facts,
        {
          id: 'hx',
          text: 'Northwind now flags a late pallet before the dock appointment slips.',
          kind: 'quote',
          source: {
            kind: 'changelog',
            url: 'https://northwind.example/changelog/1',
            date: '2026-10-30',
          },
        },
      ],
    } as unknown as BrandKit
    const board = buildStoryboard(k, profile('sales'), {
      ...good,
      insight: { ...good.insight, factId: 'hx' },
    })
    const insight = board.scenes.find((s) => s.kind === 'insight')
    expect(insight).toMatchObject({
      caption: 'From their changelog, Oct 2026',
      sourceUrl: 'https://northwind.example/changelog/1',
    })
    const home = buildStoryboard(kit, profile('sales'), good).scenes.find(
      (s) => s.kind === 'insight',
    )
    expect(home).toMatchObject({ caption: 'From their homepage' })
    expect(home).not.toHaveProperty('sourceUrl')
  })
})

describe("a job seeker's film: a builder's take on their product", () => {
  const COMPANIES = [
    'Northwind Freight',
    'Parcelpine',
    'Lumen Health',
    'Acme Robotics',
    'Hiring Hub',
    'Tidewater',
    'Bluefin Labs',
    'Orchard',
    'Quill',
    'Kestrel AI',
    'Marigold Pay',
    'Stackwise',
    'Ferrous',
    'Juniper Data',
    'Cobalt',
    'Waypoint',
    'Ember Health',
    'Lattice Works',
    'Pebble',
    'Sundial',
  ]
  const kitOf = (name: string, job = false): BrandKit =>
    ({
      ...kit,
      name,
      host: `${name.toLowerCase().replace(/\s+/g, '')}.example`,
      headline: 'Returns that keep the customer.',
      description: `${name} turns returns into exchanges for Shopify brands.`,
      facts: [
        { id: 'f1', text: 'Returns that keep the customer.', kind: 'headline' },
        { id: 'f2', text: '61% of returns become exchanges or store credit', kind: 'stat' },
        ...(job
          ? [
              {
                id: 'j1',
                text: 'Experience with hiring pipelines and job boards, from the first application',
                kind: 'requirement',
              },
            ]
          : []),
      ],
      ...(job ? { job: { title: 'Operations Analyst' } } : {}),
    }) as unknown as BrandKit

  it('candidate lines never pitch the job', () => {
    const p = profile('candidate')
    for (const n of COMPANIES)
      for (const job of [false, true]) {
        const k = kitOf(n, job)
        const s = deterministicScript(k, p)
        expect(checkScript(s, k, p), `${n} ${job}`).toEqual([])
        for (const line of [s.hook, s.noticed, s.insight.why, s.pitch.headline, s.cta])
          expect(jobPitchIn(line, n), `${n}: ${line}`).toEqual([])
        const board = buildStoryboard(k, p, s)
        const hook = board.scenes[0]!
        expect(hook.kind === 'hook' && jobPitchIn(hook.sub ?? '', n)).toEqual([])
      }
    // the model's lines are held to the same rule, and every job word is caught
    const k = kitOf('Parcelpine', true)
    const s = deterministicScript(k, p)
    for (const w of [...JOB_WORDS, 'hire me', 'interview']) {
      const v = checkScript({ ...s, cta: `Talk about the ${w}?` }, k, p)
      expect(
        v.some((x) => x.includes('not_job_pitch')),
        w,
      ).toBe(true)
    }
    const headline = checkScript(
      { ...s, pitch: { ...s.pitch, headline: 'Why I fit your Operations Analyst role' } },
      k,
      p,
    )
    expect(headline.join(' ')).toContain('pitch.headline says "role"')
    // their own words in quotation marks, and their name, aren't the sender's pitch
    expect(jobPitchIn('Hiring Hub leads with "Hiring that feels human"', 'Hiring Hub')).toEqual([])
    // sellers aren't held to it
    const sales = profile('sales')
    const ss = deterministicScript(k, sales)
    expect(
      checkScript({ ...ss, cta: 'Worth a look for your hiring team?' }, k, sales).join(' '),
    ).not.toContain('not_job_pitch')
  })

  it('the cta invites a conversation', () => {
    const p = profile('candidate')
    for (const n of COMPANIES)
      for (const job of [false, true]) {
        const k = kitOf(n, job)
        const { cta } = deterministicScript(k, p)
        expect(cta.endsWith('?'), cta).toBe(true)
        expect(cta.split(/\s+/).length).toBeLessThanOrEqual(LIMITS.cta)
        expect(cta).toMatch(/\b(notes|talk|chat)\b/)
        expect(jobPitchIn(cta, n)).toEqual([])
        const board = buildStoryboard(k, p, deterministicScript(k, p))
        const end = board.scenes.find((x) => x.kind === 'cta')!
        expect(end.kind === 'cta' && end.line).toBe(cta)
      }
    // every line says their thing, and fits with a long name
    for (const c of CTAS) expect(c("Parcelpine's returns")).toContain("Parcelpine's returns")
    expect(topicOf(kitOf('Parcelpine'), kitOf('Parcelpine').facts[1]!)).toBe('returns')
  })

  it('different companies rarely share a headline', () => {
    const p = profile('candidate')
    const heads = COMPANIES.map((n) => deterministicScript(kitOf(n), p).pitch.headline)
    expect(new Set(heads).size).toBe(COMPANIES.length)
    for (const h of heads) {
      expect(h).toMatch(/^(What|Where) I'd/)
      expect(h.split(/\s+/).length).toBeGreaterThanOrEqual(4)
      expect(h.split(/\s+/).length).toBeLessThanOrEqual(LIMITS.headline)
    }
    // all four kinds of line turn up, so it isn't one template with a name swapped in
    const kinds = new Set(
      heads.map((h) =>
        HEADLINES.findIndex(
          (f) =>
            f('X').split('X')[0] ===
            h.split(
              /(?=Northwind|Parcelpine|Lumen|Acme|Hiring|Tidewater|Bluefin|Orchard|Quill|Kestrel|Marigold|Stackwise|Ferrous|Juniper|Cobalt|Waypoint|Ember|Lattice|Pebble|Sundial)/,
            )[0],
        ),
      ),
    )
    expect(kinds.size).toBeGreaterThanOrEqual(3)
  })

  it("the model is told to write a builder's take, and never the job words", () => {
    const [, user] = buildMessages(kitOf('Parcelpine', true), profile('candidate'))
    expect(user!.content).toContain(
      "what the sender would try or build with this company's product",
    )
    expect(user!.content).toContain('"hire me" or "interview"')
    expect(user!.content).toContain(`says, in the first person, what you'd do about it ("I'd …")`)
    expect(user!.content).not.toContain('The pitch headline may name the role')
  })
})

describe("a job seeker's pitch: ideas for their product, and the proof that fits them", () => {
  // the kind of site the judge read: feature headings, a changelog line, a customer number
  const freight = {
    ...kit,
    facts: [
      ...kit.facts,
      { id: 'f4', text: 'Exception alerts', kind: 'claim' },
      { id: 'f5', text: 'Dock scheduling', kind: 'claim' },
      { id: 'f6', text: 'Carrier check-ins', kind: 'claim' },
      { id: 'f7', text: '1,400+ shippers track freight on Northwind', kind: 'stat' },
    ],
  } as unknown as BrandKit
  const seeker = profile('candidate')

  it('writes 2–3 ideas, each "I\'d <verb> <their thing> — like <what the sender did>"', () => {
    const s = deterministicScript(freight, seeker)
    expect(s.pitch.points.length).toBeGreaterThanOrEqual(2)
    expect(s.pitch.points.length).toBeLessThanOrEqual(3)
    const dids = seeker.proof.map((p) => p.did).filter(Boolean) as string[]
    for (const p of s.pitch.points) {
      expect(p).toMatch(/^I'd .+ — like /)
      expect(p.split(/\s+/).length).toBeLessThanOrEqual(LIMITS.idea)
      // the idea names one of their things
      const idea = ideaOf(p)!
      expect(
        theirThings(freight).some((t) => idea.includes(t)),
        idea,
      ).toBe(true)
      // the "like …" is one thing the sender actually did, in its own words
      const like = p.slice(p.indexOf('like the ') + 9).replace(/ I \w+$/, '')
      expect(
        dids.some((d) => d.toLowerCase().includes(like.toLowerCase())),
        like,
      ).toBe(true)
      // and never a profile point copied over
      expect(seeker.points).not.toContain(p)
    }
    expect(checkScript(s, freight, seeker)).toEqual([])
  })

  it('pitch_is_idea: a profile point copied over fails for a job seeker, not for a seller', () => {
    const s = deterministicScript(freight, seeker)
    const copied = {
      ...s,
      pitch: { ...s.pitch, points: [seeker.points[0]!, ...s.pitch.points.slice(1)] },
    }
    const v = checkScript(copied, freight, seeker)
    expect(v.join('\n')).toMatch(/pitch\.points\[0\].*copied over.*\(pitch_is_idea\)/)
    // an idea about something they never mention fails too
    const invented = {
      ...s,
      pitch: {
        ...s.pitch,
        points: [
          "I'd rebuild the billing portal — like the pipeline I built",
          ...s.pitch.points.slice(1),
        ],
      },
    }
    expect(checkScript(invented, freight, seeker).join('\n')).toMatch(
      /doesn't name anything of theirs/,
    )
    // and an idea resting on nothing the sender did
    const unbacked = {
      ...s,
      pitch: {
        ...s.pitch,
        points: [
          "I'd stream carrier check-ins into one live view — like the rocket I launched",
          ...s.pitch.points.slice(1),
        ],
      },
    }
    expect(checkScript(unbacked, freight, seeker).join('\n')).toMatch(/isn't something you did/)
    // a seller's points stay their own, and the old check still holds for them
    const sales = profile('sales')
    expect(
      checkScript(deterministicScript(freight, sales), freight, sales).filter((x) =>
        x.includes('pitch_is_idea'),
      ),
    ).toEqual([])
  })

  it('ranks proof by relevance to their business first, then impressiveness; no did or where ranks last', () => {
    const order = rankProof(seeker.proof, aboutText(freight))
    // the carrier-tracking pipeline is the freight proof, not the certification
    expect(seeker.proof[order[0]!]!.where).toBe('Brightline Logistics')
    expect(seeker.proof[order.at(-1)!]!.label).toBe('Solutions Architect certified')
    expect(deterministicScript(freight, seeker).proof[0]).toBe(order[0])
    // a returns company: the refund proof is closer than the freight one
    const returns = {
      ...kit,
      name: 'Parcelpine',
      headline: 'Returns that keep the customer',
      description: 'Parcelpine turns refunds into exchanges for Shopify brands.',
      facts: [{ id: 'f1', text: '61% of returns become exchanges', kind: 'stat' }],
    } as unknown as BrandKit
    expect(seeker.proof[rankProof(seeker.proof, aboutText(returns))[0]!]!.label).toContain(
      'double refunds',
    )
    // with nothing in common, the most impressive real proof leads
    expect(relevance(seeker.proof[0]!, 'Patients answer in plain language.')).toBe(0)
    // closeness by meaning, when FIT_SEMANTIC is on, can lift a proof the words miss
    const lifted = rankProof(seeker.proof, aboutText(freight), new Map([[2, 9]]))
    expect(lifted[0]).toBe(2)
  })

  it('leaving out the proof closest to their business is a violation', () => {
    const s = deterministicScript(freight, seeker)
    const top = rankProof(seeker.proof, aboutText(freight))[0]!
    const without = { ...s, proof: s.proof.filter((i) => i !== top) }
    expect(checkScript(without, freight, seeker).join('\n')).toMatch(
      /closest to Northwind Freight's business/,
    )
  })
  // sales, recruiter and hiring films and prompts: film-presets.test.ts snapshots them unchanged
})
