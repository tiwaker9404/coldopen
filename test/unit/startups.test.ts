import { describe, expect, it } from 'vitest'
import { searchStartups } from '../../src/jobs/startups.ts'
import { toStartup } from '../../src/jobs/startups-build.ts'

describe('YC startups to reach out to', () => {
  it('keeps active companies, with their batch and US presence', () => {
    expect(
      toStartup({
        name: 'Acme',
        slug: 'acme',
        website: 'http://acme.dev',
        batch: 'Summer 2025',
        status: 'Active',
        isHiring: false,
        industry: 'B2B',
        subindustry: 'B2B -> Analytics',
        regions: ['United States of America'],
        team_size: 4,
      }),
    ).toEqual({
      n: 'Acme',
      s: 'acme',
      w: 'https://acme.dev/',
      b: 'S25',
      y: 2025.5,
      t: 4,
      i: 'B2B',
      u: 'Analytics',
      h: false,
      us: true,
    })
    expect(toStartup({ name: 'Gone', slug: 'gone', status: 'Inactive' })).toBeNull()
  })

  it('searches the directory: newest first, with filters', () => {
    const all = searchStartups({ us: true, limit: 5 })
    expect(all.total).toBeGreaterThan(1000)
    expect(all.data).toHaveLength(5)
    const quiet = searchStartups({ hiring: 'quiet', since: 2025, maxTeam: 10, limit: 60 })
    expect(quiet.data.every((s) => !s.hiring && (s.team ?? 0) <= 10)).toBe(true)
    expect(quiet.data[0]!.yc).toMatch(/^https:\/\/www\.ycombinator\.com\/companies\//)
  })
})
