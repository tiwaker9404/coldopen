import { describe, expect, it } from 'vitest'
import { SearchSchema } from '../../src/jobs/rank.ts'
import type { Startup } from '../../src/jobs/startups-build.ts'
import {
  hostOf,
  reachedThisWeek,
  type TargetInput,
  targetRoles,
  targets,
  weekStart,
} from '../../src/jobs/targets.ts'
import type { Profile } from '../../src/script/types.ts'
import { profile } from '../helpers/index.ts'

const NOW = Date.parse('2026-11-10T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()

const sender: Profile = {
  ...profile('candidate'),
  sender: { name: 'Alex Rivera', role: 'Forward deployed engineer', company: 'Initech' },
  skills: ['Python', 'Kubernetes'],
  schools: ['Duke University'],
}

const yc = (s: Partial<Startup> & Pick<Startup, 'n' | 's'>): Startup => ({
  b: 'W26',
  y: 2026,
  h: false,
  us: true,
  w: `https://${s.s}.example/`,
  ...s,
})

/** a 6-person YC startup in the sender's space (agents, pipelines), no opening today */
const ANCHOR = yc({
  n: 'Anchor',
  s: 'anchor',
  o: 'Evals and pipelines for production AI agents',
  t: 6,
})
/** a big company with a matching opening, nothing else in common */
const MEGA = yc({ n: 'Megacorp', s: 'megacorp', o: 'Payroll for enterprises', t: 900 })
/** a startup nothing links to the sender */
const BAKERY = yc({ n: 'Crumb', s: 'crumb', o: 'Point of sale for bakeries', t: 4 })
const EMPLOYER = yc({ n: 'Initech', s: 'initech', o: 'Agents that run Python pipelines', t: 12 })

const base = (over: Partial<TargetInput> = {}): TargetInput => ({
  profile: sender,
  search: SearchSchema.parse({ roles: ['Forward Deployed Engineer'] }),
  jobs: [
    {
      company: 'Megacorp',
      site: 'https://megacorp.example/',
      title: 'Forward Deployed Engineer, Payroll',
      posted: daysAgo(3),
      location: 'San Francisco, CA',
      remote: false,
    },
  ],
  startups: [ANCHOR, MEGA, BAKERY, EMPLOYER],
  raised: {},
  connections: [],
  films: [],
  hidden: [],
  ...over,
})

const names = (input: TargetInput) => targets(input, NOW).map((t) => t.company)
const of = (input: TargetInput, name: string) => targets(input, NOW).find((t) => t.company === name)

describe('companies worth a warm message this week', () => {
  it('ranks a small YC company in your space with no opening above a large one with an opening', () => {
    const list = targets(base(), NOW)
    expect(list.map((t) => t.company)).toEqual(['Anchor', 'Megacorp'])
    expect(list[0]!.score).toBeGreaterThan(list[1]!.score)
    expect(list[0]).toMatchObject({
      site: 'https://anchor.example/',
      oneLiner: 'Evals and pipelines for production AI agents',
      teamSize: 6,
      yc: { batch: 'W26', slug: 'anchor' },
    })
  })

  it('gives every company at least one reason, each one true of the data', () => {
    const input = base({
      raised: { 'anchor.example': { date: '2026-10-07', amount: 29_163_244 } },
      connections: [
        { name: 'Priya Shah', company: 'Anchor, Inc.' },
        { name: 'Ben Ortiz', company: 'Megacorp' },
        { name: 'Ana Lima', company: 'Megacorp' },
        { name: 'Sam Roe', company: 'Megacorp Inc' },
      ],
    })
    const anchor = of(input, 'Anchor')!
    expect(anchor.reasons).toEqual([
      '6 people, so the founders read their own email',
      'Raised $29M in October',
      'You know Priya there',
      'What they do mentions agents, evals and pipelines, all in your profile',
    ])
    const mega = of(input, 'Megacorp')!
    expect(mega.reasons).toEqual([
      'Posted a Forward Deployed Engineer role 3 days ago',
      'You know Ben and 2 others there',
    ])
    for (const t of targets(input, NOW)) expect(t.reasons.length).toBeGreaterThan(0)
  })

  it('says each reason in plain words: team sizes, an older opening, hiring fast, two people you know', () => {
    const mid = yc({ n: 'Midway', s: 'midway', o: 'Kubernetes for robots', t: 45 })
    const jobs = [
      // an opening that's been up a while still counts, with no "posted" timing
      {
        company: 'Midway',
        site: 'https://midway.example',
        title: 'Senior Forward Deployed Engineer (Remote)',
        posted: daysAgo(40),
        location: 'Remote',
        remote: true,
      },
      ...Array.from({ length: 6 }, (_, i) => ({
        company: 'Midway',
        site: 'https://midway.example',
        title: `Account Executive ${i}`,
        posted: daysAgo(i + 1),
        location: 'New York, NY',
        remote: false,
      })),
    ]
    const input = base({
      startups: [mid],
      jobs,
      connections: [
        { name: 'Priya Shah', company: 'Midway' },
        { name: 'Ben Ortiz', company: 'Midway' },
      ],
    })
    expect(of(input, 'Midway')!.reasons).toEqual([
      '45 people, so a note reaches the team that builds it',
      'You know Priya and Ben there',
      'Has a Senior Forward Deployed Engineer role open',
      'Added 6 roles in the last 30 days',
      'What they do mentions Kubernetes, all in your profile',
    ])
    // a one-person company, a role posted today and a small round
    const solo = yc({ n: 'Solo', s: 'solo', o: 'Python notebooks for agents', t: 1 })
    const today = base({
      startups: [solo],
      jobs: [
        {
          company: 'Solo',
          site: 'https://solo.example',
          title: 'Forward Deployed Engineer',
          posted: daysAgo(0.2),
          location: 'San Francisco, CA',
          remote: false,
        },
      ],
      raised: { 'solo.example': { date: '2026-09-01', amount: 400_000 } },
    })
    expect(of(today, 'Solo')!.reasons.slice(0, 3)).toEqual([
      '1 person, so the founders read their own email',
      'Posted a Forward Deployed Engineer role today',
      'Raised a round in September',
    ])
  })

  it('leaves out companies with nothing in common with you', () => {
    expect(names(base())).not.toContain('Crumb')
  })

  it('leaves out companies filmed or messaged in the last 60 days, and keeps older ones', () => {
    const film = (at: string, sentAt: string | null = null) => ({
      host: 'anchor.example',
      company: 'Anchor',
      at,
      sentAt,
    })
    expect(names(base({ films: [film(daysAgo(59))] }))).not.toContain('Anchor')
    // made long ago, but messaged lately
    expect(names(base({ films: [film(daysAgo(200), daysAgo(10))] }))).not.toContain('Anchor')
    expect(names(base({ films: [film(daysAgo(61))] }))).toContain('Anchor')
    // a film known only by the company's name counts too
    const byName = { host: null, company: 'Megacorp, Inc.', at: daysAgo(2), sentAt: null }
    expect(names(base({ films: [byName] }))).not.toContain('Megacorp')
  })

  it('leaves out the companies you hid', () => {
    expect(names(base({ hidden: ['https://www.anchor.example/about'] }))).toEqual(['Megacorp'])
    expect(names(base({ hidden: ['megacorp.example'] }))).toEqual(['Anchor'])
  })

  it('never lists your current employer, matched as a whole word', () => {
    expect(names(base())).not.toContain('Initech')
    // "Initech" inside another word is someone else
    const other = yc({ n: 'Initechnica', s: 'initechnica', o: 'Python agents', t: 5 })
    expect(names(base({ startups: [other] }))).toEqual(['Initechnica', 'Megacorp'])
  })

  it('wants the roles in your saved search first, then your profile role', () => {
    expect(targetRoles({ roles: ['Solutions Engineer'] }, sender)).toEqual([
      'Solutions Engineer',
      'Forward deployed engineer',
    ])
    expect(targetRoles({ roles: ['forward deployed engineer'] }, sender)).toEqual([
      'forward deployed engineer',
    ])
    // a Solutions Engineer opening matches the saved search's role
    const se = base({
      startups: [],
      jobs: [
        {
          company: 'Rampart',
          site: 'https://rampart.example',
          title: 'Solutions Engineer',
          posted: daysAgo(2),
          location: 'Remote (US)',
          remote: true,
        },
      ],
      search: SearchSchema.parse({ roles: ['Solutions Engineer'] }),
    })
    expect(of(se, 'Rampart')!.reasons).toEqual(['Posted a Solutions Engineer role 2 days ago'])
    // with no saved roles, the profile's role still finds a Forward Deployed Engineer opening
    expect(names(base({ search: SearchSchema.parse({}) }))).toContain('Megacorp')
  })

  it('counts a round only in the last 90 days, by the date `now` is pinned to', () => {
    const r = (date: string) => base({ raised: { 'anchor.example': { date } } })
    expect(of(r('2026-08-13'), 'Anchor')!.reasons).toContain('Raised a round in August')
    expect(of(r('2026-08-01'), 'Anchor')!.reasons.join()).not.toMatch(/Raised/)
    // the same data a year on: no longer recent
    expect(targets(r('2026-10-07'), NOW + 365 * 86_400_000)[0]!.reasons.join()).not.toMatch(
      /Raised/,
    )
  })

  it('counts a role as new for 14 days, then as open', () => {
    const at = (d: number) =>
      of(
        base({
          jobs: [{ ...base().jobs[0]!, posted: daysAgo(d) }],
        }),
        'Megacorp',
      )!.reasons[0]
    expect(at(14)).toBe('Posted a Forward Deployed Engineer role 14 days ago')
    expect(at(15)).toBe('Has a Forward Deployed Engineer role open')
  })

  it('quotes as much of the title as it takes to name the role, so the reason stays true', () => {
    const titled = (title: string) =>
      of(base({ jobs: [{ ...base().jobs[0]!, title }] }), 'Megacorp')!.reasons[0]
    expect(titled('Delivery Partner Manager, FDE')).toBe(
      'Posted a Delivery Partner Manager, FDE role 3 days ago',
    )
    expect(titled('Senior Forward Deployed Engineer, Platform (Remote)')).toBe(
      'Posted a Senior Forward Deployed Engineer role 3 days ago',
    )
  })

  it('leaves out startups outside the US unless the search is for anywhere', () => {
    const abroad = yc({ n: 'Fjord', s: 'fjord', o: 'Agents for pipelines', t: 3, us: false })
    expect(names(base({ startups: [abroad] }))).not.toContain('Fjord')
    expect(
      names(base({ startups: [abroad], search: SearchSchema.parse({ country: 'any' }) })),
    ).toContain('Fjord')
  })

  it('uses fit by meaning when it is on, and says so', () => {
    const quiet = yc({ n: 'Quiet', s: 'quiet', o: 'Helping hospitals reconcile claims', t: 8 })
    const off = base({ startups: [quiet], jobs: [] })
    expect(names(off)).toEqual([])
    const meaning = new Map([
      [
        'Helping hospitals reconcile claims',
        { score: 0.6, with: 'Turns messy customer data into working pipelines' },
      ],
    ])
    expect(of({ ...off, meaning }, 'Quiet')!.reasons).toEqual([
      '8 people, so the founders read their own email',
      'What they do is close to “Turns messy customer data into working pipelines”',
    ])
  })

  it('cuts to the top N, and the week starts on Monday in Pacific time', () => {
    expect(targets(base(), NOW, 1).map((t) => t.company)).toEqual(['Anchor'])
    // Tue 10 Nov 2026, 4am in Los Angeles → Mon 9 Nov, midnight PST
    expect(weekStart(NOW).toISOString()).toBe('2026-11-09T08:00:00.000Z')
    expect(hostOf('https://WWW.Anchor.example/x')).toBe('anchor.example')
    expect(hostOf('anchor.example')).toBe('anchor.example')
  })
})

describe('Network this week: x of 10', () => {
  const film = (host: string | null, at: string, sentAt: string | null = null, company = '') => ({
    host,
    company: company || null,
    at,
    sentAt,
  })

  it('starts the week Monday midnight in Los Angeles, not UTC, across daylight saving', () => {
    // Sun 8 Nov, 11pm Pacific is still last week, though it's already Monday in UTC
    expect(weekStart(Date.parse('2026-11-09T07:00:00Z')).toISOString()).toBe(
      '2026-11-02T08:00:00.000Z',
    )
    // a minute after midnight Monday Pacific is the new week
    expect(weekStart(Date.parse('2026-11-09T08:01:00Z')).toISOString()).toBe(
      '2026-11-09T08:00:00.000Z',
    )
    // summer: Monday midnight PDT is 07:00 UTC
    expect(weekStart(Date.parse('2026-07-15T12:00:00Z')).toISOString()).toBe(
      '2026-07-13T07:00:00.000Z',
    )
    // the week DST ends (Sun 1 Nov 2026) still starts at Monday 26 Oct, midnight PDT
    expect(weekStart(Date.parse('2026-11-01T20:00:00Z')).toISOString()).toBe(
      '2026-10-26T07:00:00.000Z',
    )
  })

  it('counts each company once, by a film made or a message marked sent this week', () => {
    // Wed 11 Nov 2026, 9am Pacific
    const now = Date.parse('2026-11-11T17:00:00Z')
    const n = reachedThisWeek(
      [
        // made this week, twice for the same company (an edit), with and without www
        film('https://www.anchor.example/about', '2026-11-09T18:00:00Z'),
        film('anchor.example', '2026-11-10T18:00:00Z'),
        // made last month, marked sent this week
        film('beacon.example', '2026-10-12T18:00:00Z', '2026-11-10T20:00:00Z'),
        // made and sent this week: still one company
        film('cobalt.example', '2026-11-09T09:00:00Z', '2026-11-09T10:00:00Z'),
        // Sunday 11pm Pacific: last week, though Monday in UTC
        film('dune.example', '2026-11-09T07:00:00Z'),
        // made and sent last week
        film('ember.example', '2026-11-03T18:00:00Z', '2026-11-04T18:00:00Z'),
        // no website yet, known by name
        film(null, '2026-11-10T18:00:00Z', null, 'Fjord Labs'),
      ],
      now,
    )
    expect(n).toBe(4) // anchor, beacon, cobalt, Fjord Labs
  })
})
