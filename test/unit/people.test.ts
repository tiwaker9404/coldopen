import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { openGroup, peopleGroups } from '../../dashboard/src/peopleTabs.ts'
import { targetRoles } from '../../src/jobs/targets.ts'
import {
  companyKey,
  flatSearches,
  knownAt,
  managerFor,
  type PeopleGroup,
  parseConnections,
  peopleSearches,
  sameCompany,
  sizeOf,
} from '../../src/outreach/people.ts'
import { profile } from '../helpers/index.ts'

/** LinkedIn's export: notes first, then the header, mostly blank emails */
const CONNECTIONS = readFileSync('fixtures/connections.csv', 'utf8')

const labels = (gs: PeopleGroup[]) => gs.map((g) => g.label)
const urls = (gs: PeopleGroup[]) => flatSearches(gs).map((s) => decodeURIComponent(s.url))

describe('people to send a film to', () => {
  it('builds LinkedIn searches a person runs themselves, in groups that say why and what to ask', () => {
    const gs = peopleSearches('Stripe', {
      jobTitle: 'Backend Engineer',
      profile: profile('candidate'),
    })
    // no team size known: treated as a big company, so warm paths and the manager go first
    expect(labels(gs)).toEqual(['Hiring manager', 'People doing the job', 'Recruiting', 'Founders'])
    expect(gs[0]!.searches[0]!.url).toContain(encodeURIComponent('engineering manager Stripe'))
    for (const g of gs) {
      expect(g.why.length).toBeGreaterThan(10)
      expect(g.ask.length).toBeGreaterThan(10)
    }
    expect(
      flatSearches(gs).every((x) =>
        x.url.startsWith('https://www.linkedin.com/search/results/people/'),
      ),
    ).toBe(true)
  })

  it('orders groups by company size', () => {
    const p = { ...profile('candidate'), schools: ['Duke University'] }
    const at = (team: number | null) =>
      peopleSearches('Acme', { jobTitle: 'Forward Deployed Engineer', profile: p, team }).map(
        (g) => g.id,
      )
    // a 2-person startup opens on its founders, and has no hiring manager to find
    expect(at(2)).toEqual(['founders', 'warm', 'doing', 'recruiting'])
    expect(at(19)[0]).toBe('founders')
    expect(at(20)).toEqual(['warm', 'manager', 'founders', 'doing', 'recruiting'])
    expect(at(200)[0]).toBe('warm')
    // a 500-person company, or one whose size isn't known, opens on warm paths
    expect(at(500)).toEqual(['warm', 'manager', 'doing', 'recruiting', 'founders'])
    expect(at(null)).toEqual(at(500))
    expect(peopleSearches('Acme', { team: 2, yc: { batch: 'W24', slug: 'acme' } })[0]!.why).toMatch(
      /At 2 people the founders read their own email/,
    )
  })

  it('merges recruiters and talent into one group', () => {
    const gs = peopleSearches('Acme', { jobTitle: 'Software Engineer', team: 30 })
    const recruiting = gs.filter((g) => g.id === 'recruiting')
    expect(recruiting).toHaveLength(1)
    expect(recruiting[0]!.searches.map((s) => s.label)).toEqual([
      'Recruiters',
      'Talent acquisition',
      'Talent partners',
      'Sourcers',
      'Head of people',
    ])
    expect(labels(gs)).not.toContain('Talent acquisition')
    // no search appears twice, in any group
    const all = flatSearches(gs).map((s) => s.url)
    expect(new Set(all).size).toBe(all.length)
    // a recruiting role's manager is the head of people: it isn't searched a second time
    const hr = flatSearches(peopleSearches('Acme', { jobTitle: 'Recruiter', team: 30 }))
    expect(
      hr.filter((s) => s.url.includes(encodeURIComponent('head of people Acme'))),
    ).toHaveLength(1)
    // at 50 people or more, the head of people isn't in recruiting
    expect(
      peopleSearches('Acme', { team: 80 })
        .find((g) => g.id === 'recruiting')!
        .searches.some((s) => s.label === 'Head of people'),
    ).toBe(false)
  })

  it('founders for a non-YC company', () => {
    const founders = peopleSearches('Parcelpine').find((g) => g.id === 'founders')!
    expect(founders.searches.map((s) => decodeURIComponent(s.url))).toEqual([
      expect.stringContaining('keywords=founder Parcelpine'),
      expect.stringContaining('keywords=CEO Parcelpine'),
      expect.stringContaining('keywords=CTO Parcelpine'),
    ])
    expect(founders.ask).toBe('What they’re building next and what’s hard about it.')
  })

  it('finds people doing the job by the titles that kind of work goes by, and new grads', () => {
    const doing = (title: string) =>
      peopleSearches('Acme', { jobTitle: title })
        .find((g) => g.id === 'doing')!
        .searches.map((s) => s.label)
    expect(doing('Senior Forward Deployed Engineer, Platform')).toEqual([
      'Forward deployed engineers',
      'Solutions engineers',
      'Customer engineers',
      'New grads',
    ])
    expect(doing('Solutions Engineer')[0]).toBe('Forward deployed engineers')
    expect(doing('Backend Engineer (Remote)')).toEqual(['Software engineers', 'New grads'])
    expect(doing('GTM Engineer')).toEqual([
      'GTM engineers',
      'Account executives',
      'Growth team',
      'New grads',
    ])
    expect(doing('Senior Data Analyst, Growth')).toEqual(['Data analysts', 'New grads'])
    // with no job, a job seeker's own role says what the job is
    const own = peopleSearches('Acme', { profile: profile('candidate') })
    expect(urls(own)).toContain(
      'https://www.linkedin.com/search/results/people/?keywords=forward deployed engineer Acme&origin=GLOBAL_SEARCH_HEADER',
    )
  })

  it('with no job link, looks for people doing the roles in your saved job search before your profile role', () => {
    const p = profile('candidate') // sender.role is "Forward deployed engineer"
    const labels = (roles?: string[]) =>
      peopleSearches('Acme', { profile: p, roles })
        .find((g) => g.id === 'doing')!
        .searches.map((s) => s.label)
    // the saved search's roles, from targetRoles(): search first, then the profile's role
    const roles = targetRoles({ roles: ['Data Analyst', 'GTM Engineer'] }, p)
    expect(roles).toEqual(['Data Analyst', 'GTM Engineer', 'Forward deployed engineer'])
    expect(labels(roles)).toEqual([
      'Data analysts',
      'GTM engineers',
      'Account executives',
      'Growth team',
      'New grads',
    ])
    // nothing saved: the profile's role, as before
    expect(labels(targetRoles({ roles: [] }, p))).toEqual(labels(undefined))
    expect(labels(undefined)[0]).toBe('Forward deployed engineers')
    // a job link still wins over both
    const withJob = peopleSearches('Acme', { profile: p, roles, jobTitle: 'Backend Engineer' })
      .find((g) => g.id === 'doing')!
      .searches.map((s) => s.label)
    expect(withJob).toEqual(['Software engineers', 'New grads'])
  })

  it('adds warm paths: alumni of your schools, people from your past employers, and people you know', () => {
    const p = {
      ...profile('candidate'),
      sender: { name: 'Sam', company: 'Current Co' },
      schools: ['Duke University'],
      proof: [
        { value: '40%', label: 'faster close', where: 'Rail Inc.' },
        { value: '3', label: 'launches', where: 'Current Co' },
      ],
    }
    const known = knownAt(parseConnections(CONNECTIONS), 'Stripe', 'stripe.com', 'Backend Engineer')
    const warm = peopleSearches('Stripe', { jobTitle: 'Backend Engineer', profile: p, known }).find(
      (g) => g.id === 'warm',
    )!
    expect(warm.searches.map((s) => s.label)).toEqual([
      'Duke University alumni',
      'Rail Inc. people',
    ])
    expect(warm.searches[0]!.url).toContain(encodeURIComponent('"Duke University" Stripe'))
    expect(warm.known!.map((c) => c.name)).toEqual(['Priya Shah', 'Ben Ortiz', 'Ana Lima'])
    expect(warm.ask).toBe('How they found it there; they answer people like them.')
  })

  it('never searches the current employer', () => {
    const p = {
      ...profile('candidate'),
      sender: { name: 'Sam', company: 'Initech', role: 'Initech solutions engineer' },
      schools: ['Initech University', 'Duke University'],
      proof: [{ value: '3', label: 'launches', where: 'Initech' }],
    }
    for (const team of [3, 60, 900, null]) {
      const all = urls(peopleSearches('Stripe', { jobTitle: 'Backend Engineer', profile: p, team }))
      expect(all.length).toBeGreaterThan(5)
      expect(all.some((u) => /initech/i.test(u))).toBe(false)
    }
    // a film for the current employer itself searches nothing there
    expect(peopleSearches('Initech', { profile: p })).toEqual([])
    // a word that only contains the name isn't the employer
    expect(urls(peopleSearches('Initechnology', { profile: p })).length).toBeGreaterThan(0)
  })

  it('leaves out empty groups', () => {
    // no job, no role, no schools, no one known: founders and recruiting only
    const gs = peopleSearches('Acme', { team: 500 })
    expect(gs.map((g) => g.id)).toEqual(['recruiting', 'founders'])
    expect(gs.every((g) => g.searches.length > 0)).toBe(true)
    // people you know there keep warm paths in, even with no searches of its own
    const known = parseConnections(CONNECTIONS).slice(0, 1)
    const warm = peopleSearches('Stripe', { known }).find((g) => g.id === 'warm')!
    expect(warm.searches).toEqual([])
    expect(warm.known).toHaveLength(1)
  })

  it('keeps a seller’s decision makers with the founders', () => {
    const gs = peopleSearches('Acme', { profile: profile('sales') })
    expect(gs.find((g) => g.id === 'founders')!.searches.map((s) => s.label)).toContain(
      'Decision makers',
    )
  })

  it('guesses who a role reports to', () => {
    expect(managerFor('Senior Data Analyst, Growth')).toBe('head of data')
    expect(managerFor('Forward Deployed Engineer')).toBe('engineering manager')
    expect(managerFor('Founding Account Executive')).toBe('head of sales')
    expect(managerFor(undefined)).toBeNull()
  })

  it('sorts team sizes into under 20, 20 to 200, and bigger or unknown', () => {
    expect([1, 19, 20, 200, 201, null, 0].map(sizeOf)).toEqual([
      'small',
      'small',
      'mid',
      'mid',
      'large',
      'large',
      'large',
    ])
  })
})

describe('the film panel’s people tabs', () => {
  it('opens on the first group, keeps a picked one, and shows an old flat answer as one group', () => {
    const gs = peopleSearches('Acme', { team: 2 })
    expect(openGroup(gs, null)).toBe('founders')
    expect(openGroup(gs, 'recruiting')).toBe('recruiting')
    expect(openGroup(gs, 'manager')).toBe('founders')
    const old = peopleGroups({ searches: flatSearches(gs), known: [] })
    expect(old).toHaveLength(1)
    expect(old[0]!.searches).toHaveLength(flatSearches(gs).length)
    expect(peopleGroups({ groups: gs, searches: [], known: [] })).toBe(gs)
    expect(peopleGroups({ searches: [], known: [] })).toEqual([])
  })
})

describe('people you already know there', () => {
  it('reads the export, drops emails, and keeps only real profile links', () => {
    const list = parseConnections(CONNECTIONS)
    expect(list).toHaveLength(5)
    expect(list[0]).toEqual({
      name: 'Priya Shah',
      url: 'https://www.linkedin.com/in/priyashah',
      company: 'Stripe, Inc.',
      position: 'Technical Recruiter',
      connectedOn: '12 Mar 2025',
    })
    expect(JSON.stringify(list)).not.toContain('ben@example.com')
    expect(list[4]).toMatchObject({ name: 'Jo O"Neil', url: null })
    expect(() => parseConnections('name,email\na,b')).toThrow(/Connections\.csv/)
  })

  it('matches company names the way people write them', () => {
    expect(companyKey('Stripe, Inc.')).toBe('stripe')
    expect(companyKey('https://www.stripe.com/')).toBe('stripe')
    expect(companyKey('Scale AI')).toBe('scale')
    expect(sameCompany('google', 'Google DeepMind')).toBe(true)
    expect(sameCompany('stripe', 'Stripes Media')).toBe(false)
    expect(sameCompany('meta', 'Meta')).toBe(true)
  })

  it('puts recruiters, then the likely manager, first', () => {
    const known = knownAt(parseConnections(CONNECTIONS), 'Stripe', 'stripe.com', 'Backend Engineer')
    expect(known.map((c) => c.name)).toEqual(['Priya Shah', 'Ben Ortiz', 'Ana Lima'])
  })
})
