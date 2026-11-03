import { describe, expect, it } from 'vitest'
import { draftMessages, freshRound, openerFor } from '../../src/outreach/messages.ts'
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
    expect(m.email.subject).toBe("A 30-second film for Parcelpine's Operations Analyst team")
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
    expect(m.email.subject).toBe('A 30-second film for Acme')
    expect(m.email.body).toContain('I made a 30-second film for Acme:')
    expect(m.email.body).toContain('starts from your homepage')
  })
})

describe('what makes a cold email work', () => {
  it('opens with your detail, and checks length, subject, detail and ask', () => {
    const p = profile('candidate')
    const plain = draftMessages(out as never, p, 'https://share.example/f/x')
    expect(plain.checks).toMatchObject({ aboutThem: true, detail: false, oneAsk: true })
    const m = draftMessages(out as never, p, 'https://share.example/f/x', {
      detail: 'The one thing I kept hitting was losing a draft when my wifi dropped',
    })
    expect(m.email.body).toContain(
      "I've been using Parcelpine, and the one thing I kept hitting was losing a draft when my wifi dropped.",
    )
    expect(m.email.body).toContain('So I made a 30-second film')
    expect(m.checks.detail).toBe(true)
    expect(m.checks.short).toBe(m.checks.words <= 125)
  })

  it('brings something new to the follow-up when there is something', () => {
    const p = profile('candidate')
    const m = draftMessages(out as never, p, 'https://share.example/f/x', {
      fresh: 'Trusted by 4,000 shippers',
    })
    expect(m.followUp).toContain('your site says "Trusted by 4,000 shippers"')
    expect(m.followUp).not.toContain('Bumping')
  })
})

describe('two openers, to learn which gets replies', () => {
  it('splits films between the two by id, the same way every time', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `film_${i.toString(36)}x${i * 7}`)
    const proof = ids.filter((id) => openerFor(id) === 'proof').length
    expect(proof).toBeGreaterThan(60)
    expect(proof).toBeLessThan(140)
    expect(openerFor('abc')).toBe(openerFor('abc'))
  })

  it('leads with your best number, keeping the subject about them', () => {
    const p = profile('candidate')
    const m = draftMessages(out as never, p, 'https://share.example/f/x', { opener: 'proof' })
    expect(m.opener).toBe('proof')
    expect(m.email.subject).toBe('Parcelpine: 40% faster month-end close at Initech')
    expect(m.email.body).toContain(
      "40% faster month-end close at Initech. I made a 30-second film for your Operations Analyst role at Parcelpine on what I'd bring:",
    )
    // the number isn't said twice; the second one still comes after the film
    expect(m.email.body.match(/40% faster/g)).toHaveLength(1)
    expect(m.email.body).toContain('12 dashboards in daily use')
    expect(m.checks.aboutThem).toBe(true)
    expect(m.linkedin.length).toBeLessThanOrEqual(300)
    expect(m.linkedin).toContain('40% faster month-end close')
  })

  it('falls back to the film first when there is no number to lead with', () => {
    const m = draftMessages(
      { company: 'Acme', script: undefined } as never,
      profile('sales'),
      'https://share.example/f/y',
      { opener: 'proof' },
    )
    expect(m.opener).toBe('film')
    expect(m.email.subject).toBe('A 30-second film for Acme')
  })
})

describe('why now: a recent funding round', () => {
  it('congratulates them only while the round is news', () => {
    const now = Date.parse('2026-11-03')
    expect(freshRound({ date: '2026-09-01' }, now)).toBe(true)
    expect(freshRound({ date: '2026-01-01' }, now)).toBe(false)
    expect(freshRound(null, now)).toBe(false)
    const recent = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10)
    const m = draftMessages(out as never, profile('candidate'), 'https://share.example/f/x', {
      raised: { date: recent },
    })
    expect(m.whyNow).toBe(true)
    expect(m.email.body).toContain('Congratulations on the new funding round.')
  })
})
