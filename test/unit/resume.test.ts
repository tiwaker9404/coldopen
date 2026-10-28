import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LlmProvider } from '../../src/llm/types.ts'
import { checkDraft, type Draft, draftProfile } from '../../src/profile/draft.ts'
import { deterministicDraft, parseResume, statOf } from '../../src/profile/parse.ts'
import { resumeText } from '../../src/profile/read.ts'
import { ProfileSchema } from '../../src/script/types.ts'

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, '../../fixtures/resumes', name), 'utf8')
const priya = parseResume(fixture('priya-analyst.md'))
const marco = parseResume(fixture('marco-marketer.md'))

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

  it('leaves out an excluded employer entirely', () => {
    const r = parseResume(fixture('priya-analyst.md'), ['Harbor Grocers'])
    expect(r.entries.every((e) => e.org === 'Northwind Logistics')).toBe(true)
    const draft = deterministicDraft(r, { role: 'Data analyst' })
    expect(JSON.stringify(draft)).not.toMatch(/harbor/i)
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
      for (const x of p.proof) expect(r.text).toContain(x.value)
      expect(p.cta.contact).toBe(r.email)
    }
  })
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
    { entry: 'e1', value: '18%', label: 'less fresh-produce waste', where: 'Harbor Grocers' },
    {
      entry: 'e2',
      value: '20 minutes',
      label: 'weekly sales report prep',
      where: 'Harbor Grocers',
    },
    {
      entry: 'e5',
      value: '$1.2M',
      label: 'saved a year on carriers',
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
        { entry: 'e1', value: '25%', label: 'less waste', where: 'Harbor Grocers' },
        {
          entry: 'e2',
          value: '20 minutes',
          label: 'report prep across 50 stores',
          where: 'Harbor',
        },
        { entry: 'e3', value: '12', label: 'core KPIs', where: 'Google' },
        { entry: 'e9', value: '9', label: 'sources', where: 'Northwind' },
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
          text: JSON.stringify(replies.shift()),
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
    expect(profile.proof.map((p) => p.value)).toEqual(['18%', '20 minutes', '$1.2M'])
    expect(profile.sender).toEqual({ name: 'Priya Shah', role: 'Senior data analyst' })
  })

  it('drops what the model never grounds and tops up from the résumé', async () => {
    const stubborn: Draft = {
      ...goodDraft,
      proof: [
        goodDraft.proof[0]!,
        { entry: 'e2', value: '99%', label: 'accuracy', where: 'Harbor Grocers' },
        { entry: 'e3', value: '7', label: 'KPIs', where: 'Harbor Grocers' },
      ],
    }
    const llm: LlmProvider = {
      name: 'fake',
      complete: async () => ({
        text: JSON.stringify(stubborn),
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
    for (const p of profile.proof) expect(priya.text).toContain(p.value)
  })
})
