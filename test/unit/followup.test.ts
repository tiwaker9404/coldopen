import { describe, expect, it } from 'vitest'
import {
  CANDIDATE_WAIT_DAYS,
  followedUp,
  nextStep,
  type Outreach,
  WAIT_DAYS,
  waitDaysFor,
} from '../../src/outreach/followup.ts'
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
  it("a job seeker's film gets one follow-up a week on (2 days after a watch), then says to call it", () => {
    const waits = waitDaysFor('candidate')
    expect(waits).toEqual([7])
    expect(CANDIDATE_WAIT_DAYS).toEqual([7])
    // a seller keeps two
    expect(waitDaysFor('sales')).toEqual(WAIT_DAYS)
    expect(waitDaysFor('sales')).toEqual([4, 7])
    expect(nextStep(sent, T0 + 4 * DAY, null, waits)).toMatchObject({ step: 1, due: false })
    expect(nextStep(sent, T0 + 7 * DAY, null, waits)).toMatchObject({
      kind: 'follow_up',
      step: 1,
      due: true,
    })
    // watched on day 1 with no reply: the follow-up comes on day 3, while interest is fresh
    const watched = { at: new Date(T0 + DAY).toISOString(), finished: true }
    expect(nextStep(sent, T0 + 3 * DAY, watched, waits)).toMatchObject({
      step: 1,
      due: true,
      watched,
    })
    // then stop: after the one follow-up, the next step is to call it
    const one = followedUp(sent, new Date(T0 + 7 * DAY))
    expect(nextStep(one, T0 + 13 * DAY, null, waits)).toMatchObject({ kind: 'close', due: false })
    expect(nextStep(one, T0 + 14 * DAY, null, waits)).toMatchObject({ kind: 'close', due: true })
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
    // a job seeker's notes are about their work, not the opening
    expect(m.lastNote).toContain('One last note on the film I made for Acme')
    expect(m.lastNote).not.toContain('role')
    expect(m.lastNote).toContain('https://f.example/x')
    expect(m.linkedinFollowUp.length).toBeLessThanOrEqual(300)
    expect(m.linkedinFollowUp).toContain('https://f.example/x')
  })
})
