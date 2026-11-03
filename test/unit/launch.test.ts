import { describe, expect, it } from 'vitest'
import { gapsOf } from '../../src/job/fit.ts'
import { type Board, payOf, readBoard } from '../../src/jobs/boards.ts'
import { rank, SearchSchema } from '../../src/jobs/rank.ts'
import { approvalsFrom, employerKey } from '../../src/jobs/visa-build.ts'
import { briefOf } from '../../src/outreach/brief.ts'
import { nextStep, watchedFrom } from '../../src/outreach/followup.ts'
import { profile } from '../helpers/index.ts'

const NOW = Date.parse('2026-11-02T12:00:00Z')
const DAY = 86_400_000

describe('pay on job posts', () => {
  it('turns hourly and monthly pay into yearly, and refuses nonsense', () => {
    expect(payOf(150000, 200000, 'USD', '1 YEAR')).toEqual({
      min: 150000,
      max: 200000,
      currency: 'USD',
    })
    expect(payOf(50, 60, 'USD', 'per-hour-wage')).toEqual({
      min: 104000,
      max: 124800,
      currency: 'USD',
    })
    expect(payOf(200, 100, 'USD', 'year')).toBeNull()
    expect(payOf(5, 9, 'USD', 'year')).toBeNull()
  })

  it("reads Ashby's base salary and Lever's salary range", () => {
    const ashby: Board = { ats: 'ashby', token: 'acme', name: 'Acme' }
    const [a] = readBoard(ashby, {
      jobs: [
        {
          id: '1',
          title: 'Solutions Engineer',
          jobUrl: 'https://jobs.ashbyhq.com/acme/1',
          location: 'San Francisco',
          compensation: {
            summaryComponents: [
              { compensationType: 'EquityPercentage', minValue: 0.1, maxValue: 0.2 },
              {
                compensationType: 'Salary',
                minValue: 140000,
                maxValue: 180000,
                currencyCode: 'USD',
                interval: '1 YEAR',
              },
            ],
          },
        },
      ],
    })
    expect(a!.pay).toEqual({ min: 140000, max: 180000, currency: 'USD' })
    const lever: Board = { ats: 'lever', token: 'acme', name: 'Acme' }
    const [l] = readBoard(lever, [
      {
        id: '2',
        text: 'Forward Deployed Engineer',
        hostedUrl: 'https://jobs.lever.co/acme/2',
        categories: { location: 'Remote' },
        salaryRange: { min: 160000, max: 210000, currency: 'USD', interval: 'per-year-salary' },
      },
    ])
    expect(l!.pay).toEqual({ min: 160000, max: 210000, currency: 'USD' })
  })
})

describe('search filters', () => {
  const job = (company: string, daysAgo: number, pay?: number) => ({
    id: `x:${company}:${daysAgo}`,
    board: `ashby:${company.toLowerCase()}`,
    company,
    title: 'Solutions Engineer',
    url: 'https://example.com/j',
    location: 'Remote',
    remote: true,
    posted: new Date(NOW - daysAgo * DAY).toISOString(),
    ...(pay ? { pay: { min: pay - 20000, max: pay, currency: 'USD' } } : {}),
  })
  const jobs = [job('Acme', 3), job('Stripe', 20, 150000), job('Globex', 60, 260000)]
  const names = (s: Partial<ReturnType<typeof SearchSchema.parse>>) =>
    rank(jobs, SearchSchema.parse({ roles: ['Solutions Engineer'], ...s }), NOW).map(
      (j) => j.company,
    )

  it('keeps only recent posts when asked', () => {
    expect(names({ within: 'week' })).toEqual(['Acme'])
    expect(names({ within: 'month' }).sort()).toEqual(['Acme', 'Stripe'])
  })

  it('leaves out companies by name, whatever their suffix', () => {
    expect(names({ exclude: ['stripe inc'] }).sort()).toEqual(['Acme', 'Globex'])
  })

  it('hides roles that pay less, and keeps ones that list no pay', () => {
    expect(names({ minPay: 200000 }).sort()).toEqual(['Acme', 'Globex'])
  })
})

describe('fit gaps', () => {
  it('finds the skills matching jobs keep asking for that the profile lacks', () => {
    const p = profile('candidate')
    const gaps = gapsOf(
      [
        { id: 'a', requirements: ['Hands-on experience with Kubernetes and Terraform'] },
        { id: 'b', requirements: ['You have run Kubernetes clusters in production'] },
        { id: 'c', requirements: ['Comfort with Terraform or Pulumi'] },
      ],
      p,
    )
    expect(gaps.map((g) => [g.label, g.jobs])).toEqual([
      ['Kubernetes', 2],
      ['Terraform', 2],
    ])
    // a skill on the profile closes the gap, and so does marking it not relevant
    expect(
      gapsOf(
        [
          { id: 'a', requirements: ['Kubernetes'] },
          { id: 'b', requirements: ['Kubernetes'] },
        ],
        {
          ...p,
          skills: ['Kubernetes'],
        },
      ),
    ).toEqual([])
    expect(
      gapsOf(
        [
          { id: 'a', requirements: ['Uses Kubernetes daily'] },
          { id: 'b', requirements: ['Kubernetes at scale'] },
        ],
        p,
        { ignore: ['kubernete'] },
      ),
    ).toEqual([])
  })
})

describe('visa sponsors', () => {
  it('matches employer names without their suffixes', () => {
    expect(employerKey('STRIPE, INC.')).toBe('stripe')
    expect(employerKey('Scale AI Inc')).toBe('scale ai')
  })

  it('adds up approvals across columns and rows', () => {
    const csv = [
      'Fiscal Year,Employer,Initial Approval,Initial Denial,Continuing Approval,Continuing Denial,NAICS,Tax ID,State,City,ZIP',
      '2023,"STRIPE, INC.",10,1,20,0,54,1234,CA,SAN FRANCISCO,94107',
      '2023,STRIPE INC,5,0,5,0,54,1234,WA,SEATTLE,98101',
      '2023,ACME LLC,0,2,0,0,54,99,TX,AUSTIN,73301',
    ].join('\n')
    const m = approvalsFrom(csv)
    expect(m.get('stripe')).toBe(40)
    expect(m.get('acme')).toBe(0)
  })
})

describe('interview brief', () => {
  it('turns the film research into a brief and questions', () => {
    const b = briefOf(
      'Acme',
      {
        description: 'Acme automates invoices for mid-market finance teams.',
        facts: [
          { text: 'Trusted by 4,000 finance teams', kind: 'stat' },
          { text: 'Nav link', kind: 'headline' },
        ],
      },
      {
        title: 'Solutions Engineer',
        requirements: ['Experience running technical demos for enterprise buyers in finance'],
      },
      profile('candidate'),
    )
    expect(b.what).toContain('automates invoices')
    expect(b.facts).toEqual(['Trusted by 4,000 finance teams'])
    expect(b.role?.title).toBe('Solutions Engineer')
    expect(b.questions).toHaveLength(3)
    expect(b.questions[0]).toContain('4,000 finance teams.”')
    expect(b.questions[1]).toContain('first 90 days')
    // interview prep: the usual openers, answered from the profile, then the post's own asks
    expect(b.expect[0]!.q).toBe('Walk me through your background.')
    expect(b.expect[0]!.a).toBe(b.pitch)
    expect(b.expect[1]!.q).toBe('Why Acme?')
    expect(b.expect[1]!.a).toContain('4,000 finance teams')
    expect(b.expect.some((x) => x.q.includes('technical demos'))).toBe(true)
    expect(b.expect.length).toBeLessThanOrEqual(6)
  })
})

describe('follow-ups after a watch', () => {
  const sent = { status: 'sent' as const, at: '', sentAt: new Date(NOW - 1 * DAY).toISOString() }

  it('brings the follow-up forward to two days after they watched', () => {
    const watched = watchedFrom({
      plays: 1,
      finishes: 1,
      lastSeen: new Date(NOW - 0.5 * DAY).toISOString(),
    })
    const n = nextStep(sent, NOW, watched)!
    expect(n.watched).toEqual({ at: watched!.at, finished: true })
    expect(Date.parse(n.dueAt)).toBe(NOW + 1.5 * DAY)
  })

  it('keeps the usual timing without a play, or when the watch came first', () => {
    expect(
      nextStep(sent, NOW, watchedFrom({ plays: 0, finishes: 0, lastSeen: null }))!.watched,
    ).toBe(undefined)
    const before = watchedFrom({
      plays: 1,
      finishes: 0,
      lastSeen: new Date(NOW - 3 * DAY).toISOString(),
    })
    expect(nextStep(sent, NOW, before)!.watched).toBe(undefined)
  })
})

describe('fit check accuracy', () => {
  it("doesn't call a post with one requirement a strong fit", async () => {
    const { fitOf } = await import('../../src/job/fit.ts')
    const p = profile('candidate')
    const req = p.points[0]!
    expect(fitOf([req], p)?.level).toBe('good')
  })
})

describe('founders from Hunter', () => {
  it('puts founders and CEOs first, with their emails', async () => {
    const { hunterLeaders } = await import('../../src/outreach/email.ts')
    const f = async () =>
      Response.json({
        data: {
          emails: [
            {
              value: 'vp@acme.com',
              first_name: 'Val',
              last_name: 'P',
              position: 'VP Sales',
              confidence: 99,
            },
            {
              value: 'ann@acme.com',
              first_name: 'Ann',
              last_name: 'Lee',
              position: 'Co-founder & CEO',
              confidence: 80,
              verification: { status: 'valid' },
            },
            { value: 'noname@acme.com', position: 'CTO' },
          ],
        },
      })
    const l = await hunterLeaders('k', 'acme.com', f as never)
    expect(l.map((x) => x.email)).toEqual(['ann@acme.com', 'vp@acme.com'])
    expect(l[0]).toMatchObject({ name: 'Ann Lee', status: 'valid' })
  })
})

describe('raised recently', () => {
  it("matches the company's own filer, never a vehicle named after it", async () => {
    const { sameFiler } = await import('../../src/jobs/raised-build.ts')
    expect(sameFiler('Ramp', 'Ramp Business Corp')).toBe(true)
    expect(sameFiler('Anthropic', 'Anthropic, PBC')).toBe(true)
    expect(sameFiler('Ramp', 'EPIC Ramp LP')).toBe(false)
    expect(sameFiler('Ramp', 'Ramp SPV Series I')).toBe(false)
    expect(sameFiler('Notion', 'Notion Health Inc')).toBe(false)
  })

  it("reads Form Ds from EDGAR's quarterly index and keeps each company's latest", async () => {
    const { formDs, match, quartersSince } = await import('../../src/jobs/raised-build.ts')
    const idx = [
      'Form Type   Company Name                    CIK         Date Filed  File Name',
      '----------------------------------------------------------------------------',
      '10-K        RETOOL INC                      1111111     2026-05-01  edgar/data/1/a.txt',
      'D           RETOOL INC                      1111111     2026-02-01  edgar/data/1/b.txt',
      'D/A         Retool, Inc.                    1111111     2026-03-02  edgar/data/1/c.txt',
      'D           Retool Ventures LP              2222222     2026-06-01  edgar/data/2/d.txt',
      'D           Linear Orbit, Inc.              3333333     2025-01-01  edgar/data/3/e.txt',
    ].join('\n')
    const f = formDs(idx)
    expect(f).toHaveLength(4)
    expect(f[0]).toEqual({ filer: 'RETOOL INC', date: '2026-02-01' })
    const out = match(
      [
        { name: 'Retool', key: 'ashby:retool' },
        { name: 'Linear', key: 'ashby:linear' },
      ],
      f,
      '2025-11-03',
    )
    // the latest of Retool's own filings; never the fund named after it; nothing older than a year
    expect(out).toEqual({ 'ashby:retool': { date: '2026-03-02', filer: 'Retool, Inc.' } })
    expect(quartersSince(new Date('2025-11-03'), new Date('2026-11-03'))).toEqual([
      { year: 2025, q: 4 },
      { year: 2026, q: 1 },
      { year: 2026, q: 2 },
      { year: 2026, q: 3 },
      { year: 2026, q: 4 },
    ])
  })
})

describe('where and how senior', () => {
  it('tells US jobs from the rest', async () => {
    const { inUS } = await import('../../src/jobs/where.ts')
    const at = (location: string, country?: string, remote = false) =>
      inUS({ location, remote, ...(country ? { country } : {}) })
    expect(at('San Francisco, CA')).toBe(true)
    expect(at('New York, NY | London, UK')).toBe(true)
    expect(at('Remote - US')).toBe(true)
    expect(at('Remote', undefined, true)).toBe(true)
    expect(at('London, UK')).toBe(false)
    expect(at('Bangalore, IN')).toBe(false)
    expect(at('Toronto, ON')).toBe(false)
    expect(at('Remote - EMEA', undefined, true)).toBe(false)
    expect(at('HQ', 'United States')).toBe(true)
    expect(at('Berlin', 'Germany')).toBe(false)
  })

  it('reads the level from the title and the years from the requirements', async () => {
    const { levelOf, yearsAsked } = await import('../../src/jobs/where.ts')
    expect(levelOf('Software Engineering Intern, Summer 2027')).toBe('intern')
    expect(levelOf('New Grad Solutions Engineer')).toBe('intern')
    expect(levelOf('Associate Solutions Engineer')).toBe('entry')
    expect(levelOf('Forward Deployed Engineer')).toBe('mid')
    expect(levelOf('Senior Solutions Engineer')).toBe('senior')
    expect(levelOf('Staff Solutions Engineer')).toBe('lead')
    expect(levelOf('Director of Solutions Engineering')).toBe('director')
    expect(yearsAsked(['5+ years in sales engineering', '2-4 years of Python'])).toBe(2)
    expect(yearsAsked(['Strong communication'])).toBeNull()
  })

  it('filters by level, type and workplace', () => {
    const j = (title: string, extra: Record<string, unknown> = {}) => ({
      id: title,
      board: 'ashby:x',
      company: 'X',
      title,
      url: 'https://example.com/j',
      location: 'San Francisco, CA',
      remote: false,
      ...extra,
    })
    const jobs = [
      j('Solutions Engineer', { type: 'full_time', workplace: 'hybrid' }),
      j('Solutions Engineering Intern', { type: 'intern', workplace: 'onsite' }),
      j('Senior Solutions Engineer', { workplace: 'remote', remote: true }),
    ]
    const names = (s: Record<string, unknown>) =>
      rank(jobs as never, SearchSchema.parse(s), NOW)
        .map((x) => x.title)
        .sort()
    expect(names({ levels: ['intern'] })).toEqual(['Solutions Engineering Intern'])
    expect(names({ types: ['full_time'] })).toEqual([
      'Senior Solutions Engineer',
      'Solutions Engineer',
    ])
    expect(names({ workplaces: ['remote'] })).toEqual(['Senior Solutions Engineer'])
    expect(names({ workplaces: ['hybrid', 'onsite'] })).toEqual([
      'Solutions Engineer',
      'Solutions Engineering Intern',
    ])
  })
})

describe('limits and role type', () => {
  it('spots clearance and citizen-only posts, and people managers', async () => {
    const { CLEARANCE, CITIZEN_ONLY, managesOf } = await import('../../src/jobs/where.ts')
    expect(CLEARANCE.test('Active TS/SCI clearance required')).toBe(true)
    expect(CLEARANCE.test('Clear communication')).toBe(false)
    expect(CITIZEN_ONLY.test('Must be a U.S. citizen')).toBe(true)
    expect(CITIZEN_ONLY.test('Authorized to work in the US')).toBe(false)
    expect(managesOf('Engineering Manager')).toBe(true)
    expect(managesOf('Product Manager')).toBe(false)
    expect(managesOf('Head of Solutions')).toBe(true)
  })
})

describe('full-time first', () => {
  it('lists internships after full-time roles unless the search asks for them', () => {
    const j = (title: string, extra: Record<string, unknown> = {}) => ({
      id: title,
      board: `ashby:${title}`,
      company: title,
      title,
      url: 'https://example.com/j',
      location: 'San Francisco, CA',
      remote: false,
      ...extra,
    })
    const jobs = [j('Software Engineering Intern', { type: 'intern' }), j('Software Engineer')]
    expect(rank(jobs as never, SearchSchema.parse({}), NOW).map((x) => x.title)).toEqual([
      'Software Engineer',
      'Software Engineering Intern',
    ])
    expect(
      rank(jobs as never, SearchSchema.parse({ types: ['intern'] }), NOW).map((x) => x.title),
    ).toEqual(['Software Engineering Intern'])
  })
})
