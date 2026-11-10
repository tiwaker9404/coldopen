import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFeed } from '../../src/brand/homework.ts'
import {
  type Check,
  type CheckRule,
  checkMessage,
  FILM_LENGTH,
  knownFor,
  MESSAGE_LIMITS,
  passed,
  RESEARCH_OVERLAP,
} from '../../src/outreach/checks.ts'
import { checkEmail } from '../../src/outreach/messages.ts'
import { overlap } from '../../src/script/checks.ts'
import { BEGGING } from '../../src/script/taste.ts'
import { profile } from '../helpers/index.ts'

const link = 'https://share.example/f/ab12cd'
const ctx = {
  company: 'Parcelpine',
  known:
    'Parcelpine plans 2,000 routes a day. 40% faster month-end close at Initech. 12 dashboards',
  link,
}
const rule = (checks: Check[], r: CheckRule) => checks.find((c) => c.rule === r)
const fails = (checks: Check[], r: CheckRule) => rule(checks, r)?.ok === false

const note =
  "Hi [First name], I'm applying for the Operations Analyst role at Parcelpine and made something for the team. Would like to connect. – Ashwin"
const email = {
  subject: 'A 30-second film for Parcelpine',
  body: [
    'Hi [First name],',
    '',
    'I saw the Operations Analyst role at Parcelpine. I made a 30-second film for the team:',
    link,
    '',
    '40% faster month-end close at Initech, and 12 dashboards in daily use.',
    '',
    'Could we talk for 15 minutes this week?',
    '',
    'Ashwin Tiwari',
  ].join('\n'),
}
const afterAccept = `Thanks for connecting, [First name]. Here's the film I made for Parcelpine: ${link} Could we talk for 15 minutes this week? – Ashwin`

describe('message checks', () => {
  it('passes good drafts of each kind, and reports every rule it checked', () => {
    const ok = { ...ctx, known: `${ctx.known} 15 minutes` }
    for (const [kind, text] of [
      ['note', note],
      ['afterAccept', afterAccept],
      ['inmail', { subject: 'A film for Parcelpine', body: afterAccept }],
      ['email', email],
    ] as const) {
      const checks = checkMessage(kind, text, ok)
      expect(checks.filter((c) => !c.ok)).toEqual([])
      expect(passed(checks)).toBe(true)
    }
    expect(checkMessage('note', note, ctx).map((c) => c.rule)).toEqual([
      'length',
      'grounded',
      'no_begging',
      'one_ask',
      'names_company',
      'no_link',
      'banned',
      'no_exclamation',
    ])
  })

  describe('length', () => {
    it('fails a 201-character note with "201 of 200 characters"', () => {
      const at = (n: number) => `Parcelpine ${'a'.repeat(n - 11)}`
      expect(rule(checkMessage('note', at(200), ctx), 'length')?.ok).toBe(true)
      const c = rule(checkMessage('note', at(201), ctx), 'length')
      expect(c?.ok).toBe(false)
      expect(c?.why).toContain('201 of 200 characters')
    })

    it('counts the InMail subject and body separately', () => {
      const long = checkMessage(
        'inmail',
        {
          subject: `Parcelpine ${'s'.repeat(MESSAGE_LIMITS.inmailSubject)}`,
          body: 'b'.repeat(401),
        },
        ctx,
      ).filter((c) => c.rule === 'length')
      expect(long.map((c) => c.ok)).toEqual([false, false])
      expect(long[0]!.why).toMatch(/^The subject is 71 of 60 characters/)
      expect(long[1]!.why).toMatch(/^The message is 401 of 400 characters/)
    })

    it('counts words for email, skipping the link line, the same way checkEmail does', () => {
      const body = `${'word '.repeat(125)}\n${link}`
      expect(rule(checkMessage('email', { subject: 'Parcelpine', body }, ctx), 'length')?.ok).toBe(
        true,
      )
      expect(checkEmail({ subject: 'Parcelpine', body }, 'Parcelpine').words).toBe(125)
      const over = rule(
        checkMessage('email', { subject: 'Parcelpine', body: `one ${body}` }, ctx),
        'length',
      )
      expect(over).toMatchObject({ ok: false, why: '126 of 125 words' })
    })

    it('gives a LinkedIn follow-up a message’s room, not a note’s', () => {
      const fu = `Following up on the film I made for Parcelpine. ${'x'.repeat(300)}`
      expect(rule(checkMessage('linkedinFollowUp', fu, ctx), 'length')?.ok).toBe(true)
    })
  })

  describe('grounded', () => {
    it('passes "cut costs 40%" only when 40% is known', () => {
      const say = { subject: 'Parcelpine', body: 'At Initech I cut costs 40%.' }
      expect(fails(checkMessage('email', say, ctx), 'grounded')).toBe(false)
      const c = rule(
        checkMessage('email', say, { ...ctx, known: 'Parcelpine plans routes' }),
        'grounded',
      )
      expect(c?.ok).toBe(false)
      expect(c?.why).toBe('Says "40%" but neither their site nor your profile does')
    })

    it("doesn't count placeholders, the link or other URLs as numbers", () => {
      const text = `Hi [First name 2], Parcelpine film: ${link} and https://github.com/me/repo-42 [3]`
      expect(fails(checkMessage('afterAccept', text, { ...ctx, known: '' }), 'grounded')).toBe(
        false,
      )
    })

    it('lets "the 30-second film" through: every film is 30 seconds', () => {
      expect(
        fails(checkMessage('email', email, { ...ctx, known: '40% 12 15 minutes' }), 'grounded'),
      ).toBe(false)
    })

    it('matches "2,000+" against "2,000" but not "12x" against "1"', () => {
      expect(fails(checkMessage('note', 'Parcelpine plans 2,000+ routes', ctx), 'grounded')).toBe(
        false,
      )
      expect(
        fails(checkMessage('note', 'Parcelpine, 12x', { ...ctx, known: '1' }), 'grounded'),
      ).toBe(true)
    })
  })

  describe('no_begging', () => {
    it('fails "Could you refer me to the hiring manager?"', () => {
      const c = rule(
        checkMessage(
          'afterAccept',
          `Parcelpine ${link} Could you refer me to the hiring manager?`,
          ctx,
        ),
        'no_begging',
      )
      expect(c?.ok).toBe(false)
      expect(c?.why).toContain('"refer me"')
    })

    it('catches every phrase on the list, in any case and with curly apostrophes', () => {
      for (const b of BEGGING)
        expect(
          fails(checkMessage('note', `Parcelpine. ${b.toUpperCase()}.`, ctx), 'no_begging'),
        ).toBe(true)
      expect(
        fails(
          checkMessage('note', 'Parcelpine. I’d be grateful for a pointer.', ctx),
          'no_begging',
        ),
      ).toBe(true)
    })

    it('matches whole phrases only: "desperately" and "preferred" pass', () => {
      expect(
        fails(
          checkMessage('note', 'Parcelpine desperately needed routes, preferred by ops', ctx),
          'no_begging',
        ),
      ).toBe(false)
    })

    it('still flags "referral" quoted back from their own "referral program", which is fine: it reads as asking for one', () => {
      expect(
        fails(
          checkMessage('note', 'Saw Parcelpine launched a referral program for shippers', ctx),
          'no_begging',
        ),
      ).toBe(true)
    })
  })

  describe('one_ask', () => {
    it('fails a note with a question, since the note only asks to connect', () => {
      expect(fails(checkMessage('note', `${note} Open to a chat?`, ctx), 'one_ask')).toBe(true)
    })

    it('fails an email with two questions, and one with none', () => {
      const two = { ...email, body: `${email.body}\nOr would next week suit you better?` }
      expect(rule(checkMessage('email', two, ctx), 'one_ask')?.why).toContain('2 questions')
      const none = { ...email, body: email.body.replace('?', '.') }
      expect(fails(checkMessage('email', none, ctx), 'one_ask')).toBe(true)
    })

    it('needs exactly one in the after-accept message and the InMail body', () => {
      expect(fails(checkMessage('afterAccept', afterAccept, ctx), 'one_ask')).toBe(false)
      expect(
        fails(
          checkMessage(
            'inmail',
            { subject: 'Parcelpine?', body: afterAccept.replace('?', '.') },
            ctx,
          ),
          'one_ask',
        ),
      ).toBe(true)
    })

    it('lets a follow-up close without asking, but not ask twice', () => {
      expect(
        fails(checkMessage('lastNote', 'No problem at all if the timing is off.', ctx), 'one_ask'),
      ).toBe(false)
      expect(fails(checkMessage('followUp', 'Free Tuesday? Or Thursday?', ctx), 'one_ask')).toBe(
        true,
      )
    })
  })

  describe('names_company', () => {
    it('needs the company in the note, after-accept, InMail and email', () => {
      expect(
        fails(checkMessage('note', 'Hi, I made something for the team.', ctx), 'names_company'),
      ).toBe(true)
      expect(
        rule(checkMessage('afterAccept', `Here: ${link} Talk?`, ctx), 'names_company')?.why,
      ).toBe("Doesn't name Parcelpine")
      expect(fails(checkMessage('email', email, ctx), 'names_company')).toBe(false)
    })

    it('counts the InMail subject or body, case-insensitively', () => {
      const c = checkMessage(
        'inmail',
        { subject: 'A film for PARCELPINE', body: `${link} Talk?` },
        ctx,
      )
      expect(fails(c, 'names_company')).toBe(false)
    })

    it("isn't asked of follow-ups, which reply in the same thread", () => {
      expect(rule(checkMessage('followUp', 'Bumping this.', ctx), 'names_company')).toBeUndefined()
    })
  })

  describe('no_link and has_link', () => {
    it('fails a note with a link', () => {
      expect(fails(checkMessage('note', `Parcelpine film: ${link}`, ctx), 'no_link')).toBe(true)
      expect(fails(checkMessage('note', 'Parcelpine, see www.example.com', ctx), 'no_link')).toBe(
        true,
      )
      expect(fails(checkMessage('note', note, ctx), 'no_link')).toBe(false)
    })

    it('needs the film link exactly once in after-accept, InMail and email', () => {
      expect(fails(checkMessage('afterAccept', afterAccept, ctx), 'has_link')).toBe(false)
      expect(
        rule(checkMessage('afterAccept', 'Parcelpine. Could we talk?', ctx), 'has_link')?.why,
      ).toBe('Leaves out the link to the film')
      expect(
        rule(checkMessage('email', { ...email, body: `${email.body}\n${link}` }, ctx), 'has_link')
          ?.why,
      ).toContain('2 times')
    })
  })

  describe('banned and no_exclamation', () => {
    it('fails BANNED words and exclamation marks', () => {
      expect(fails(checkMessage('note', 'Parcelpine is doing amazing work', ctx), 'banned')).toBe(
        true,
      )
      expect(fails(checkMessage('note', note, ctx), 'banned')).toBe(false)
      expect(fails(checkMessage('note', 'Hi from Parcelpine fan!', ctx), 'no_exclamation')).toBe(
        true,
      )
      expect(fails(checkMessage('note', note, ctx), 'no_exclamation')).toBe(false)
    })
  })

  describe('film_once', () => {
    const withOpening = (opening: string, fit = '40% faster month-end close at Initech.') => ({
      subject: 'A 30-second film for Parcelpine',
      body: [
        'Hi [First name],',
        '',
        opening,
        '',
        'I made a 30-second film for your Operations Analyst role at Parcelpine:',
        link,
        '',
        fit,
        '',
        'Could we talk for 15 minutes this week?',
        '',
        'Ashwin Tiwari',
      ].join('\n'),
    })
    const ok = { ...ctx, known: `${ctx.known} 15 minutes` }

    it('passes an email that says "film" only in the line code writes, and in its subject', () => {
      const checks = checkMessage(
        'email',
        withOpening('I saw the Operations Analyst role at Parcelpine.'),
        ok,
      )
      expect(rule(checks, 'film_once')).toEqual({ rule: 'film_once', ok: true })
      expect(passed(checks)).toBe(true)
      // the stored draft's [film] placeholder isn't the email saying it again
      const stored = withOpening('I saw the Operations Analyst role at Parcelpine.')
      expect(
        fails(
          checkMessage('email', { ...stored, body: stored.body.replace(link, '[film]') }, ok),
          'film_once',
        ),
      ).toBe(false)
    })

    it('fails an opening that says "I made you a video", with its why', () => {
      const checks = checkMessage('email', withOpening('I made you a video about Parcelpine.'), ok)
      expect(rule(checks, 'film_once')).toEqual({
        rule: 'film_once',
        ok: false,
        why: 'Mentions the film again; the film line already does',
      })
    })

    it('fails "film" anywhere else in the body too, and is only asked of the email', () => {
      const fit = 'The film shows 40% faster month-end close at Initech.'
      expect(
        fails(
          checkMessage('email', withOpening('I saw the role at Parcelpine.', fit), ok),
          'film_once',
        ),
      ).toBe(true)
      expect(rule(checkMessage('afterAccept', afterAccept, ok), 'film_once')).toBeUndefined()
    })
  })

  describe('research_grounded', () => {
    const source =
      'We rebuilt route planning so dispatchers can re-plan a whole day of deliveries in seconds.'
    it('passes a line that stays close to what they wrote', () => {
      const research = {
        line: 'you rebuilt route planning so dispatchers re-plan deliveries in seconds',
        source,
      }
      expect(fails(checkMessage('email', email, { ...ctx, research }), 'research_grounded')).toBe(
        false,
      )
    })

    it(`fails a line that drifts below ${RESEARCH_OVERLAP} overlap with the post`, () => {
      const research = {
        line: 'you are expanding into Europe with a new warehouse network',
        source,
      }
      expect(
        rule(checkMessage('email', email, { ...ctx, research }), 'research_grounded')?.why,
      ).toMatch(/doesn't/)
    })

    it('passes a restatement with a few words of reaction (0.75), and fails one that adds its own claim', () => {
      // Parcelpine's live-traffic post, and lines like the real model's from step 6d
      const post =
        'Route planning now reroutes trucks around live traffic before a delivery runs late, for every lane.'
      const reaction = 'Your route planning reroutes trucks around traffic, which caught my eye'
      expect(overlap(reaction, post)).toBe(0.75)
      expect(
        fails(
          checkMessage('email', email, { ...ctx, research: { line: reaction, source: post } }),
          'research_grounded',
        ),
      ).toBe(false)
      const claim =
        'Route planning that reroutes around live traffic means your dispatch team can promise tighter delivery windows to every customer'
      expect(overlap(claim, post)).toBeLessThan(RESEARCH_OVERLAP)
      expect(
        fails(
          checkMessage('email', email, { ...ctx, research: { line: claim, source: post } }),
          'research_grounded',
        ),
      ).toBe(true)
    })

    it('is only checked on emails that carry research', () => {
      expect(rule(checkMessage('email', email, ctx), 'research_grounded')).toBeUndefined()
      expect(
        rule(
          checkMessage('note', note, { ...ctx, research: { line: 'x', source: 'y' } }),
          'research_grounded',
        ),
      ).toBeUndefined()
    })
  })
})

describe('knownFor', () => {
  it('includes what a fixture post says, so a number from its summary counts as theirs', () => {
    const xml = readFileSync(
      join(import.meta.dirname, '../../fixtures/sites/parcelpine/changelog.xml'),
      'utf8',
    )
    const items = parseFeed(xml, 'http://127.0.0.1/').map((i) => ({
      kind: 'changelog' as const,
      ...i,
    }))
    const known = knownFor({ company: 'Parcelpine' }, profile('candidate'), { items, pages: [] })
    expect(known).toContain('reroutes trucks around live traffic before a delivery runs late')
    expect(known).toContain('customers see it in the tracking link within a minute')
  })

  it(`counts the film's length as known: "a ${FILM_LENGTH} film" passes grounded, "cut churn 30%" doesn't`, () => {
    const known = knownFor({ company: 'Parcelpine' }, profile('candidate'))
    const at = { company: 'Parcelpine', known, link: 'https://x.example/f/1' }
    for (const said of ['a 30-second film', 'a 30 seconds film', 'a 30\u2011second film'])
      expect(
        rule(
          checkMessage('note', `Hi Dana, I made ${said} for Parcelpine. – Alex`, at),
          'grounded',
        ),
        said,
      ).toEqual({ rule: 'grounded', ok: true })
    expect(
      fails(
        checkMessage('note', 'Hi Dana, I cut churn 30% at Initech for Parcelpine. – Alex', at),
        'grounded',
      ),
    ).toBe(true)
  })

  it("counts the email's 15-minute ask as known, so a model's own ask passes the re-check", () => {
    const known = knownFor({ company: 'Parcelpine' }, profile('candidate'))
    const checks = checkMessage(
      'afterAccept',
      'Hi Dana, thanks for connecting. A film for Parcelpine: https://x.example/f/1 Could we find 15 minutes this week? – Alex',
      { company: 'Parcelpine', known, link: 'https://x.example/f/1' },
    )
    expect(checks.find((c) => c.rule === 'grounded')).toEqual({ rule: 'grounded', ok: true })
  })
})
