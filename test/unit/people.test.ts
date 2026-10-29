import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  companyKey,
  knownAt,
  managerFor,
  parseConnections,
  peopleSearches,
  sameCompany,
} from '../../src/outreach/people.ts'
import { profile } from '../helpers/index.ts'

/** LinkedIn's export: notes first, then the header, mostly blank emails */
const CONNECTIONS = readFileSync('fixtures/connections.csv', 'utf8')

describe('people to send a film to', () => {
  it('builds LinkedIn searches a person runs themselves', () => {
    const s = peopleSearches('Stripe', {
      jobTitle: 'Backend Engineer',
      profile: profile('candidate'),
    })
    expect(s.map((x) => x.label).slice(0, 3)).toEqual([
      'Recruiters',
      'Talent acquisition',
      'Hiring manager',
    ])
    expect(s[2]!.url).toContain(encodeURIComponent('engineering manager Stripe'))
    expect(
      s.every((x) => x.url.startsWith('https://www.linkedin.com/search/results/people/')),
    ).toBe(true)
  })

  it('guesses who a role reports to', () => {
    expect(managerFor('Senior Data Analyst, Growth')).toBe('head of data')
    expect(managerFor('Forward Deployed Engineer')).toBe('engineering manager')
    expect(managerFor('Founding Account Executive')).toBe('head of sales')
    expect(managerFor(undefined)).toBeNull()
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
