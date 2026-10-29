import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BrandKit } from '../../src/brand/types.ts'
import { withJob } from '../../src/job/kit.ts'
import { cleanTitle, itemsFromText, jobFromText, pickRequirements } from '../../src/job/post.ts'
import { rankProfiles } from '../../src/profile/match.ts'
import { checkScript } from '../../src/script/checks.ts'
import { buildStoryboard } from '../../src/script/storyboard.ts'
import type { Profile } from '../../src/script/types.ts'
import { deterministicScript } from '../../src/script/writer.ts'
import { profile } from '../helpers/index.ts'

const POSTED = `Forward Deployed Engineer
Northwind Freight is hiring.

About the role
You will work with our largest shippers.

What you'll do:
- Deploy our routing agents inside customer warehouses, from first call to production
- Turn messy shipment data from customer ERPs into reliable pipelines
- Explain technical trade-offs to operations leaders who are not engineers

What we're looking for:
• 3+ years shipping production software in Python or TypeScript
• Experience putting AI agents with evals in front of real customers

Benefits:
- Medical, dental and vision insurance
- 401(k) with a 4% match
`

const kit: BrandKit = {
  url: 'https://northwindfreight.example/',
  host: 'northwindfreight.example',
  name: 'Northwind Freight',
  title: 'Northwind Freight',
  description: 'Freight for retailers',
  headline: 'Freight that shows up',
  subheads: [],
  nav: [],
  facts: [
    { id: 'f1', text: 'Freight that shows up', kind: 'headline' },
    { id: 'f2', text: '2.4 million pallets moved a year', kind: 'stat' },
  ],
  colors: {
    background: '#ffffff',
    text: '#111111',
    primary: '#c6f432',
    accent: '#c6f432',
    dark: '#111111',
    swatches: [],
  },
  fonts: {
    display: { family: 'Inter', category: 'sans', weight: 700, faces: [] },
    body: { family: 'Inter', category: 'sans', weight: 400, faces: [] },
  },
  logo: null,
  screenshot: { file: 'site.jpg', width: 1440, height: 900, headlineBox: null },
  extractedAt: '2026-10-28T00:00:00Z',
}

describe('reading a job post', () => {
  it('takes requirements first, then the work, and drops benefits', () => {
    const job = jobFromText(POSTED)
    expect(job.title).toBe('Forward Deployed Engineer')
    expect(job.requirements.slice(0, 2)).toEqual([
      '3+ years shipping production software in Python or TypeScript',
      'Experience putting AI agents with evals in front of real customers',
    ])
    expect(job.requirements).toContain(
      'Turn messy shipment data from customer ERPs into reliable pipelines',
    )
    expect(job.requirements.join(' ')).not.toMatch(/dental|401/)
  })

  it('reads headings marked with a colon, markdown or nothing at all', () => {
    const items = itemsFromText(
      '## Requirements\n- SQL every day for five years\n\nPerks\n- Free lunch on Fridays',
    )
    expect(pickRequirements(items)).toEqual(['SQL every day for five years'])
  })

  it('cleans job board titles', () => {
    expect(cleanTitle('Forward Deployed Engineer - Platform (Remote, US)')).toBe(
      'Forward Deployed Engineer',
    )
    expect(cleanTitle('Job Application for Data Analyst at Lumen Health')).toBe('Data Analyst')
    expect(cleanTitle('Senior Data Analyst, Growth | Lumen')).toBe('Senior Data Analyst, Growth')
    expect(cleanTitle('Solutions Engineer, Remote')).toBe('Solutions Engineer')
  })

  it('says what to do when there is nothing to read', () => {
    expect(() => jobFromText('We are hiring! Apply now.')).toThrow(/paste the part/)
  })
})

describe('a film that answers the job', () => {
  const candidate = profile('candidate')
  const jobKit = withJob(kit, jobFromText(POSTED))

  it('quotes a requirement and answers it with proof, and passes every check', () => {
    const s = deterministicScript(jobKit, candidate)
    expect(checkScript(s, jobKit, candidate)).toEqual([])
    const req = jobKit.facts.find((f) => f.id === s.insight.factId)!
    expect(req.kind).toBe('requirement')
    expect(s.insight.why).toMatch(/^(I did this|I have done this|My closest match)/)
    expect(s.pitch.headline).toContain('Forward Deployed Engineer')

    const board = buildStoryboard(jobKit, candidate, s)
    const hook = board.scenes[0]!
    const insight = board.scenes[2]!
    expect(hook.kind === 'hook' && hook.sub).toBe('For your Forward Deployed Engineer role')
    expect(insight.kind === 'insight' && insight.source).toBe('your Forward Deployed Engineer post')
    // their words, shown as a quote: never turned into a big "3+"
    expect(insight.kind === 'insight' && insight.value).toBeNull()
  })

  it("rejects the job's numbers passed off as the sender's", () => {
    const s = deterministicScript(jobKit, candidate)
    const v = checkScript(
      { ...s, insight: { ...s.insight, why: 'I have 3+ years of this' } },
      jobKit,
      candidate,
    )
    expect(v.join(' ')).toMatch(/"3\+?".*not in your profile/)
  })

  it('insists on a requirement, not a homepage stat', () => {
    const s = deterministicScript(jobKit, candidate)
    const v = checkScript({ ...s, insight: { ...s.insight, factId: 'f2' } }, jobKit, candidate)
    expect(v.join(' ')).toMatch(/feature one of the job's requirements/)
  })

  it("rejects an answer that isn't on the record", () => {
    const s = deterministicScript(jobKit, candidate)
    const v = checkScript(
      { ...s, insight: { ...s.insight, why: 'I would love to try this someday' } },
      jobKit,
      candidate,
    )
    expect(v.join(' ')).toMatch(/answer the requirement with something from your profile/)
  })

  it('without a job post, films are unchanged', () => {
    const s = deterministicScript(kit, candidate)
    expect(s.insight.factId).toBe('f2')
    expect(buildStoryboard(kit, candidate, s).scenes[0]).toMatchObject({
      sub: 'A 30-second film for Northwind Freight',
    })
  })
})

describe('choosing a profile for a job', () => {
  const analyst: Profile = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../profiles/examples/data-analyst.json'), 'utf8'),
  )
  const profiles = [
    { id: 'analyst', profile: analyst },
    { id: 'fde', profile: profile('candidate') },
  ]

  it("follows the job's title, not just the homepage", () => {
    const fde = rankProfiles(kit, profiles, jobFromText(POSTED))
    expect(fde[0]!.id).toBe('fde')
    expect(fde[0]!.reasons).toContain('role: deployed')
    const analystJob = jobFromText(
      'Senior Data Analyst\nRequirements:\n- SQL and dashboards for finance teams\n- Clear charts that lead to decisions',
    )
    expect(rankProfiles(kit, profiles, analystJob)[0]!.id).toBe('analyst')
  })
})
