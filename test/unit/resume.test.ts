import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { LlmProvider } from '../../src/llm/types.ts'
import { checkDraft, type Draft, DraftSchema, draftProfile } from '../../src/profile/draft.ts'
import {
  deterministicDraft,
  parseResume,
  proofFromBullet,
  schoolsOf,
  statOf,
} from '../../src/profile/parse.ts'
import { allowedNumbers, numbersIn, readableProof } from '../../src/profile/proof.ts'
import { resumeText } from '../../src/profile/read.ts'
import { ProfileSchema } from '../../src/script/types.ts'

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '../../fixtures/resumes', name), 'utf8')
const priya = parseResume(fixture('priya-analyst.md'))
const marco = parseResume(fixture('marco-marketer.md'))
const ashwin = parseResume(fixture('ashwin-fde.md'))
/** every number a card may show: the bullets' own, and a worked-out ending figure */
const fromResume = (r: typeof priya) => r.entries.flatMap((e) => [...allowedNumbers(e.text)])
/** the bullet a phrase only it has sits in, as a draft cites it ("e5") */
const cite = (r: typeof ashwin, phrase: string) => {
  const i = r.entries.findIndex((e) => e.text.includes(phrase))
  expect(i).toBeGreaterThanOrEqual(0)
  return { id: `e${i + 1}`, entry: r.entries[i]! }
}

describe('reading a résumé', () => {
  it('finds the person, their email, and which job each bullet belongs to', () => {
    expect(priya.name).toBe('Priya Shah')
    expect(priya.email).toBe('priya.shah@example.com')
    expect(priya.entries.map((e) => e.org)).toEqual([
      'Harbor Grocers',
      'Harbor Grocers',
      'Harbor Grocers',
      'Northwind Logistics',
      'Northwind Logistics',
    ])
    expect(marco.entries.filter((e) => e.org === 'Brightside Fitness')).toHaveLength(2)
  })

  it("keeps an excluded employer's work, but never its name", () => {
    const r = parseResume(fixture('priya-analyst.md'), ['Harbor Grocers'])
    // the work stays, placed by the role: the job she still has is her current role
    expect(r.entries.map((e) => e.org)).toEqual([
      'Current Senior Data Analyst role',
      'Current Senior Data Analyst role',
      'Current Senior Data Analyst role',
      'Northwind Logistics',
      'Northwind Logistics',
    ])
    expect(r.text).not.toMatch(/harbor/i)
    const draft = deterministicDraft(r, { role: 'Data analyst' })
    expect(JSON.stringify(draft)).not.toMatch(/harbor/i)
    // a bullet that names the excluded word itself is left out
    expect(parseResume(fixture('priya-analyst.md'), ['Tableau']).entries).toHaveLength(4)
    // a placeholder or typo is reported, not silently ignored
    expect(parseResume(fixture('priya-analyst.md'), ['Your Employer']).unmatchedExcludes).toEqual([
      'Your Employer',
    ])
  })

  it('reads the FDE résumé: each job and project by name', () => {
    expect(ashwin.entries).toHaveLength(17)
    expect([...new Set(ashwin.entries.map((e) => e.org))]).toEqual([
      'Changing The Present',
      'Rail Inc.',
      'Duke Advanced Degree Consulting Club',
      'Deloitte Touche Tohmatsu',
      'ITC Infotech',
      'Statement Flow',
      'Enterprise B2B Integration Gateway',
    ])
  })

  it('finds the schools, for alumni at the companies you film', () => {
    expect(
      schoolsOf([
        'EDUCATION',
        'Duke University, Fuqua School of Business — Durham, NC   2025 - 2026',
        'Master of Quantitative Management: Business Analytics',
        'Vellore Institute of Technology | B.Tech Computer Science | 2018 - 2022',
        '• Led the analytics club at Duke University for two years',
      ]),
    ).toEqual(['Duke University', 'Vellore Institute of Technology'])
    expect(priya.schools).toEqual(['University of Texas at Austin'])
  })

  it('reads text files and refuses empty or unsupported ones', async () => {
    const text = await resumeText(new TextEncoder().encode(fixture('marco-marketer.md')), 'cv.md')
    expect(text).toContain('Fernleaf Tea Co.')
    await expect(resumeText(new TextEncoder().encode('hi'), 'cv.txt')).rejects.toThrow(
      /almost no text/,
    )
    await expect(resumeText(new Uint8Array(400), 'cv.pages')).rejects.toThrow(/can't read .pages/)
  })
})

describe('turning bullets into proof', () => {
  // every case is a real bullet shape: from coldopen's author's résumé and the two fixtures
  it.each([
    [
      'reducing daily client data synchronization latency from 6 hours to just 45 minutes.',
      '45 minutes',
      'daily client data synchronization latency, down from 6 hours',
    ],
    [
      'Cut blended customer acquisition cost from $48 to $31 by rebuilding creative testing.',
      '$31',
      'blended customer acquisition cost, down from $48',
    ],
    [
      'Built a forecasting model that cut fresh-produce waste by 18% across 42 stores.',
      '18%',
      'less fresh-produce waste across 42 stores',
    ],
    [
      'Launched a lifecycle email program that lifted 90-day retention by 14% for new subscribers.',
      '14%',
      'more 90-day retention for new subscribers',
    ],
    [
      'Wrote and shipped weekly newsletters to 250,000 members.',
      '250,000',
      'members reached with weekly newsletters',
    ],
    [
      'contributing to mapping and transferring 2.5M+ historical transaction records.',
      '2.5M+',
      'historical transaction records',
    ],
  ])('%s', (text, value, label) => {
    expect(statOf(text)).toEqual({ value, label })
  })

  it("doesn't read B2B, years or bare versions as numbers", () => {
    expect(statOf('Directed deployments for enterprise B2B clients in 2024')).toBeNull()
  })

  it('drafts a valid profile where every proof number is in the résumé', () => {
    for (const r of [priya, marco]) {
      const p = ProfileSchema.parse(deterministicDraft(r, { role: 'Data analyst' }))
      for (const x of p.proof)
        for (const n of numbersIn(x.value)) expect(fromResume(r)).toContain(n)
      expect(p.cta.contact).toBe(r.email)
    }
  })
})

/** a draft as a model sends it: every field present, null where the bullet has no change */
const reply = (d: Draft) =>
  JSON.stringify({
    ...d,
    proof: d.proof.map((p) => ({ ...p, before: p.before ?? null, after: p.after ?? null })),
  })

const goodDraft: Draft = {
  role: 'Senior data analyst',
  offer: 'Data analyst who turns messy operational data into dashboards leaders use',
  points: [
    'Builds forecasting models in Python',
    'Rebuilds dashboards leaders actually use',
    'Defines KPIs with merchandising leads',
  ],
  proof: [
    {
      entry: 'e1',
      value: '18%',
      label: 'less fresh-produce waste across 42 stores',
      did: 'Built a demand forecasting model in Python',
      where: 'Harbor Grocers',
    },
    {
      entry: 'e2',
      value: '6h → 20m',
      label: 'weekly sales report prep, from 6 hours to 20 minutes',
      did: 'Rebuilt the weekly sales dashboard in Tableau',
      where: 'Harbor Grocers',
      before: '6 hours',
      after: '20 minutes',
    },
    {
      entry: 'e5',
      value: '$1.2M',
      label: 'saved a year on carriers',
      did: 'Analyzed 3M+ shipment records to find late deliveries',
      where: 'Northwind Logistics',
    },
  ],
}

describe('checking a model-written draft', () => {
  it('passes a grounded draft', () => {
    expect(checkDraft(goodDraft, priya, [])).toEqual([])
  })

  it('catches numbers, places and claims the résumé never makes', () => {
    const bad: Draft = {
      ...goodDraft,
      offer: 'Results-driven analyst with 10 years of experience',
      points: [...goodDraft.points, 'Expert in quantum blockchain orchestration'],
      proof: [
        { ...goodDraft.proof[0]!, value: '25%', label: 'less waste' },
        { ...goodDraft.proof[1]!, label: 'report prep across 50 stores', where: 'Harbor' },
        { ...goodDraft.proof[0]!, entry: 'e3', value: '12', label: 'core KPIs', where: 'Google' },
        { ...goodDraft.proof[0]!, entry: 'e9', value: '9', label: 'sources', where: 'Northwind' },
      ],
    }
    const v = checkDraft(bad, priya, ['Northwind']).join('\n')
    expect(v).toContain('proof[0].value "25%" is not a number from e1')
    expect(v).toContain('proof[1].label uses "50"')
    expect(v).toContain('proof[2].where "Google" isn\'t in the résumé')
    expect(v).toContain('proof[3].entry "e9" is not a bullet id')
    expect(v).toContain('offer uses "10"')
    expect(v).toContain('"results-driven"')
    expect(v).toContain("mostly uses words the résumé doesn't")
    expect(v).toContain('mentions "Northwind"')
  })

  it('revises with the model, then keeps only what is grounded', async () => {
    const replies = [
      {
        ...goodDraft,
        proof: [{ ...goodDraft.proof[0]!, value: '25%' }, ...goodDraft.proof.slice(1)],
      },
      goodDraft,
    ]
    const seen: string[] = []
    const llm: LlmProvider = {
      name: 'fake',
      complete: async (req) => {
        seen.push(req.messages.at(-1)!.content)
        return {
          text: reply(replies.shift()!),
          model: 'fake',
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        }
      },
    }
    const { profile, meta } = await draftProfile({
      resume: priya,
      role: 'Senior data analyst',
      llm,
    })
    expect(meta.rounds).toBe(2)
    expect(seen[1]).toContain('"25%" is not a number from e1')
    // the before → after leads, then the big number
    expect(profile.proof.map((p) => p.value)).toEqual(['6h → 20m', '$1.2M', '18%'])
    expect(profile.proof[0]!.did).toBe('Rebuilt the weekly sales dashboard in Tableau')
    expect(profile.sender).toEqual({ name: 'Priya Shah', role: 'Senior data analyst' })
  })

  it('drops what the model never grounds and tops up from the résumé', async () => {
    const stubborn: Draft = {
      ...goodDraft,
      proof: [
        goodDraft.proof[0]!,
        { ...goodDraft.proof[0]!, entry: 'e2', value: '99%', label: 'accuracy' },
        { ...goodDraft.proof[0]!, entry: 'e3', value: '7', label: 'KPIs' },
      ],
    }
    const llm: LlmProvider = {
      name: 'fake',
      complete: async () => ({
        text: reply(stubborn),
        model: 'fake',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      }),
    }
    const { profile, meta } = await draftProfile({
      resume: priya,
      role: 'Analyst',
      llm,
      maxRounds: 2,
    })
    expect(meta.dropped).toEqual(['proof[1] 99%', 'proof[2] 7'])
    expect(profile.proof).toHaveLength(3)
    for (const p of profile.proof)
      for (const n of numbersIn(p.value)) expect(fromResume(priya)).toContain(n)
  })
})

/** a model that answers each round with the next reply, and remembers what it was asked */
function scripted(...replies: Draft[]) {
  const seen: string[] = []
  const llm: LlmProvider = {
    name: 'fake',
    complete: async (req) => {
      seen.push(req.messages.at(-1)!.content)
      return {
        text: reply(replies.length > 1 ? replies.shift()! : replies[0]!),
        model: 'fake',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      }
    },
  }
  return { llm, seen }
}

const FDE = 'Forward Deployed Engineer'
/** two more cards every test draft carries, since a draft has at least 3 */
const more = (): Draft['proof'] => [
  {
    entry: cite(ashwin, '2.5M+ historical').id,
    value: '2.5M+',
    label: 'financial records moved off legacy Oracle',
    did: "Migrated a Tier-1 bank's database to hybrid cloud",
    where: 'Deloitte',
  },
  {
    entry: cite(ashwin, '1,500+ active user').id,
    value: '1,500+',
    label: 'user identities moved to RBAC, zero errors',
    did: 'Built a Python migration engine for access control',
    where: 'Duke consulting club',
  },
]
const ashwinDraft = (proof: Draft['proof']): Draft => ({
  role: FDE,
  offer: 'Forward Deployed Engineer who ships ETL pipelines and migrations for enterprise clients',
  points: [
    'Builds custom ETL pipelines in Python',
    'Migrates legacy data to PostgreSQL',
    'Embeds with enterprise engineering teams',
  ],
  proof: [...proof, ...more()],
})

describe('proof a stranger understands', () => {
  const rail = cite(ashwin, 'from 6 hours to 45 minutes')
  const railGood: Draft['proof'][number] = {
    entry: rail.id,
    value: '6h → 45m',
    label: 'daily client data sync, from 6 hours to 45 minutes',
    did: 'Built containerized ETL with Docker and PostgreSQL',
    where: 'Rail Inc.',
    before: '6 hours',
    after: '45 minutes',
  }

  it('drafts a before and after as the change, with what was built and where', () => {
    expect(proofFromBullet(rail.entry)).toEqual({
      value: '6h → 45m',
      label: 'daily client data sync cycles, from 6 hours to 45 minutes',
      did: 'Built containerized ETL workflows using Docker and PostgreSQL',
      where: 'Rail Inc.',
    })
    // the same change stated against a baseline: 2 days off a 5-day baseline is 5 → 3 days
    const itc = cite(ashwin, '5-day baseline')
    expect(proofFromBullet(itc.entry)).toMatchObject({
      value: '5 → 3 days',
      label: 'infra onboarding, from 5 days to 3 days',
      where: 'ITC Infotech',
    })
    expect(proofFromBullet(cite(ashwin, 'from 3 days to 4 hours').entry)?.value).toBe('3d → 4h')
  })

  it('never takes the starting figure alone; one rewrite, then the bullet’s own words', async () => {
    const lazy = { ...railGood, value: '6', label: 'hours of daily data sync' }
    const v = checkDraft(ashwinDraft([lazy]), ashwin, []).join('\n')
    expect(v).toContain('value should be the change ("6h → 45m")')
    expect(v).toContain('label should say both: "from 6 hours to 45 minutes"')
    // a model that never fixes it: the card is rebuilt from the bullet, never shown as "6"
    const { llm, seen } = scripted(ashwinDraft([lazy]))
    const { profile, meta } = await draftProfile({ resume: ashwin, role: FDE, llm, maxRounds: 2 })
    expect(seen[1]).toContain('value should be the change')
    expect(meta.rebuilt).toEqual([`proof[0] 6`])
    expect(profile.proof[0]).toMatchObject({ value: '6h → 45m', where: 'Rail Inc.' })
    expect(profile.proof.map((p) => p.value)).not.toContain('6')
  })

  it('keeps a good before and after card as the model wrote it', async () => {
    expect(checkDraft(ashwinDraft([railGood]), ashwin, [])).toEqual([])
    const { llm } = scripted(ashwinDraft([railGood]))
    const { profile, meta } = await draftProfile({ resume: ashwin, role: FDE, llm })
    expect(meta.rounds).toBe(1)
    expect(profile.proof[0]).toEqual({
      value: '6h → 45m',
      label: 'daily client data sync, from 6 hours to 45 minutes',
      did: 'Built containerized ETL with Docker and PostgreSQL',
      where: 'Rail Inc.',
    })
  })

  it('says what was done from the bullet, with résumé padding dropped', () => {
    const did = (phrase: string) => proofFromBullet(cite(ashwin, phrase).entry)?.did
    expect(did('1.5M HubSpot records')).toBe('Built an automated Python pipeline')
    expect(did('50,000+ daily payloads')).toBe('Built Python middleware')
    expect(did('12+ critical')).toBe(
      'Led bi-weekly technical requirements scoping syncs with enterprise engineering teams',
    )
    expect(did('1,500+ active user')).toBe('Built a secure Python migration engine')
    // a bullet that leads with the result takes its act from the "by ..." part
    expect(did('insertion errors by 85%')).toBe(
      'Implemented strict JSON schema sanitization at the network edge',
    )
    expect(did('comprehensive, production-ready')).toBe(
      'Wrote technical runbooks and detailed deployment docs',
    )
    // and a draft whose did is padding, or missing, is asked again
    const padded = { ...railGood, did: 'Orchestrated and leveraged containerized ETL workflows' }
    expect(checkDraft(ashwinDraft([padded]), ashwin, []).join('\n')).toContain(
      'did uses résumé padding ("leveraged", "orchestrated")',
    )
    const noAct = { ...railGood, did: 'ETL workflows with Docker and PostgreSQL' }
    expect(checkDraft(ashwinDraft([noAct]), ashwin, []).join('\n')).toContain(
      'should start with a verb',
    )
  })

  it('rejects a number the bullet never has, and a worked-out one that is wrong', () => {
    const v = (p: Partial<Draft['proof'][number]>) =>
      checkDraft(ashwinDraft([{ ...railGood, ...p }]), ashwin, []).join('\n')
    expect(v({ value: '6h → 30m' })).toContain('is not a number from')
    expect(v({ did: 'Built ETL for 40 analysts with Docker' })).toContain('did uses "40"')
    const itc = cite(ashwin, '5-day baseline')
    const card = {
      entry: itc.id,
      label: 'customer onboarding, from 5 days to 3',
      did: 'Wrote deployment runbooks for regional teams',
      where: 'ITC Infotech',
    }
    expect(checkDraft(ashwinDraft([{ ...card, value: '5 → 3 days' }]), ashwin, [])).toEqual([])
    expect(checkDraft(ashwinDraft([{ ...card, value: '5 → 4 days' }]), ashwin, [])).toContainEqual(
      expect.stringContaining('is not a number from'),
    )
  })

  it('ranks the before and afters and the big numbers first', () => {
    const p = deterministicDraft(ashwin, { role: FDE })
    expect(p.proof.slice(0, 3).map((x) => x.value)).toEqual(['6h → 45m', '5 → 3 days', '3d → 4h'])
    for (const v of ['2.5M+', '1.5M', '1,500+']) expect(p.proof.map((x) => x.value)).toContain(v)
    for (const x of p.proof) {
      const e = ashwin.entries.find((y) => proofFromBullet(y)?.value === x.value)!
      expect(readableProof(x, e.text).checks).toMatchObject({
        has_action: true,
        keeps_before_after: true,
        has_where: true,
        numbers_from_resume: true,
        no_excluded_employer: true,
      })
    }
  })
})

/** every text a profile holds, field by field */
const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []

describe('an employer left out stays out', () => {
  const EMPLOYER = 'Changing The Present'
  const raw = fixture('ashwin-fde.md')
  const placeholder = '[Current employer, left out]'
  // the same résumé with the employer redacted in place, as people share them
  const redacted = parseResume(raw.replace(EMPLOYER, placeholder))

  it('never copies a redaction line into a drafted field', async () => {
    expect(raw).toContain(EMPLOYER)
    const leak = /left out|\[|\]/i
    const det = deterministicDraft(redacted, { role: FDE })
    for (const f of strings(det)) expect(f).not.toMatch(leak)
    expect(det.proof.filter((p) => p.where === 'Current FDE role').length).toBeGreaterThan(0)
    // a model that copies the placeholder is told to say the role instead, then is dropped
    const hub = cite(redacted, '1.5M HubSpot records')
    const copied: Draft['proof'][number] = {
      entry: hub.id,
      value: '1.5M',
      label: 'HubSpot records moved to PostgreSQL, 100% consistent',
      did: 'Built an automated Python migration pipeline',
      where: placeholder,
    }
    const v = checkDraft(ashwinDraft([copied]), redacted, []).join('\n')
    expect(v).toContain('redaction placeholder')
    const { llm } = scripted(ashwinDraft([copied]))
    const { profile } = await draftProfile({ resume: redacted, role: FDE, llm, maxRounds: 2 })
    for (const f of strings(profile)) expect(f).not.toMatch(leak)
  })

  it('with --exclude, no field has a word only the employer line had', async () => {
    const name = EMPLOYER
    const real = raw
    const line = real.split('\n').find((l) => l.includes(name))!
    const rest = real.replace(line, '').toLowerCase()
    const only = line
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 2 && !rest.includes(w))
    expect(only).toEqual(expect.arrayContaining(['changing']))

    const r = parseResume(real, [name])
    expect(r.entries.filter((e) => e.org === 'Current FDE role')).toHaveLength(3)
    const hub = cite(r, '1.5M HubSpot records')
    const named: Draft['proof'][number] = {
      entry: hub.id,
      value: '1.5M',
      label: 'HubSpot records moved to PostgreSQL, 100% consistent',
      did: 'Built an automated Python migration pipeline',
      where: 'Changing',
    }
    const draft = ashwinDraft([named])
    draft.points = [...draft.points, 'Ships migrations at Changing The Present']
    const v = checkDraft(draft, r, [name]).join('\n')
    expect(v).toContain(`mentions "${name}"`)
    expect(v).toContain('proof[0].where "Changing" isn\'t in the résumé')

    const fixed = ashwinDraft([{ ...named, where: 'Current FDE role' }])
    expect(checkDraft(fixed, r, [name])).toEqual([])
    for (const llm of [scripted(draft).llm, scripted(fixed).llm, null]) {
      const { profile } = await draftProfile({ resume: r, role: FDE, exclude: [name], llm })
      const text = JSON.stringify(profile).toLowerCase()
      for (const w of only) expect(text).not.toContain(w)
    }
  })
})

describe('the draft works with strict structured outputs', () => {
  it('requires every field, so Groq and OpenAI accept the schema and the model sees it', () => {
    // an optional field makes strict mode reject the schema; the provider then falls back to
    // plain JSON, and the model, no longer shown the fields, leaves out "entry" (11 Nov)
    const unrequired: string[] = []
    const walk = (s: unknown, at: string) => {
      if (!s || typeof s !== 'object') return
      const o = s as { properties?: Record<string, unknown>; required?: string[]; items?: unknown }
      if (o.properties)
        for (const [k, v] of Object.entries(o.properties)) {
          if (!o.required?.includes(k)) unrequired.push(`${at}.${k}`)
          walk(v, `${at}.${k}`)
        }
      if (o.items) walk(o.items, `${at}[]`)
    }
    walk(z.toJSONSchema(DraftSchema), 'draft')
    expect(unrequired).toEqual([])
  })

  it('drafts from the résumé’s own words when the model fails outright', async () => {
    const llm: LlmProvider = {
      name: 'fake',
      complete: async () => ({
        text: JSON.stringify({ role: FDE, offer: 'x', points: [], proof: [{ value: '6h' }] }),
        model: 'fake',
        inputTokens: 1,
        outputTokens: 1,
        latencyMs: 1,
      }),
    }
    const { profile, meta } = await draftProfile({ resume: ashwin, role: FDE, llm })
    expect(meta.model).toBe('deterministic')
    expect(meta.error).toMatch(/failed validation/)
    expect(profile.proof[0]!.value).toBe('6h → 45m')
  })
})
