import { describe, expect, it } from 'vitest'
import { isStat, quotable, tidy } from '../../src/brand/extract.ts'

// Every case here is text coldopen actually read from a real homepage.
describe('text from real homepages', () => {
  it('collapses text the page renders twice', () => {
    expect(
      tidy(
        'The product development system for teams and agents The product development system for teams and agents',
      ),
    ).toBe('The product development system for teams and agents')
    expect(tidy('Global GDP running on Stripe: 1.73958189% 1.73958189%')).toBe(
      'Global GDP running on Stripe: 1.73958189%',
    )
    expect(tidy('Where teams and agents Think together.')).toBe(
      'Where teams and agents Think together.',
    )
    expect(tidy('Very very fast')).toBe('Very very fast')
  })

  it('keeps real numbers as stats, not versions, years or 24/7', () => {
    for (const t of [
      'Linear powers over 40,000 product teams.',
      'Join 500,000+ teams already shipping with PostHog.',
      'Zapier serves over 100 million monthly website visits on Vercel.',
      'Global GDP running on Stripe: 1.73958189%',
      '31% lift in week-4 retention',
      '3x faster builds',
      '1,400+ shippers',
      '9 min average time to resolve a flagged exception',
      '1 day average setup time',
    ])
      expect(isStat(t), t).toBe(true)
    for (const t of [
      'Cal.com launches v6.9.5',
      'Keep work moving 24/7 with agents.',
      'Built for the future since 2019.',
      'Designed for the AI era.',
    ])
      expect(isStat(t), t).toBe(false)
  })

  it('drops UI chrome, code and chat prompts from product mockups', () => {
    for (const t of [
      'Render UI before vehicle_state sync when minimum required state is present.',
      'what are the three most important customer requests around permissions?',
      'Three issues ranked by customer impact:',
      'POWERING THE COMPANIES BUILDING THE FUTURE',
    ])
      expect(quotable(t), t).toBe(false)
    expect(quotable('Linear powers over 40,000 product teams.')).toBe(true)
  })
})
