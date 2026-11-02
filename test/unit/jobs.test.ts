import { describe, expect, it } from 'vitest'
import { type Board, parseBoardLink, readBoard } from '../../src/jobs/boards.ts'
import { DEFAULT_BOARDS } from '../../src/jobs/companies.ts'
import {
  defaultSearch,
  placeFit,
  rank,
  SearchSchema,
  spread,
  titleFit,
} from '../../src/jobs/rank.ts'

const NOW = Date.parse('2026-11-02T16:00:00Z')
const days = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

describe('board links', () => {
  it('reads boards and job links on all three systems', () => {
    expect(
      parseBoardLink('https://job-boards.greenhouse.io/anthropic/jobs/5456619008'),
    ).toMatchObject({
      ats: 'greenhouse',
      token: 'anthropic',
      name: 'Anthropic',
    })
    expect(parseBoardLink('boards.greenhouse.io/embed/job_board?for=acme')).toMatchObject({
      ats: 'greenhouse',
      token: 'acme',
    })
    expect(parseBoardLink('jobs.lever.co/palantir/6ed76ce8')).toMatchObject({
      ats: 'lever',
      token: 'palantir',
    })
    expect(parseBoardLink('https://jobs.ashbyhq.com/david-ai')).toMatchObject({
      ats: 'ashby',
      token: 'david-ai',
      name: 'David Ai',
    })
  })
  it('refuses anything else', () => {
    for (const l of [
      'https://acme.com/careers',
      'linkedin.com/jobs/view/1',
      'not a link',
      'https://jobs.ashbyhq.com/',
    ])
      expect(parseBoardLink(l)).toBeNull()
  })
  it('has no duplicate default boards', () => {
    const keys = DEFAULT_BOARDS.map((b) => `${b.ats}:${b.token}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(DEFAULT_BOARDS.every((b) => b.site?.startsWith('https://'))).toBe(true)
  })
})

describe('reading boards', () => {
  const gh: Board = {
    ats: 'greenhouse',
    token: 'anthropic',
    name: 'Anthropic',
    site: 'https://www.anthropic.com/',
  }
  it('greenhouse', () => {
    const jobs = readBoard(gh, {
      jobs: [
        {
          id: 1,
          title: ' Forward Deployed  Engineer ',
          absolute_url: 'https://job-boards.greenhouse.io/anthropic/jobs/1',
          location: { name: 'San Francisco, CA | Seattle, WA' },
          first_published: '2026-10-30T10:00:00-04:00',
          departments: [{ name: 'Applied AI' }],
        },
        {
          id: 2,
          title: 'Remote role',
          absolute_url: 'https://x.test/2',
          location: { name: 'Remote - US' },
        },
        { id: 3, title: 'No link' },
      ],
    })
    expect(jobs).toHaveLength(2)
    expect(jobs[0]).toEqual({
      id: 'greenhouse:anthropic:1',
      board: 'greenhouse:anthropic',
      company: 'Anthropic',
      site: 'https://www.anthropic.com/',
      title: 'Forward Deployed Engineer',
      url: 'https://job-boards.greenhouse.io/anthropic/jobs/1',
      location: 'San Francisco, CA | Seattle, WA',
      remote: false,
      team: 'Applied AI',
      posted: '2026-10-30T14:00:00.000Z',
    })
    expect(jobs[1]!.remote).toBe(true)
  })
  it('lever', () => {
    const [j] = readBoard({ ats: 'lever', token: 'palantir', name: 'Palantir' }, [
      {
        id: 'abc',
        text: 'Forward Deployed Software Engineer',
        hostedUrl: 'https://jobs.lever.co/palantir/abc',
        createdAt: 1786469891368,
        categories: {
          team: 'Dev',
          location: 'New York, NY',
          allLocations: ['New York, NY', 'Washington, D.C.'],
        },
        workplaceType: 'onsite',
      },
    ])
    expect(j).toMatchObject({
      title: 'Forward Deployed Software Engineer',
      location: 'New York, NY | Washington, D.C.',
      remote: false,
      team: 'Dev',
    })
  })
  it('ashby, skipping unlisted posts', () => {
    const jobs = readBoard(
      { ats: 'ashby', token: 'ramp', name: 'Ramp' },
      {
        jobs: [
          {
            id: 'u1',
            title: 'Solutions Engineer',
            jobUrl: 'https://jobs.ashbyhq.com/ramp/u1',
            location: 'New York, NY (HQ)',
            secondaryLocations: [{ location: 'San Francisco, CA' }],
            isRemote: false,
            isListed: true,
            department: 'Sales',
            publishedAt: '2026-10-31T00:00:00Z',
          },
          {
            id: 'u2',
            title: 'Hidden',
            jobUrl: 'https://jobs.ashbyhq.com/ramp/u2',
            isListed: false,
          },
        ],
      },
    )
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      location: 'New York, NY (HQ) | San Francisco, CA',
      team: 'Sales',
    })
  })
  it('gives nothing for an unexpected shape', () => {
    expect(readBoard(gh, { error: 'nope' })).toEqual([])
    expect(readBoard({ ats: 'lever', token: 'x', name: 'X' }, null)).toEqual([])
  })
})

describe('ranking', () => {
  it('fits titles by their words', () => {
    expect(titleFit('Forward Deployed Engineer, Applied AI', 'Forward Deployed Engineer')).toBe(3)
    expect(titleFit('Forward Deployed Software Engineer', 'FDE')).toBe(3)
    expect(titleFit('Senior Solution Engineer', 'Solutions Engineer')).toBe(3)
    expect(titleFit('Forward Deployed Strategist', 'Forward Deployed Engineer')).toBe(0)
    expect(titleFit('Sales Engineer', 'Solutions Engineer')).toBe(0)
    expect(titleFit('Software Engineer', 'Solutions Engineer')).toBe(0)
    expect(titleFit('Data Analyst, Growth', 'analyst')).toBe(3)
  })
  it('matches places the way people say them', () => {
    expect(placeFit('Palo Alto, CA', 'Bay Area')).toBe(true)
    expect(placeFit('San Francisco, CA | New York, NY', 'NYC')).toBe(true)
    expect(placeFit('Sanford, FL', 'SF')).toBe(false)
    expect(placeFit('London, UK', 'New York')).toBe(false)
  })

  const job = (title: string, location: string, extra: object = {}) => ({
    id: `b:${title}:${location}`,
    board: 'b',
    company: 'Acme',
    title,
    url: `https://x.test/${encodeURIComponent(title + location)}`,
    location,
    remote: /remote/i.test(location),
    ...extra,
  })

  it('keeps fitting roles in the right places, newest and closest first, with reasons', () => {
    const s = SearchSchema.parse({
      roles: ['Forward Deployed Engineer', 'Solutions Engineer'],
      locations: ['Bay Area'],
    })
    const out = rank(
      [
        job('Forward Deployed Engineer', 'San Francisco, CA', { posted: days(2) }),
        job('Solutions Engineer', 'Remote - US', { posted: days(1) }),
        job('Solutions Engineer', 'London', { posted: days(1) }),
        job('Account Executive', 'San Francisco, CA'),
        job('Forward Deployed Engineer', 'San Francisco, CA', { posted: days(2) }),
      ],
      s,
      NOW,
    )
    expect(out.map((j) => `${j.title} / ${j.location}`)).toEqual([
      'Forward Deployed Engineer / San Francisco, CA',
      'Solutions Engineer / Remote - US',
    ])
    expect(out[0]!.why).toEqual(['Forward Deployed Engineer', 'San Francisco, CA', 'New this week'])
    expect(out[1]!.why).toEqual(['Solutions Engineer', 'Remote', 'New this week'])
  })
  it('leaves out senior roles when asked, unless that is what they want', () => {
    const jobs = [
      job('Staff Solutions Engineer', 'NYC'),
      job('Solutions Engineer', 'NYC'),
      job('Senior Solutions Engineer', 'NYC'),
    ]
    expect(
      rank(jobs, SearchSchema.parse({ roles: ['Solutions Engineer'], skipSenior: true }), NOW),
    ).toHaveLength(1)
    // asking for a senior title keeps senior posts; staff and principal are still a step past it
    expect(
      rank(
        jobs,
        SearchSchema.parse({ roles: ['Senior Solutions Engineer'], skipSenior: true }),
        NOW,
      )
        .map((j) => j.title)
        .sort(),
    ).toEqual(['Senior Solutions Engineer', 'Solutions Engineer'])
    expect(rank(jobs, SearchSchema.parse({ roles: ['Solutions Engineer'] }), NOW)).toHaveLength(3)
  })
  it('suggests nothing without roles, and starts from the profile role', () => {
    expect(rank([job('Anything', 'SF')], SearchSchema.parse({}), NOW)).toEqual([])
    expect(defaultSearch('Forward Deployed Engineer').roles).toEqual(['Forward Deployed Engineer'])
    expect(defaultSearch('MBA candidate').roles).toEqual([])
    expect(defaultSearch(undefined).roles).toEqual([])
  })
  it('spreads suggestions across companies', () => {
    const list = ['a', 'a', 'a', 'a', 'b'].map((board) => ({ board }))
    expect(spread(list, 3).map((x) => x.board)).toEqual(['a', 'a', 'a', 'b'])
  })
})
