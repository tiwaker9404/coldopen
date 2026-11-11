import { describe, expect, it } from 'vitest'
import type { Job } from '../../src/jobs/boards.ts'
import { SearchSchema } from '../../src/jobs/rank.ts'
import { momentum } from '../../src/jobs/service.ts'
import { searchStartups, startupOf } from '../../src/jobs/startups.ts'
import { mentions, shortBatch, tokensFor, trusted } from '../../src/jobs/yc-build.ts'
import { peopleSearches } from '../../src/outreach/people.ts'

const NOW = Date.parse('2026-11-02T12:00:00Z')
const job = (board: string, title: string, daysAgo: number, location = 'SF'): Job => ({
  id: `${board}:${title}:${daysAgo}`,
  board,
  company: board,
  title,
  url: 'https://example.com/j',
  location,
  remote: false,
  posted: new Date(NOW - daysAgo * 86_400_000).toISOString(),
})

describe('YC boards', () => {
  it('shortens batches the way YC does', () => {
    expect(shortBatch('Winter 2024')).toBe('W24')
    expect(shortBatch('Summer 2023')).toBe('S23')
    expect(shortBatch('Spring 2025')).toBe('X25')
    expect(shortBatch('Fall 2024')).toBe('F24')
    expect(shortBatch(undefined)).toBe('')
  })

  it('tries the slug, its squashed form, the name and the domain', () => {
    expect(
      tokensFor({ name: 'Acme Labs', slug: 'acme-labs', website: 'https://www.getacme.com' }),
    ).toEqual(['acme-labs', 'acmelabs', 'getacme'])
    expect(tokensFor({ name: 'Zo', slug: 'zo', website: '' })).toEqual([])
  })
})

describe('board ownership', () => {
  it('needs the board page to link to the company website', () => {
    expect(mentions('<a href="https://www.getacme.com">Acme</a>', 'https://getacme.com/')).toBe(
      true,
    )
    expect(mentions('<a href="https://hive.com">Hive</a>', 'https://thehive.ai')).toBe(false)
    expect(mentions('anything', undefined)).toBe(false)
  })

  it('trusts distinctive YC names and jobs on the company domain', () => {
    const c = { slug: 'instacart', website: 'https://www.instacart.com' }
    expect(trusted('instacart', c, [])).toBe(true)
    expect(trusted('hive', { slug: 'hive', website: 'https://hive.co' }, [])).toBe(false)
    expect(
      trusted('hive', { slug: 'hive', website: 'https://hive.co' }, [
        { url: 'https://careers.hive.co/jobs/1' },
      ]),
    ).toBe(true)
  })
})

describe('hiring momentum', () => {
  it('counts open roles once each, and the ones posted in 30 days', () => {
    const m = momentum(
      [
        job('ashby:a', 'Engineer', 3),
        job('ashby:a', 'Engineer', 3), // same post twice
        job('ashby:a', 'Designer', 20),
        job('ashby:a', 'PM', 90),
        job('ashby:b', 'Engineer', 200),
      ],
      NOW,
    )
    expect(m.get('ashby:a')).toEqual({ open: 3, recent: 2 })
    expect(m.get('ashby:b')).toEqual({ open: 1, recent: 0 })
  })

  it('defaults the new search options so saved searches still parse', () => {
    const s = SearchSchema.parse({ roles: ['Solutions Engineer'] })
    expect(s.ycOnly).toBe(false)
    expect(s.sort).toBe('best')
  })
})

describe('founder searches', () => {
  it('puts the YC page first, then the founders on LinkedIn, for a YC company', () => {
    const f = peopleSearches('Acme', { yc: { batch: 'W24', slug: 'acme' } }).find(
      (g) => g.id === 'founders',
    )!
    expect(f.searches[0]).toMatchObject({
      label: 'YC page',
      url: 'https://www.ycombinator.com/companies/acme',
    })
    expect(f.searches[1]!.label).toBe('Founders')
    expect(f.searches[1]!.url).toContain(encodeURIComponent('founder Acme'))
  })

  it('leaves the YC page out for other companies', () => {
    const f = peopleSearches('Acme').find((g) => g.id === 'founders')!
    expect(f.searches.some((p) => p.url.includes('ycombinator.com'))).toBe(false)
  })

  it('knows a YC company’s team size from its website, hiring or not', () => {
    const one = searchStartups({ limit: 50 }).data.find((x) => x.website)!
    const s = startupOf({ site: one.website })
    expect(s).toMatchObject({ slug: one.slug, batch: one.batch, team: one.team })
    expect(startupOf({ slug: one.slug })?.slug).toBe(one.slug)
    expect(startupOf({ site: 'https://not-a-yc-company.example/' })).toBeNull()
  })
})
