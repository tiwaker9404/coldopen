import { describe, expect, it } from 'vitest'
import { claimsColdopen, forSender, makerClaims } from '../../src/profile/maker.ts'

describe('who can say they built coldopen', () => {
  const coldopen = {
    name: 'coldopen',
    url: 'https://tiwaker9404.github.io/coldopen/',
    line: 'Films',
  }
  const mine = { name: 'shipkit', url: 'https://shipkit.example', line: 'A kit I wrote' }

  it('knows coldopen by name or by any of its links', () => {
    for (const t of [
      'coldopen',
      'Cold Open',
      'https://github.com/tiwaker9404/coldopen',
      'https://tiwaker9404.github.io/coldopen/',
      'https://coldopen-nk8o.onrender.com/',
    ])
      expect(claimsColdopen(t), t).toBe(true)
    for (const t of ['shipkit', 'https://github.com/someone/coldopenings-not', undefined])
      expect(claimsColdopen(t), String(t)).toBe(false)
  })

  it('points at each field that claims it', () => {
    expect(
      makerClaims({ creator: coldopen, projects: [mine, { ...coldopen, name: 'films' }] }),
    ).toEqual(['creator.name', 'projects.1.name'])
    expect(makerClaims({ creator: mine, projects: [mine] })).toEqual([])
  })

  it('takes the claim out for anyone but the maker, and keeps what they built', () => {
    const p = { creator: coldopen, projects: [mine, coldopen], offer: 'x' }
    expect(forSender(p, true)).toBe(p)
    expect(forSender(p, false)).toEqual({ projects: [mine], offer: 'x' })
    const own = { creator: mine, offer: 'x' }
    expect(forSender(own, false)).toBe(own)
  })
})
