import { describe, expect, it } from 'vitest'
import { loosePronoun, standsAlone } from '../../src/script/checks.ts'
import {
  type FilmBrand,
  type RecentFilm,
  type ReviewFact,
  type ReviewInput,
  reviewFilm,
} from '../../src/script/review.ts'
import type { Profile, Script, ScriptMeta } from '../../src/script/types.ts'

/**
 * The review before sending: each flag from fixture QA data, as a founder would read the film.
 * Everything here is the data a finished film saves (film.ts), so no browser is needed.
 */

const PROFILE: Profile = {
  preset: 'candidate',
  sender: { name: 'Alex Rivera' },
  offer: 'An engineer who ships AI agents customers actually use',
  points: ['Ships production agents with evals', 'Turns messy customer data into pipelines'],
  proof: [
    {
      value: '6h → 45m',
      label: 'daily data sync, from 6 hours to 45 minutes',
      where: 'Rail Inc.',
      did: 'Built containerized ETL with Docker and PostgreSQL',
    },
    {
      value: '1.5M',
      label: 'HubSpot records moved, 100% consistent',
      where: 'Changing The Present',
      did: 'Built an automated Python migration pipeline',
    },
    { value: '6', label: 'open-source AI projects shipped' },
    {
      value: '2.5M+',
      label: 'financial records moved off legacy Oracle',
      where: 'Deloitte',
      did: 'Migrated a bank database to hybrid cloud',
    },
  ],
  cta: { line: 'Could we talk this week?', contact: 'alex@example.com' },
}

const SCRIPT: Script = {
  hook: 'Hi Parcelpine team',
  noticed: 'Your rate table compares carriers per zone',
  insight: { factId: 'f4', why: 'I would wire the rate API into a returns flow' },
  pitch: {
    headline: 'What I would build with your rate API',
    points: ['Ship a returns agent on your rate API', 'Turn carrier invoices into a clean feed'],
  },
  proof: [0, 1],
  cta: 'Trade notes on carrier rates?',
}

const FACTS: ReviewFact[] = [
  {
    id: 'f4',
    text: '38% fewer late deliveries in the first quarter on Parcelpine',
    kind: 'stat',
    caption: 'From their homepage',
  },
  {
    id: 'f17',
    text: "We'll show it live in 20 minutes.",
    kind: 'stat',
    caption: 'From their homepage',
  },
  {
    id: 'f6',
    text: 'Parcelpine compares rates from 40 carriers in one table for every shipping zone.',
    kind: 'claim',
    caption: 'From their homepage',
  },
  {
    id: 'h1',
    text: 'Parcelpine now returns per-zone surcharges in the rate API for every carrier.',
    kind: 'quote',
    caption: 'From their changelog, Oct 2026',
    url: 'https://parcelpine.example/changelog',
  },
  {
    id: 'f8',
    text: 'It also tracks every parcel from the dock to the door.',
    kind: 'claim',
    caption: 'From their homepage',
  },
  {
    id: 'f9',
    text: 'Parcelpine flags a late carrier before the shopper ever notices it.',
    kind: 'claim',
    caption: 'From their homepage',
  },
]

const BRAND: FilmBrand = {
  logo: 'image',
  logoSize: { width: 120, height: 32 },
  fallbacks: {},
  fonts: { display: 'Fraunces', body: 'Inter' },
  contrast: [
    { field: 'dark', part: 'text', ratio: 15.2, min: 4.5 },
    { field: 'light', part: 'text', ratio: 13.1, min: 4.5 },
    { field: 'brand', part: 'accent', ratio: 3.4, min: 3 },
  ],
  about: {
    headline: 'Shipping rates for every carrier, in one table.',
    description: 'Parcelpine compares carrier rates and tracks parcels for online stores.',
  },
}

const MODEL: ScriptMeta = {
  model: 'openai/gpt-oss-120b',
  rounds: 1,
  violations: [[]],
  usedFallback: false,
  replaced: [],
}

/** a clean fixture film: every scene reads on its own */
const clean = (over: Partial<ReviewInput> = {}): ReviewInput => ({
  company: 'Parcelpine',
  profile: PROFILE,
  script: SCRIPT,
  scriptMeta: MODEL,
  qa: { duration: 30, issues: [], frame: { margin: 0.06, top: 0 }, fonts: [] },
  highlights: {
    quote: { text: FACTS[0]!.text, caption: 'From their homepage' },
    proof: [PROFILE.proof[0]!, PROFILE.proof[1]!],
  },
  brand: BRAND,
  facts: FACTS,
  ...over,
})

const codes = (r: ReturnType<typeof reviewFilm>) =>
  r.scenes.flatMap((s) => s.flags.map((f) => `${s.kind}:${f.code}`))

describe('a pronoun with nothing to point at', () => {
  it('finds "it" in the middle of a line that never says what it is', () => {
    expect(loosePronoun("We'll show it live in 20 minutes.")).toBe('it')
    expect(loosePronoun('We ship them every week to our customers.')).toBe('them')
    expect(loosePronoun('Our team will walk you through that today.')).toBeNull()
  })

  it('lets a pronoun point back at a thing in the same line, and lets "this week" be', () => {
    expect(loosePronoun('Our new dashboard makes it easy to compare carriers.')).toBeNull()
    expect(loosePronoun('Shoppers get a tracking page that updates on its own.')).toBeNull()
    expect(loosePronoun('We launched this week for every Shopify store.')).toBeNull()
    expect(loosePronoun('Parcelpine compares carriers so you never do it by hand.')).toBeNull()
  })

  it('keeps such a line out of the facts a film may quote', () => {
    expect(standsAlone({ text: "We'll show it live in 20 minutes." }, { name: 'Parcelpine' })).toBe(
      false,
    )
  })
})

describe('reviewing a film before it goes out', () => {
  it('a clean fixture film has six scenes, no flags, and is ready to send', () => {
    const r = reviewFilm(clean())
    expect(r.scenes.map((s) => s.kind)).toEqual([
      'hook',
      'site',
      'insight',
      'pitch',
      'proof',
      'cta',
    ])
    expect(codes(r)).toEqual([])
    expect(r).toMatchObject({ ready: true, count: 0 })
    // the fact scene carries its caption
    expect(r.scenes[2]!.caption).toBe('From their homepage')
  })

  it('flags a quote with a mid-line "it", and offers the next 3 facts that read on their own', () => {
    const r = reviewFilm(
      clean({ script: { ...SCRIPT, insight: { ...SCRIPT.insight, factId: 'f17' } } }),
    )
    const flag = r.scenes[2]!.flags[0]!
    expect(flag.code).toBe('fact_out_of_context')
    expect(flag.text).toMatch(/“it”/)
    expect(r.ready).toBe(false)
    expect(flag.fix.kind).toBe('fact')
    if (flag.fix.kind !== 'fact') return
    expect(flag.fix.label).toBe('Use another fact')
    // never the flagged one, never "It also…", at most 3, each with its caption
    expect(flag.fix.options.map((o) => o.id)).toEqual(['f4', 'f6', 'h1'])
    expect(flag.fix.options[2]!.caption).toBe('From their changelog, Oct 2026')
  })

  it('flags a quote that starts by pointing at a line before it', () => {
    const r = reviewFilm(
      clean({ script: { ...SCRIPT, insight: { ...SCRIPT.insight, factId: 'f8' } } }),
    )
    expect(codes(r)).toEqual(['insight:fact_out_of_context'])
  })

  it('reads an older film from its quote alone, offering to edit when it has no facts saved', () => {
    const r = reviewFilm(
      clean({
        facts: null,
        highlights: { quote: { text: "We'll show it live in 20 minutes." }, proof: [] },
      }),
    )
    expect(r.scenes[2]!.flags[0]).toMatchObject({
      code: 'fact_out_of_context',
      fix: { kind: 'edit', line: 'why' },
    })
  })

  it('flags proof a stranger can’t read, and offers results from the profile that do read', () => {
    const r = reviewFilm(clean({ script: { ...SCRIPT, proof: [0, 2] } }))
    const flag = r.scenes[4]!.flags[0]!
    expect(flag.code).toBe('proof_unclear')
    expect(flag.text).toMatch(/what you did or where it happened/)
    expect(flag.fix).toMatchObject({ kind: 'proof', label: 'Use another proof', slot: 1 })
    if (flag.fix.kind === 'proof') expect(flag.fix.options.map((o) => o.index)).toEqual([1, 3])
  })

  it('reads the proof the film showed, not the writer’s pick, when the sender chose it', () => {
    expect(codes(reviewFilm(clean({ proof: [2] })))).toEqual(['proof:proof_unclear'])
  })

  it('flags a missing logo until the sender chooses their name as the logo', () => {
    const none = reviewFilm(clean({ brand: { ...BRAND, logo: 'wordmark', logoSize: undefined } }))
    expect(none.scenes[0]!.flags[0]).toMatchObject({
      code: 'no_logo',
      fix: { kind: 'wordmark', label: 'Use their name as the logo' },
    })
    const tiny = reviewFilm(clean({ brand: { ...BRAND, logoSize: { width: 16, height: 16 } } }))
    expect(codes(tiny)).toEqual(['hook:no_logo'])
    const chosen = reviewFilm(
      clean({ wordmark: true, brand: { ...BRAND, logo: 'wordmark', logoSize: undefined } }),
    )
    expect(chosen.ready).toBe(true)
  })

  it('says which free font stood in for one that couldn’t be embedded', () => {
    const r = reviewFilm(
      clean({
        brand: {
          ...BRAND,
          fonts: { display: 'SF Pro Display', body: 'SF Pro Text' },
          fallbacks: { display: 'Inter', body: 'Inter' },
        },
      }),
    )
    const flag = r.scenes[0]!.flags[0]!
    expect(flag.code).toBe('font_fallback')
    expect(flag.text).toContain('SF Pro Display (shown in Inter)')
    expect(flag.text).toContain('SF Pro Text (shown in Inter)')
  })

  it('flags a headline zoomed out of frame, and a line that doesn’t fit, on its own scene', () => {
    const r = reviewFilm(
      clean({
        qa: {
          duration: 30,
          frame: { margin: -0.03, top: 0 },
          issues: [{ kind: 'overflow', text: 'What I would build with your rate API' }],
          fonts: [],
        },
      }),
    )
    expect(codes(r)).toEqual(['site:headline_cut', 'pitch:headline_cut'])
    expect(r.scenes[3]!.flags[0]!.fix).toMatchObject({ kind: 'edit', line: 'headline' })
  })

  it('flags text below WCAG contrast on the scenes that use it', () => {
    const r = reviewFilm(
      clean({
        brand: {
          ...BRAND,
          contrast: [{ field: 'brand', part: 'text', ratio: 3.9, min: 4.5 }],
        },
      }),
    )
    expect(codes(r)).toEqual(['insight:low_contrast'])
    expect(r.scenes[2]!.flags[0]!.text).toMatch(/3\.9:1, needs 4\.5:1/)
  })

  it('flags a built-in line that 2 of the last 10 films share, with the company name aside', () => {
    const builtIn: ScriptMeta = { ...MODEL, model: 'deterministic' }
    const other = (company: string): RecentFilm => ({
      company,
      script: { ...SCRIPT, hook: `Hi ${company} team`, cta: 'Something else entirely?' },
      scriptMeta: builtIn,
    })
    const once = reviewFilm(clean({ scriptMeta: builtIn }), [other('Lumen')])
    expect(codes(once)).toEqual([])
    const twice = reviewFilm(clean({ scriptMeta: builtIn }), [other('Lumen'), other('Northwind')])
    expect(codes(twice)).toContain('hook:templated_line')
    expect(twice.scenes[0]!.flags.find((f) => f.code === 'templated_line')!.fix).toMatchObject({
      kind: 'edit',
      line: 'hook',
    })
    // a line the model wrote is the model's, even when it matches
    expect(codes(reviewFilm(clean(), [other('Lumen'), other('Northwind')]))).toEqual([])
  })

  it('flags job words in a job seeker’s lines, but not quoted text or a sales film', () => {
    const pitch = { ...SCRIPT, cta: 'Open to an interview for the role?' }
    expect(codes(reviewFilm(clean({ script: pitch })))).toEqual(['cta:job_words'])
    const quoted = { ...SCRIPT, insight: { ...SCRIPT.insight, why: 'I read "the role" as ops' } }
    expect(codes(reviewFilm(clean({ script: quoted })))).toEqual([])
    const sales = { ...PROFILE, preset: 'sales' as const }
    expect(codes(reviewFilm(clean({ profile: sales, script: pitch })))).toEqual([])
  })

  it('counts every flag, and is only ready with none', () => {
    const r = reviewFilm(
      clean({
        script: { ...SCRIPT, insight: { ...SCRIPT.insight, factId: 'f17' }, proof: [2] },
        brand: { ...BRAND, logo: 'wordmark', logoSize: undefined },
      }),
    )
    expect(r.count).toBe(3)
    expect(r.ready).toBe(false)
  })
})
