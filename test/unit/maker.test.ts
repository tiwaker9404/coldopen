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

  it('catches a claim to have built this film or its tool, under any name', () => {
    for (const t of [
      'I built the tool that made this film',
      'I made the tool that made this video',
      'Built the tool that made this reel, on weekends',
      "I built the tool you're watching",
      'I built this film you’re watching',
      'I built this app that made it',
      'Made with FilmTool, which I built',
      'made with my own renderer which I built',
    ])
      expect(claimsColdopen(t), t).toBe(true)
  })

  it('lets ordinary lines about something they built through', () => {
    for (const t of [
      'I built a Slack bot for standups',
      'A CLI that diffs Terraform plans and explains them',
      'Built the tool our support team uses to triage tickets',
      'Made with React and Postgres',
      'A film-festival scheduler I wrote for my college club',
    ])
      expect(claimsColdopen(t), t).toBe(false)
  })

  it('points at each field that claims it', () => {
    expect(
      makerClaims({ creator: coldopen, projects: [mine, { ...coldopen, name: 'films' }] }),
    ).toEqual(['creator.name', 'projects.1.name'])
    expect(makerClaims({ creator: mine, projects: [mine] })).toEqual([])
    // a claim in the line alone points at the line
    const reworded = {
      name: 'FilmTool',
      url: 'https://filmtool.example',
      line: 'I built the tool that made this film',
    }
    expect(makerClaims({ creator: reworded })).toEqual(['creator.line'])
    expect(forSender({ creator: reworded, offer: 'x' }, false)).toEqual({ offer: 'x' })
  })

  it('takes the claim out for anyone but the maker, and keeps what they built', () => {
    const p = { creator: coldopen, projects: [mine, coldopen], offer: 'x' }
    expect(forSender(p, true)).toBe(p)
    expect(forSender(p, false)).toEqual({ projects: [mine], offer: 'x' })
    const own = { creator: mine, offer: 'x' }
    expect(forSender(own, false)).toBe(own)
  })
})
