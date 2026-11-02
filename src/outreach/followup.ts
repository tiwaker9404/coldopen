/**
 * When to follow up on a film that was sent and hasn't had a reply: a first nudge after a few
 * days, one short last note a week later, then it's time to call it "no reply" and move on.
 * Two follow-ups is the usual advice: enough to catch a buried email, not enough to annoy.
 */

export const OUTREACH = ['sent', 'replied', 'interview', 'no_reply'] as const
export type OutreachStatus = (typeof OUTREACH)[number]

export interface Outreach {
  status: OutreachStatus
  at: string
  /** when it was first marked sent: reply rates are counted from here */
  sentAt: string
  /** follow-ups sent since */
  followUps?: number
  followedUpAt?: string
}

const DAY = 86_400_000
/** days to wait before each follow-up: after the film, then after the first follow-up */
export const WAIT_DAYS = [4, 7] as const
/** days after the last follow-up before suggesting it be marked "no reply" */
export const CLOSE_DAYS = 7

export interface NextStep {
  /** follow-up 1 or 2, or "close": mark it no reply */
  kind: 'follow_up' | 'close'
  step: 1 | 2 | null
  dueAt: string
  due: boolean
}

/** What to do next about a sent film, and when; null once it has an answer */
export function nextStep(o: Outreach | null | undefined, now = Date.now()): NextStep | null {
  if (o?.status !== 'sent') return null
  const n = Math.max(0, o.followUps ?? 0)
  const last = Date.parse(o.followedUpAt ?? o.sentAt)
  if (Number.isNaN(last)) return null
  const at = (days: number) => new Date(last + days * DAY)
  if (n < WAIT_DAYS.length) {
    const dueAt = at(WAIT_DAYS[n]!)
    return {
      kind: 'follow_up',
      step: (n + 1) as 1 | 2,
      dueAt: dueAt.toISOString(),
      due: now >= dueAt.getTime(),
    }
  }
  const dueAt = at(CLOSE_DAYS)
  return { kind: 'close', step: null, dueAt: dueAt.toISOString(), due: now >= dueAt.getTime() }
}

/** The outreach after one more follow-up was sent */
export function followedUp(o: Outreach, now = new Date()): Outreach {
  return { ...o, followUps: (o.followUps ?? 0) + 1, followedUpAt: now.toISOString() }
}
