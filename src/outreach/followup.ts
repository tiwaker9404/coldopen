/**
 * When to follow up on a film that was sent and hasn't had a reply. A seller nudges after a few
 * days and sends one short last note a week later: enough to catch a buried email, not enough
 * to annoy. A job seeker writes once more, a week on, with something new (a fresh fact, a newer
 * post, something they tried since), then lets it go: one follow-up that adds something lifts
 * replies, and a second reads as pressure on someone who owes them nothing. After the last one
 * it's time to call it "no reply" and move on.
 */
import type { Profile } from '../script/types.ts'
import type { Opener } from './messages.ts'

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
  /**
   * how its email opened when it was marked sent (openerFor), so the A/B counts it the way it
   * went out even after the drafts change. Missing on films sent before it was kept.
   */
  opener?: Opener
}

const DAY = 86_400_000
/** days to wait before each follow-up: after the film, then after the first follow-up */
export const WAIT_DAYS = [4, 7] as const
/** a job seeker's one follow-up, a week after the film */
export const CANDIDATE_WAIT_DAYS = [7] as const

/** The follow-ups a film gets, by who sent it */
export const waitDaysFor = (preset: Profile['preset'] | undefined): readonly number[] =>
  preset === 'candidate' ? CANDIDATE_WAIT_DAYS : WAIT_DAYS
/** days after the last follow-up before suggesting it be marked "no reply" */
export const CLOSE_DAYS = 7

export interface NextStep {
  /** follow-up 1 or 2, or "close": mark it no reply */
  kind: 'follow_up' | 'close'
  step: 1 | 2 | null
  dueAt: string
  due: boolean
  /** brought forward because they watched it since you last wrote, with no reply */
  watched?: { at: string; finished: boolean }
}

/** days after a watch with no reply before the follow-up is due: interest is fresh */
export const AFTER_WATCH_DAYS = 2

/** The latest time someone watched the film, from its share page views */
export interface Watched {
  /** last time anyone was on the page after pressing play */
  at: string
  finished: boolean
}

/** What to do next about a sent film, and when; null once it has an answer */
export function nextStep(
  o: Outreach | null | undefined,
  now = Date.now(),
  watched?: Watched | null,
  /** the follow-ups this film gets (waitDaysFor): a job seeker's one, or a seller's two */
  waits: readonly number[] = WAIT_DAYS,
): NextStep | null {
  if (o?.status !== 'sent') return null
  const n = Math.max(0, o.followUps ?? 0)
  const last = Date.parse(o.followedUpAt ?? o.sentAt)
  if (Number.isNaN(last)) return null
  const at = (days: number) => new Date(last + days * DAY)
  if (n < waits.length) {
    let dueAt = at(waits[n]!)
    // watched since the last message and no reply: follow up while it's fresh
    const w = watched ? Date.parse(watched.at) : Number.NaN
    const early = !Number.isNaN(w) && w > last ? new Date(w + AFTER_WATCH_DAYS * DAY) : null
    const sooner = early && early < dueAt
    if (sooner) dueAt = early
    return {
      kind: 'follow_up',
      step: (n + 1) as 1 | 2,
      dueAt: dueAt.toISOString(),
      due: now >= dueAt.getTime(),
      ...(sooner ? { watched: { at: watched!.at, finished: watched!.finished } } : {}),
    }
  }
  const dueAt = at(CLOSE_DAYS)
  return { kind: 'close', step: null, dueAt: dueAt.toISOString(), due: now >= dueAt.getTime() }
}

/** The outreach after one more follow-up was sent */
export function followedUp(o: Outreach, now = new Date()): Outreach {
  return { ...o, followUps: (o.followUps ?? 0) + 1, followedUpAt: now.toISOString() }
}

/** What views say for follow-ups: someone pressed play, and when they were last there */
export function watchedFrom(
  v: { plays: number; finishes: number; lastSeen: string | null } | null | undefined,
): Watched | null {
  if (!v || v.plays === 0 || !v.lastSeen) return null
  return { at: v.lastSeen, finished: v.finishes > 0 }
}
