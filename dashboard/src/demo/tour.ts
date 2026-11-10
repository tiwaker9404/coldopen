/**
 * The demo's 90-second tour: five stops through the real screens, the way a recruiter would
 * want to see them. Pure, so the order and the once-per-browser rule are unit-tested.
 */

export interface Stop {
  /** the page it opens (the hash the app routes on) */
  place: 'today' | 'jobs' | 'films'
  /** open the demo's first film too */
  film?: boolean
  title: string
  body: string
}

export const STOPS: readonly Stop[] = [
  {
    place: 'today',
    title: 'Today: what to do next',
    body: 'One list of what’s due: follow-ups, films being made, the best new fits and what’s working. This account sent three films.',
  },
  {
    place: 'jobs',
    title: 'Jobs, ranked by fit',
    body: 'Real openings from 450+ job boards, recorded on 10 Nov. Each one says how well you fit and why, and who you know there.',
  },
  {
    place: 'films',
    film: true,
    title: 'A 30-second film made for one company',
    body: 'Their colors, their font, their headline and a fact from their own site, then your proof. Press play.',
  },
  {
    place: 'films',
    film: true,
    title: 'The messages that go with it',
    body: 'Scroll to the messages: a connection note under 200 characters, the note after they accept, InMail and a warm email, each checked in code.',
  },
  {
    place: 'films',
    film: true,
    title: 'Who watched, and what worked',
    body: 'Views come from the share page: who pressed play and how far they got. The board tracks each film from sent to interview.',
  },
]

export const SEEN_KEY = 'coldopen.demo.tour'

/** Whether to start the tour on load. Storage that throws (private mode) means show it. */
export function shouldStart(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(SEEN_KEY) !== 'done'
  } catch {
    return true
  }
}

/** Remember the tour was finished or skipped. Storage that throws is fine: it shows again. */
export function markDone(storage: Pick<Storage, 'setItem'> | null): void {
  try {
    storage?.setItem(SEEN_KEY, 'done')
  } catch {
    /* blocked storage: the tour comes back next visit */
  }
}

/** The next stop, or null when the tour is over. */
export const next = (i: number): number | null => (i + 1 < STOPS.length ? i + 1 : null)
export const back = (i: number): number => Math.max(0, i - 1)
