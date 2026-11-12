import { describe, expect, it } from 'vitest'
import {
  BUMP_DAYS,
  conversationsThisMonth,
  draftTouch,
  inFirstPerson,
  monthStart,
  nextTouch,
  PROOF_DAYS,
  resultFor,
  rolesFor,
  STAY_DAYS,
  type Touch,
  type WarmFilm,
  type WarmJob,
} from '../../src/outreach/warm.ts'
import { profile } from '../helpers/index.ts'

const DAY = 86_400_000
const REPLIED = '2026-11-02T17:00:00.000Z'
const t0 = Date.parse(REPLIED)
const iso = (t: number) => new Date(t).toISOString()

const film: WarmFilm = {
  preset: 'candidate',
  status: 'replied',
  repliedAt: REPLIED,
  company: 'Parcelpine',
  host: 'parcelpine.com',
}
const touch = (kind: Touch['kind'], at: number, o: Partial<Touch> = {}): Touch => ({
  kind,
  roleId: null,
  said: null,
  buildNote: null,
  buildLink: null,
  doneAt: iso(at),
  ...o,
})
const thanked = (at = t0 + 3_600_000, o: Partial<Touch> = {}) =>
  touch('thankYou', at, { said: 'carriers still send rate sheets as PDFs', ...o })
const job = (o: Partial<WarmJob> = {}): WarmJob => ({
  id: 'ashby:parcelpine:1',
  title: 'Forward Deployed Engineer',
  url: 'https://jobs.ashbyhq.com/parcelpine/1',
  company: 'Parcelpine',
  site: 'https://parcelpine.com',
  posted: '2026-11-10',
  fit: 'strong',
  ...o,
})

describe('warm leads: when each touch is due', () => {
  it('a reply gets its thank-you the same day, and nothing else comes first', () => {
    expect(nextTouch(film, [], [job()], t0 - 1)).toMatchObject({ kind: 'thankYou', due: false })
    expect(nextTouch(film, [], [job()], t0)).toEqual({
      kind: 'thankYou',
      dueAt: REPLIED,
      due: true,
    })
    // a role opened, but they haven't been thanked yet
    expect(nextTouch(film, [], [job()], Date.parse('2026-11-20'))?.kind).toBe('thankYou')
  })

  it('no touch before a reply, on No reply films, or on a seller’s films', () => {
    for (const f of [
      { ...film, status: 'sent' },
      { ...film, status: 'no_reply' },
      { ...film, status: null },
      { ...film, preset: 'sales' as const },
      { ...film, repliedAt: null },
    ])
      expect(nextTouch(f, [], [job()], t0 + 100 * DAY), JSON.stringify(f)).toBeNull()
    // an interview is warm too
    expect(nextTouch({ ...film, status: 'interview' }, [], [], t0)?.kind).toBe('thankYou')
  })

  it('sends the proof-of-work note 5 days after the thank-you, only when they said they’d build something', () => {
    const at = t0 + 3_600_000
    const withBuild = [thanked(at, { buildNote: 'a script that reads rate-sheet PDFs' })]
    expect(nextTouch(film, withBuild, [], at + PROOF_DAYS * DAY - 1)).toMatchObject({
      kind: 'proofOfWork',
      due: false,
    })
    expect(nextTouch(film, withBuild, [], at + PROOF_DAYS * DAY)).toMatchObject({
      kind: 'proofOfWork',
      due: true,
    })
    // without a build note there's nothing to send: straight to stay in touch
    expect(nextTouch(film, [thanked(at)], [], at + PROOF_DAYS * DAY)).toMatchObject({
      kind: 'stayInTouch',
      due: false,
    })
    // sent once
    const sent = [
      ...withBuild,
      touch('proofOfWork', at + 6 * DAY, { buildLink: 'https://x.dev/a' }),
    ]
    expect(nextTouch(film, sent, [], at + 7 * DAY)?.kind).toBe('stayInTouch')
  })

  it('stays in touch every 42 days after the last touch, until stopped', () => {
    const at = t0 + 3_600_000
    const ts = [thanked(at)]
    expect(nextTouch(film, ts, [], at + STAY_DAYS * DAY - 1)).toMatchObject({
      kind: 'stayInTouch',
      dueAt: iso(at + STAY_DAYS * DAY),
      due: false,
    })
    expect(nextTouch(film, ts, [], at + STAY_DAYS * DAY)?.due).toBe(true)
    // and again 42 days after that one
    const again = [...ts, touch('stayInTouch', at + 43 * DAY)]
    expect(nextTouch(film, again, [], at + 50 * DAY)).toMatchObject({
      kind: 'stayInTouch',
      dueAt: iso(at + (43 + STAY_DAYS) * DAY),
      due: false,
    })
    // "Stop reminders" ends every touch for the film
    expect(nextTouch(film, [...again, touch('stop', at + 44 * DAY)], [job()], at + 400 * DAY)).toBe(
      null,
    )
    expect(nextTouch(film, [touch('stop', t0)], [], t0 + DAY)).toBeNull()
  })

  it('asks for the referral the day after a strong or good role opens there, once per role', () => {
    const ts = [thanked()]
    const posted = Date.parse('2026-11-10')
    expect(nextTouch(film, ts, [job()], posted + DAY - 1)).toMatchObject({
      kind: 'referralAsk',
      due: false,
    })
    const ask = nextTouch(film, ts, [job()], posted + DAY)
    expect(ask).toMatchObject({
      kind: 'referralAsk',
      due: true,
      role: { id: 'ashby:parcelpine:1', title: 'Forward Deployed Engineer' },
    })
    // it comes before a stay-in-touch that's also due
    expect(nextTouch(film, ts, [job()], t0 + 60 * DAY)?.kind).toBe('referralAsk')
    // asked: not again for that role, but a second role gets its own
    const asked = [...ts, touch('referralAsk', posted + DAY, { roleId: 'ashby:parcelpine:1' })]
    const two = [job(), job({ id: 'ashby:parcelpine:2', posted: '2026-11-12' })]
    expect(nextTouch(film, asked, two, Date.parse('2026-11-13'))).toMatchObject({
      kind: 'referralAsk',
      role: { id: 'ashby:parcelpine:2' },
    })
  })

  it('bumps the referral ask once, 7 days later, then nothing more for that role', () => {
    const askedAt = Date.parse('2026-11-11T18:00:00Z')
    const ts = [thanked(), touch('referralAsk', askedAt, { roleId: 'ashby:parcelpine:1' })]
    expect(nextTouch(film, ts, [job()], askedAt + BUMP_DAYS * DAY - 1)).toMatchObject({
      kind: 'referralBump',
      due: false,
    })
    expect(nextTouch(film, ts, [job()], askedAt + BUMP_DAYS * DAY)).toMatchObject({
      kind: 'referralBump',
      due: true,
      role: { id: 'ashby:parcelpine:1', title: 'Forward Deployed Engineer' },
    })
    const bumped = [
      ...ts,
      touch('referralBump', askedAt + 8 * DAY, { roleId: 'ashby:parcelpine:1' }),
    ]
    const after = nextTouch(film, bumped, [job()], askedAt + 30 * DAY)
    expect(after?.kind).toBe('stayInTouch')
    expect(after?.due).toBe(false)
  })
})

describe('warm leads: which roles make a referral ask', () => {
  it('matches the company by name or website, posted on or after the day of the reply, strong or good', () => {
    expect(rolesFor(film, [job()]).map((j) => j.id)).toEqual(['ashby:parcelpine:1'])
    // the same company by name, with a suffix, and no website
    expect(rolesFor(film, [job({ company: 'Parcelpine, Inc.', site: undefined })])).toHaveLength(1)
    // the same website under another name
    expect(rolesFor(film, [job({ company: 'PP Logistics' })])).toHaveLength(1)
    // posted the same day as the reply counts; the day before doesn't
    expect(rolesFor(film, [job({ posted: '2026-11-02' })])).toHaveLength(1)
    expect(rolesFor(film, [job({ posted: '2026-11-01' })])).toHaveLength(0)
    // a stretch, an unknown fit, another company, or no date: no ask
    for (const j of [
      job({ fit: 'stretch' }),
      job({ fit: null }),
      job({ company: 'Northwind Freight', site: 'https://northwind.com' }),
      job({ posted: undefined }),
    ])
      expect(rolesFor(film, [j]), JSON.stringify(j)).toEqual([])
    expect(rolesFor(film, [job({ fit: 'good' })])).toHaveLength(1)
  })
})

describe('warm leads: conversations this month', () => {
  it('counts films first marked replied since the 1st, Pacific time', () => {
    const now = Date.parse('2026-11-12T16:00:00Z')
    // Nov 1, 00:00 in Los Angeles is 07:00 UTC (daylight time ends Nov 1 at 2am)
    expect(monthStart(now).toISOString()).toBe('2026-11-01T07:00:00.000Z')
    expect(
      conversationsThisMonth(
        [
          { repliedAt: '2026-11-01T07:30:00Z' },
          { repliedAt: '2026-11-11T20:00:00Z' },
          // Oct 31, 11pm in Los Angeles
          { repliedAt: '2026-11-01T06:00:00Z' },
          { repliedAt: null },
          // later than now
          { repliedAt: '2026-11-20T00:00:00Z' },
        ],
        now,
      ),
    ).toBe(2)
  })
})

describe('warm leads: the drafts', () => {
  const p = profile('candidate')
  it('the thank-you names what they said, what you’ll build and asks who else to talk to', () => {
    const d = draftTouch({
      kind: 'thankYou',
      company: 'Parcelpine',
      profile: p,
      said: 'carriers still send rate sheets as PDFs.',
      buildNote: 'A script that reads rate-sheet PDFs',
    })
    expect(d.body).toContain('what you said about "carriers still send rate sheets as PDFs".')
    expect(d.body).toContain('a script that reads rate-sheet PDFs')
    expect(d.body).toContain('Is there anyone else you think I should talk to?')
    expect(d.body.endsWith('Thank you,\nAlex')).toBe(true)
  })

  it('keeps a slot for what they said until it’s filled in', () => {
    const d = draftTouch({ kind: 'thankYou', company: 'Parcelpine', profile: p, said: null })
    expect(d.body).toContain('[one thing they said]')
  })

  it('the referral ask names the role and link, has a way out, and a blurb under 70 words', () => {
    const d = draftTouch({
      kind: 'referralAsk',
      company: 'Parcelpine',
      profile: p,
      said: 'carriers still send rate sheets as PDFs',
      role: { title: 'Forward Deployed Engineer', url: 'https://jobs.ashbyhq.com/parcelpine/1' },
      share: 'https://share.example/f/x',
    })
    expect(d.body).toContain('When we talked about "carriers still send rate sheets as PDFs"')
    expect(d.body).toContain(
      'the Forward Deployed Engineer role: https://jobs.ashbyhq.com/parcelpine/1',
    )
    expect(d.body).toContain('Would you be open to passing my name to the hiring manager?')
    expect(d.body).toContain("No problem at all if the timing isn't right.")
    expect(d.blurb).toMatch(/^Alex Rivera, a forward deployed engineer, is interested in/)
    expect(d.blurb).toContain('https://share.example/f/x')
    expect(d.blurb!.split(/\s+/).length).toBeLessThan(70)
  })

  it('says a résumé point in the first person, and leaves other lines alone', () => {
    expect(inFirstPerson('Ships production agents with evals')).toBe(
      'I ship production agents with evals',
    )
    expect(inFirstPerson('Fixes flaky pipelines')).toBe('I fix flaky pipelines')
    expect(inFirstPerson('Carries the pager')).toBe('I carry the pager')
    expect(inFirstPerson('6 open-source AI projects shipped')).toBe(
      '6 open-source AI projects shipped',
    )
    expect(inFirstPerson('I build agents')).toBe('I build agents')
  })

  it('the blurb’s result is one proof: what they did and the change, with no number said twice', () => {
    const r = resultFor(
      {
        points: [],
        proof: [
          { value: '6', label: 'open-source AI projects shipped' },
          {
            value: '6 → 2 days',
            label: 'month-end close, from 6 days to 2',
            did: 'Automated reconciliations in Python',
            where: 'Rail Inc.',
          },
        ],
      },
      'Forward Deployed Engineer',
    )
    expect(r).toBe(
      'Automated reconciliations in Python (month-end close, from 6 days to 2) at Rail Inc.',
    )
  })
})
