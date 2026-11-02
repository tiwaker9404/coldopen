import { describe, expect, it } from 'vitest'
import type { Job } from '../../src/jobs/boards.ts'
import { SearchSchema } from '../../src/jobs/rank.ts'
import { momentum } from '../../src/jobs/service.ts'
import { shortBatch, tokensFor } from '../../src/jobs/yc-build.ts'
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
  it('puts the YC page and founders first for a YC company', () => {
    const s = peopleSearches('Acme', { yc: { batch: 'W24', slug: 'acme' } })
    expect(s[0]).toMatchObject({
      label: 'Founders',
      url: 'https://www.ycombinator.com/companies/acme',
    })
    expect(s[1]!.label).toBe('Founders on LinkedIn')
    expect(s[1]!.url).toContain(encodeURIComponent('founder Acme'))
  })

  it('leaves the YC founder links out for other companies', () => {
    expect(peopleSearches('Acme').some((p) => p.label === 'Founders')).toBe(false)
  })
})
