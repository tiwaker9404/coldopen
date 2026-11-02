import { describe, expect, it } from 'vitest'
import { open, seal } from '../../src/api/keys.ts'
import { domainOf, guesses, splitName } from '../../src/outreach/email.ts'
import { addressed, draftMessages } from '../../src/outreach/messages.ts'
import { sharePage } from '../../src/share/page.ts'
import { profile } from '../helpers/index.ts'

describe('finding an address', () => {
  it('reads names and domains the way people write them', () => {
    expect(splitName('Priya K. Shah')).toEqual({ first: 'priya', last: 'shah' })
    expect(splitName('José Núñez (he/him)')).toEqual({ first: 'jose', last: 'nunez' })
    expect(splitName('Madonna')).toEqual({ first: 'madonna', last: '' })
    expect(splitName('  ')).toBeNull()
    expect(domainOf('https://www.sierra.ai/about')).toBe('sierra.ai')
    expect(domainOf('ramp.com')).toBe('ramp.com')
  })
  it('guesses the common patterns, most likely first', () => {
    expect(guesses('Priya Shah', 'sierra.ai').map((g) => g.email)).toEqual([
      'priya@sierra.ai',
      'priya.shah@sierra.ai',
      'pshah@sierra.ai',
      'priyashah@sierra.ai',
      'priya_shah@sierra.ai',
    ])
    expect(guesses('Priya Shah', 'sierra.ai').every((g) => g.source === 'guess')).toBe(true)
  })
})

describe('keys', () => {
  it('seals and opens with the same secret only', () => {
    const sealed = seal('s'.repeat(32), 'hunter-key-1234')
    expect(sealed).not.toContain('hunter')
    expect(open('s'.repeat(32), sealed)).toBe('hunter-key-1234')
    expect(open('t'.repeat(32), sealed)).toBeNull()
  })
})

describe('messages', () => {
  const m = draftMessages(
    {
      company: 'Sierra',
      job: { title: 'Forward Deployed Engineer' },
      highlights: null,
      script: null,
    } as never,
    profile('candidate'),
    'https://f.example/x',
  )
  it('writes an intro request for someone you know there', () => {
    expect(m.intro).toContain('Forward Deployed Engineer role at Sierra')
    expect(m.intro).toContain('https://f.example/x')
    expect(m.intro).toMatch(/passing it to the hiring manager/)
  })
  it('greets the person it is for, everywhere but the intro', () => {
    const a = addressed(m, 'Priya Shah')
    for (const t of [a.email.body, a.linkedin, a.followUp, a.lastNote, a.linkedinFollowUp])
      expect(t).not.toContain('[First name]')
    expect(a.email.body.startsWith('Hi Priya,')).toBe(true)
    expect(a.intro).toContain('[First name]')
    expect(addressed(m, undefined)).toBe(m)
  })
})

describe('share page button', () => {
  const view = {
    company: 'Sierra',
    format: 'square' as const,
    from: 'Alex Rivera',
    firstName: 'Alex',
    ctaLine: 'Could we talk this week?',
    contact: 'alex@example.com',
    film: 'film-square.mp4',
  }
  it('offers a booking link first when the profile has one, and counts presses', () => {
    const html = sharePage(
      { ...view, book: 'https://cal.com/alex/15min' },
      'https://s.example/f/x',
      '/v',
    )
    expect(html).toContain(
      'href="https://cal.com/alex/15min" target="_blank" rel="noopener">Book 15 minutes',
    )
    expect(html).toContain('href="mailto:alex@example.com">Reply</a>')
    expect(html).toContain("send('click')")
  })
  it('keeps the reply button alone without one', () => {
    const html = sharePage(view, 'https://s.example/f/x')
    expect(html).toContain('Reply to Alex')
    expect(html).not.toContain('Book 15 minutes')
  })
})
