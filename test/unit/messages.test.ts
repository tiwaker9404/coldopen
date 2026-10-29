import { describe, expect, it } from 'vitest'
import { draftMessages } from '../../src/outreach/messages.ts'
import { profile } from '../helpers/index.ts'

const out = {
  company: 'Parcelpine',
  job: { title: 'Operations Analyst', url: 'https://jobs.lever.co/parcelpine/1' },
  highlights: {
    quote: {
      text: 'Experience building dashboards that operations teams use every day',
      source: 'your Operations Analyst post',
    },
    proof: [
      { value: '40%', label: 'faster month-end close', where: 'Initech' },
      { value: '12', label: 'dashboards in daily use' },
      { value: '3', label: 'not shown' },
    ],
  },
  script: {
    hook: 'h',
    noticed: 'n',
    insight: { factId: 'j1', why: 'w' },
    pitch: { headline: 'Why I fit your Operations Analyst role', points: ['a', 'b'] },
    proof: [0],
    cta: 'c',
  },
}

describe('the messages that go with a film', () => {
  it('quotes the post and the proof the film shows, and nothing else', () => {
    const p = profile('candidate')
    const m = draftMessages(out as never, p, 'https://share.example/f/x')
    expect(m.email.subject).toBe('A 30-second film I made for Parcelpine (Operations Analyst)')
    expect(m.email.body).toContain(
      'I made a 30-second film for your Operations Analyst role at Parcelpine:\nhttps://share.example/f/x',
    )
    expect(m.email.body).toContain(
      '"Experience building dashboards that operations teams use every day"',
    )
    expect(m.email.body).toContain(
      '40% faster month-end close at Initech; 12 dashboards in daily use',
    )
    expect(m.email.body).not.toContain('not shown')
    // a headline that only restates the role isn't worth a line
    expect(m.email.body).not.toMatch(/Why I fit/)
    expect(m.email.body.trimEnd().endsWith(p.cta.contact)).toBe(true)
    expect(m.linkedin.length).toBeLessThanOrEqual(300)
    expect(m.linkedin).toContain('https://share.example/f/x')
    expect(m.followUp).toContain('Bumping this')
  })

  it('works without a job or highlights', () => {
    const m = draftMessages(
      { company: 'Acme', script: undefined } as never,
      profile('sales'),
      'https://share.example/f/y',
    )
    expect(m.email.subject).toBe('A 30-second film I made for Acme')
    expect(m.email.body).toContain('I made a 30-second film for Acme:')
    expect(m.email.body).toContain('starts from your homepage')
  })
})
