import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BrandKit } from '../../src/brand/types.ts'
import { rankProfiles } from '../../src/profile/match.ts'
import type { Profile } from '../../src/script/types.ts'

const load = (file: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, '../../profiles', file), 'utf8')) as Profile
// one person with several résumés: the shipped examples stand in for them
const profiles = [
  { id: 'analyst', profile: load('examples/data-analyst.json') },
  { id: 'engineer', profile: load('candidate.example.json') },
  { id: 'pm', profile: load('examples/product-manager.json') },
  { id: 'recruiter', profile: load('examples/recruiter.json') },
]

const site = (name: string, words: string): BrandKit =>
  ({
    name,
    title: name,
    description: words,
    headline: words.split('.')[0],
    subheads: [],
    nav: [],
    facts: words.split('. ').map((text, i) => ({ id: `f${i + 1}`, text, kind: 'claim' })),
  }) as unknown as BrandKit

describe('matching a company to the right profile', () => {
  it('suggests the analyst profile for a finance and strategy firm', () => {
    const r = rankProfiles(
      site(
        'Meridian Advisory',
        'Strategy consulting for capital markets. Transactions, risk and financial insights. Research on the global economy. Advisory for banking and investment teams',
      ),
      profiles,
    )
    expect(r[0]!.id).toBe('analyst')
    expect(r[0]!.reasons).toEqual(expect.arrayContaining(['strategy', 'consulting']))
  })

  it('suggests the engineer profile for a developer platform', () => {
    const r = rankProfiles(
      site(
        'Stackline',
        'The API platform for developers. Deploy agents with our SDK. Read the docs, star us on GitHub, ship to production. Evals and infrastructure built for scale',
      ),
      profiles,
    )
    expect(r[0]!.id).toBe('engineer')
  })

  it('suggests the product profile for a product-led app', () => {
    const r = rankProfiles(
      site(
        'Taskwell',
        'The workflow app product teams love. Plan your roadmap, launch faster and design a better user experience. Collaboration for every team',
      ),
      profiles,
    )
    expect(r[0]!.id).toBe('pm')
  })

  it('explains every score with words from the site', () => {
    const kit = site(
      'Hireloop',
      'Hire engineers faster. Sourcing, pipeline and candidate experience for recruiting teams',
    )
    for (const m of rankProfiles(kit, profiles))
      for (const w of m.reasons) expect(JSON.stringify(kit).toLowerCase()).toContain(w)
  })
})
