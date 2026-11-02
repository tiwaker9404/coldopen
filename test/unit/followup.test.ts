import { describe, expect, it } from 'vitest'
import { followedUp, nextStep, type Outreach } from '../../src/outreach/followup.ts'
import { draftMessages } from '../../src/outreach/messages.ts'
import { profile } from '../helpers/index.ts'

const DAY = 86_400_000
const T0 = Date.parse('2026-11-01T17:00:00Z')
const sent: Outreach = {
  status: 'sent',
  at: new Date(T0).toISOString(),
  sentAt: new Date(T0).toISOString(),
}

describe('follow-ups', () => {
  it('nudges after 4 days, sends a last note a week later, then says to call it', () => {
    expect(nextStep(sent, T0 + 3 * DAY)).toMatchObject({ kind: 'follow_up', step: 1, due: false })
    expect(nextStep(sent, T0 + 4 * DAY)).toMatchObject({ kind: 'follow_up', step: 1, due: true })
    const one = followedUp(sent, new Date(T0 + 5 * DAY))
    expect(nextStep(one, T0 + 11 * DAY)).toMatchObject({ kind: 'follow_up', step: 2, due: false })
    expect(nextStep(one, T0 + 12 * DAY)).toMatchObject({ kind: 'follow_up', step: 2, due: true })
    const two = followedUp(one, new Date(T0 + 12 * DAY))
    expect(nextStep(two, T0 + 19 * DAY)).toMatchObject({ kind: 'close', step: null, due: true })
  })
  it('has nothing to do once they answered', () => {
    for (const status of ['replied', 'interview', 'no_reply'] as const)
      expect(nextStep({ ...sent, status }, T0 + 30 * DAY)).toBeNull()
    expect(nextStep(null)).toBeNull()
  })
  it('writes a short last note and a LinkedIn follow-up that fits', () => {
    const m = draftMessages(
      {
        company: 'Acme',
        job: { title: 'Solutions Engineer' },
        highlights: null,
        script: null,
      } as never,
      profile('candidate'),
      'https://f.example/x',
    )
    expect(m.lastNote).toContain(
      'One last note on the film I made for your Solutions Engineer role at Acme',
    )
    expect(m.lastNote).toContain('https://f.example/x')
    expect(m.linkedinFollowUp.length).toBeLessThanOrEqual(300)
    expect(m.linkedinFollowUp).toContain('https://f.example/x')
  })
})
