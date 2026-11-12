import { describe, expect, it } from 'vitest'
import { callLine, dueCount } from '../../dashboard/src/callSheet.ts'

const none = { followUps: 0, warm: 0, rolling: 0, ready: 0, anyFilms: true }

describe("Today's call sheet and the count on its tab", () => {
  it('counts warm-lead touches due alongside follow-ups due', () => {
    expect(dueCount({ followUps: 2, warm: 1 })).toBe(3)
    expect(dueCount({ followUps: 0, warm: 2 })).toBe(2)
    expect(dueCount({ followUps: 0, warm: 0 })).toBe(0)
  })

  it('says a warm-lead touch is waiting, instead of "Nothing waiting on you"', () => {
    expect(callLine({ ...none, warm: 1 })).toBe('1 warm-lead touch due.')
    expect(callLine({ ...none, warm: 2 })).not.toMatch(/Nothing waiting/)
    expect(callLine({ ...none, followUps: 1, warm: 2, ready: 1 })).toBe(
      '1 follow-up due, 2 warm-lead touches due, 1 ready to send.',
    )
  })

  it('says nothing is waiting only when nothing is due, rolling or ready', () => {
    expect(callLine(none)).toBe('Nothing waiting on you. Make the next film.')
    expect(callLine({ ...none, anyFilms: false })).toBe('Your first film is one link away.')
    expect(callLine({ ...none, rolling: 1 })).toBe('1 film in production.')
  })
})
