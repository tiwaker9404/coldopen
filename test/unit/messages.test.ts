import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseFeed } from '../../src/brand/homework.ts'
import type { BrandKit } from '../../src/brand/types.ts'
import type { FilmResult } from '../../src/film.ts'
import {
  type Check,
  checkMessage,
  knownFor,
  type MessageKind,
  passed,
} from '../../src/outreach/checks.ts'
import {
  addressed,
  draftMessages,
  freshRound,
  messagesFor,
  openerFor,
  researchSentence,
  wholeClause,
} from '../../src/outreach/messages.ts'
import type { FilmMessages } from '../../src/outreach/writer.ts'
import { hiringProfile, withRole } from '../../src/profile/pitch.ts'
import { buildStoryboard } from '../../src/script/storyboard.ts'
import { BEGGING } from '../../src/script/taste.ts'
import { type Profile, ProfileSchema } from '../../src/script/types.ts'
import { deterministicScript } from '../../src/script/writer.ts'
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
      'It answers one line from the post: "Experience building dashboards that operations teams use every day".',
    )
    expect(m.email.body).toContain(
      "What I'd bring: 40% faster month-end close at Initech; 12 dashboards in daily use.",
    )
    expect(m.email.body).not.toContain('not shown')
    // a headline that only restates the role isn't worth a line
    expect(m.email.body).not.toMatch(/Why I fit/)
    expect(m.email.body.trimEnd().endsWith(p.cta.contact)).toBe(true)
    expect(
      m.email.body.startsWith(
        'Hi [First name],\n\nI saw the Operations Analyst role at Parcelpine.',
      ),
    ).toBe(true)
    expect(m.linkedin).toBe(
      "Hi [First name], I'm applying for the Operations Analyst role at Parcelpine and made something for the team. Would like to connect. – Alex",
    )
    expect(m.afterAccept).toContain('https://share.example/f/x')
    expect(m.inmail?.subject).toContain('Parcelpine')
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
    expect(m.email.body).toContain("I've been following what Acme is building.")
    expect(m.linkedin).toBe(
      'Hi [First name], I made something for the Acme team. Would like to connect. – Maya',
    )
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
    expect(m.email.body).toContain(
      "I saw the Operations Analyst role at Parcelpine.\nI've been using Parcelpine",
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
    // the best number goes into the opening, so both openers keep the same five parts
    expect(m.email.body).toContain(
      "I saw the Operations Analyst role at Parcelpine. 40% faster month-end close at Initech.\n\nI made a 30-second film for your Operations Analyst role at Parcelpine on what I'd bring:",
    )
    // the number isn't said twice; the second one still comes after the film
    expect(m.email.body.match(/40% faster/g)).toHaveLength(1)
    expect(m.email.body).toContain('12 dashboards in daily use')
    expect(m.checks.aboutThem).toBe(true)
    expect(m.linkedin.length).toBeLessThanOrEqual(200)
    expect(m.linkedin).toContain('40% faster month-end close')
    expect(m.inmail?.subject).toBe('Parcelpine: 40% faster month-end close at Initech')
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
    expect(freshRound({ date: '2026-10-20' }, now)).toBe(true)
    // still on the 3-month filter, but too old to open an email with
    expect(freshRound({ date: '2026-09-01' }, now)).toBe(false)
    expect(freshRound(null, now)).toBe(false)
    const recent = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10)
    const m = draftMessages(out as never, profile('candidate'), 'https://share.example/f/x', {
      raised: { date: recent },
    })
    expect(m.whyNow).toBe(true)
    expect(m.email.body).toContain('Congratulations on the new funding round.')
  })
})

/* ------------------------------------------------ every template passes the checks */

const root = join(import.meta.dirname, '../..')

/** The fixture sites, as extraction reads them (fixtures/sites/*), with and without a job post. */
const SITE_KITS: BrandKit[] = [
  {
    name: 'Northwind Freight',
    host: 'northwindfreight.example',
    headline: "Every pallet, visible before it's late.",
    description:
      'Northwind gives mid-size shippers live visibility into every pallet, carrier and dock appointment, and flags exceptions before your customers notice.',
    facts: [
      { id: 'f1', text: "Every pallet, visible before it's late.", kind: 'headline' },
      { id: 'f2', text: '1,400+ shippers track freight on Northwind', kind: 'stat' },
      { id: 'f3', text: '38% fewer late deliveries in the first quarter', kind: 'stat' },
      { id: 'f4', text: '9 min average time to resolve a flagged exception', kind: 'stat' },
      {
        id: 'f5',
        text: '"We stopped finding out about late trucks from our customers."',
        kind: 'quote',
      },
    ],
  },
  {
    name: 'Lumen Health',
    host: 'lumen.example',
    headline: 'Patient intake that writes itself.',
    description:
      "Lumen turns a patient's own words into a structured intake note before they reach the exam room.",
    facts: [
      { id: 'f1', text: 'Patient intake that writes itself.', kind: 'headline' },
      { id: 'f2', text: '11 minutes saved per visit on documentation', kind: 'stat' },
      { id: 'f3', text: '212 clinics run intake on Lumen', kind: 'stat' },
      { id: 'f4', text: '94% of patients finish intake before arrival', kind: 'stat' },
    ],
  },
  {
    name: 'Parcelpine',
    host: 'parcelpine.example',
    headline: 'Returns that keep the customer.',
    description:
      'Parcelpine turns returns into exchanges for Shopify brands, with instant store credit, QR drop-offs and fraud checks built in.',
    facts: [
      { id: 'f1', text: 'Returns that keep the customer.', kind: 'headline' },
      { id: 'f2', text: '61% of returns become exchanges or store credit', kind: 'stat' },
      { id: 'f3', text: '3,100 Shopify brands use Parcelpine', kind: 'stat' },
      { id: 'f4', text: '2 days faster refunds with QR drop-off', kind: 'stat' },
    ],
  },
] as unknown as BrandKit[]

const JOBS: Record<string, { title: string; reqs: string[] }> = {
  'Northwind Freight': {
    title: 'Forward Deployed Engineer - Platform',
    reqs: [
      'Deploy our routing agents inside customer warehouses, from first call to production',
      'Turn messy shipment data from customer ERPs into reliable pipelines',
      '3+ years shipping production software in Python or TypeScript',
    ],
  },
  'Lumen Health': {
    title: 'Senior Data Analyst, Growth',
    reqs: [
      'Own the metrics that tell us which clinics are growing and why',
      'Build dashboards in SQL and Looker that teams use every week',
      '4+ years of SQL and data modeling for product or finance teams',
    ],
  },
  Parcelpine: {
    title: 'Operations Analyst',
    reqs: ['Experience building dashboards that operations teams use every day'],
  },
}

/** Every film the fixtures make: each site, with and without its job post */
const KITS: BrandKit[] = SITE_KITS.flatMap((kit) => {
  const job = JOBS[kit.name]!
  return [
    kit,
    {
      ...kit,
      job: { title: job.title, url: `https://jobs.example/${kit.host}` },
      facts: [
        ...kit.facts,
        ...job.reqs.map((text, i) => ({ id: `j${i + 1}`, text, kind: 'requirement' })),
      ],
    } as unknown as BrandKit,
  ]
})

/** The example profiles that get these templates: every job seeker and seller */
const PROFILES: Profile[] = [
  ...readdirSync(join(root, 'profiles/examples')).map((f) => `profiles/examples/${f}`),
  'profiles/candidate.example.json',
  'profiles/sales.example.json',
]
  .map((f) => ProfileSchema.parse(JSON.parse(readFileSync(join(root, f), 'utf8'))))
  .filter((p) => p.preset === 'candidate' || p.preset === 'sales')

/** What film.ts stores for the messages: the film's script, its quote and the proof it shows */
function filmFor(
  kit: BrandKit,
  p: Profile,
): Pick<FilmResult, 'company' | 'job' | 'highlights' | 'script'> {
  const script = deterministicScript(kit, p)
  const board = buildStoryboard(kit, p, script)
  const insight = board.scenes.find((s) => s.kind === 'insight')
  const proof = board.scenes.find((s) => s.kind === 'proof')
  return {
    company: kit.name,
    ...(kit.job ? { job: kit.job } : {}),
    script,
    highlights: {
      quote:
        insight?.kind === 'insight'
          ? {
              text: insight.value ? `${insight.value} ${insight.text}` : insight.text,
              source: insight.source,
            }
          : { text: '', source: '' },
      proof: proof?.kind === 'proof' ? proof.stats : [],
    },
  }
}

const LINK = 'https://share.example/f/abc123'
const RESEARCH = {
  title: 'Route planning, now with live traffic',
  line: 'Route planning now reroutes trucks around live traffic before a delivery runs late',
  source:
    'Route planning now reroutes trucks around live traffic before a delivery runs late, for every lane.',
}

const failures = (checks: Check[]) =>
  checks
    .filter((c) => !c.ok)
    .map((c) => `${c.rule}: ${c.why}`)
    .join('; ')

describe('every template passes the checks', () => {
  it('has fixture films and example profiles to check', () => {
    expect(KITS).toHaveLength(6)
    expect(PROFILES.length).toBeGreaterThanOrEqual(8)
  })

  // one case per fixture film, over every profile, both openers, with and without research
  for (const kit of KITS)
    it(`${kit.name}${kit.job ? ', with its job' : ''}: every draft, for every profile`, () => {
      for (const p of PROFILES)
        for (const opener of ['film', 'proof'] as const)
          for (const research of [null, RESEARCH]) {
            const out = filmFor(kit, p)
            const m = draftMessages(out, p, LINK, { opener, research })
            const ctx = {
              company: kit.name,
              known: knownFor(out, p),
              link: LINK,
              research: research ? { line: research.line, source: research.source } : null,
            }
            const drafts: [MessageKind, string | { subject: string; body: string }][] = [
              ['note', m.linkedin],
              ['afterAccept', m.afterAccept!],
              ['inmail', m.inmail!],
              ['email', m.email],
              ['followUp', m.followUp],
              ['lastNote', m.lastNote],
              ['linkedinFollowUp', m.linkedinFollowUp],
            ]
            const who = `${p.sender.name}, ${opener} first${research ? ', with research' : ''}`
            for (const [kind, text] of drafts) {
              const checks = checkMessage(kind, text, ctx)
              expect(
                passed(checks),
                `${who}, ${kind}: ${failures(checks)}\n${JSON.stringify(text)}`,
              ).toBe(true)
            }
            expect(Object.values(m.writer).every((w) => w === 'template')).toBe(true)
            expect(m.flags).toEqual({})
          }
    })
})

describe('the connection note has no link and no ask', () => {
  it('never carries a link, a question or a word cut in half, for any fixture or profile', () => {
    for (const kit of KITS)
      for (const p of PROFILES)
        for (const opener of ['film', 'proof'] as const) {
          const note = draftMessages(filmFor(kit, p), p, LINK, { opener }).linkedin
          expect(note).not.toContain('http')
          expect(note).not.toContain('?')
          expect(note.length).toBeLessThanOrEqual(200)
          // ends on the signature or a full sentence, never mid-word
          expect(note, note).toMatch(/(– [A-Z][a-z]+|\.)$/)
          expect(note).toContain(kit.name)
        }
  })

  it('shortens step by step, from the role to the company alone, instead of cutting', () => {
    const p = profile('candidate')
    const long =
      'Senior Staff Platform Reliability and Developer Experience Engineer, Infrastructure'
    const m = draftMessages({ ...out, job: { title: long } } as never, p, LINK)
    expect(m.linkedin).toBe(
      "Hi [First name], I'd like to work with the Parcelpine team and made something for you. Would like to connect. – Alex",
    )
  })

  it('goes to 200 characters with no link for recruiter and hiring films too', () => {
    for (const preset of ['recruiter', 'hiring'] as const) {
      const p = ProfileSchema.parse({
        ...profile('candidate'),
        preset,
        sender: { name: 'Hannah Brooks', role: 'Recruiter', company: 'Parcelpine' },
      })
      const m = draftMessages(out as never, p, LINK)
      expect(m.linkedin.length).toBeLessThanOrEqual(200)
      expect(m.linkedin).not.toContain('http')
      expect(m.linkedin).not.toContain('?')
      expect(m.afterAccept).toContain(LINK)
    }
  })

  it("moves the recruiter's 400-character message into InMail", () => {
    const p = ProfileSchema.parse({
      ...profile('candidate'),
      preset: 'recruiter',
      sender: { name: 'Hannah Brooks', role: 'Recruiter', company: 'Parcelpine' },
    })
    const m = draftMessages(out as never, p, LINK)
    expect(m.inmail?.body).toContain(LINK)
    expect(m.inmail?.body.length).toBeLessThanOrEqual(400)
    expect(m.inmail?.subject).toBe("Parcelpine's Operations Analyst role, made for you")
  })
})

describe('the warm email in five parts', () => {
  const p = profile('candidate')
  const parts = (body: string) => ({
    opening: body.includes('I saw the Operations Analyst role at Parcelpine.'),
    film: body.includes(
      `I made a 30-second film for your Operations Analyst role at Parcelpine:\n${LINK}`,
    ),
    research: body.includes('I read that route planning now reroutes trucks around live traffic'),
    fit: body.includes("What I'd bring: 40% faster month-end close at Initech"),
    ask: body.includes(`\n${p.cta.line}\n`),
  })

  it('has five parts with research and four without, in order, under 125 words', () => {
    const withIt = draftMessages(out as never, p, LINK, { research: RESEARCH }).email.body
    expect(parts(withIt)).toEqual({
      opening: true,
      film: true,
      research: true,
      fit: true,
      ask: true,
    })
    const at = (t: string) => withIt.indexOf(t)
    expect(at('I saw the')).toBeLessThan(at('I made a 30-second'))
    expect(at('I made a 30-second')).toBeLessThan(at('I read'))
    expect(at('I read')).toBeLessThan(at("What I'd bring"))
    expect(at("What I'd bring")).toBeLessThan(at(p.cta.line))

    const without = draftMessages(out as never, p, LINK).email.body
    expect(parts(without)).toEqual({
      opening: true,
      film: true,
      research: false,
      fit: true,
      ask: true,
    })
    expect(without).not.toContain('I read')

    for (const kit of KITS)
      for (const q of PROFILES) {
        const film = filmFor(kit, q)
        const e = draftMessages(film, q, LINK, { research: RESEARCH }).email
        const checks = checkMessage('email', e, {
          company: kit.name,
          known: knownFor(film, q),
          link: LINK,
          research: RESEARCH,
        })
        expect(checks.find((c) => c.rule === 'length')?.ok, e.body).toBe(true)
        // research is the last thing to go, so it stays in every fixture
        expect(e.body).toContain('I read that route planning')
      }
  })

  it("opens on their homepage's promise when there's no job", () => {
    const kit = KITS[0]!
    const q = profile('sales')
    const body = draftMessages(filmFor(kit, q), q, LINK).email.body
    expect(body).toContain(
      'I saw that Northwind Freight leads with "Every pallet, visible before it\'s late".',
    )
  })

  it('leaves out a quote from their site that would add a question or shout', () => {
    const loud = {
      ...out,
      highlights: {
        ...out.highlights,
        quote: { text: 'Ready to ship faster?', source: 'their homepage' },
      },
    }
    const m = draftMessages(loud as never, p, LINK)
    expect(m.email.body).not.toContain('Ready to ship faster')
    expect(m.email.body).toContain('starts from your homepage')
  })
})

describe('follow-ups', () => {
  it('lastNote has no begging, and is easy to answer either way', () => {
    for (const q of [profile('candidate'), profile('sales')]) {
      const m = draftMessages(out as never, q, LINK)
      expect(m.lastNote).not.toContain('grateful')
      expect(m.lastNote).toContain("If the timing isn't right, no problem at all.")
      const lower = m.lastNote.toLowerCase()
      for (const b of BEGGING) expect(lower).not.toContain(b.toLowerCase())
    }
  })
})

describe('addressed to one person', () => {
  it('addressed fills afterAccept and inmail too', () => {
    const m = addressed(draftMessages(out as never, profile('candidate'), LINK), 'Dana Ruiz')
    expect(m.linkedin.startsWith('Hi Dana,')).toBe(true)
    expect(m.afterAccept?.startsWith('Hi Dana,')).toBe(true)
    expect(m.inmail?.body.startsWith('Hi Dana,')).toBe(true)
    // the intro goes to someone else (the person you know there), so it keeps the placeholder
    expect(JSON.stringify({ ...m, intro: '' })).not.toContain('[First name]')
  })
})

/* ------------------------------------------------ hiring films pass the checks too */

describe('hiring films pass the checks', () => {
  // the drafts a hiring film has: the note, the message once they accept and the follow-ups (no InMail)
  for (const kit of KITS.filter((k) => k.job))
    it(`${kit.name}: the note, after-accept and follow-ups`, () => {
      const p = withRole(
        hiringProfile({
          recruiter: { name: 'Hannah Brooks', company: kit.name },
          role: kit.job!.title,
        }),
        kit,
        'https://jobs.example/apply',
      )
      const film = filmFor(kit, p)
      const m = draftMessages(film, p, LINK)
      expect(m.inmail).toBeUndefined()
      const ctx = { company: kit.name, known: knownFor(film, p), link: LINK }
      const drafts: [MessageKind, string][] = [
        ['note', m.linkedin],
        ['afterAccept', m.afterAccept!],
        ['followUp', m.followUp],
        ['lastNote', m.lastNote],
        ['linkedinFollowUp', m.linkedinFollowUp],
      ]
      for (const [kind, text] of drafts) {
        const checks = checkMessage(kind, text, ctx)
        expect(passed(checks), `${kind}: ${failures(checks)}\n${text}`).toBe(true)
      }
    })
})

/* ------------------------------------------------ the research line, said once */

describe('the research line names the post once and ends on a whole clause', () => {
  const xml = readFileSync(join(root, 'fixtures/sites/parcelpine/changelog.xml'), 'utf8')
  const item = parseFeed(xml, 'https://parcelpine.example/').find((i) =>
    i.title.startsWith('Route planning'),
  )!

  it('leaves the title out when the summary already says it ("Route planning…")', () => {
    expect(item.summary).toMatch(/^Route planning now reroutes/)
    const s = researchSentence(item.title, item.summary!)
    expect(s).toBe(
      'I read that route planning now reroutes trucks around live traffic before a delivery runs late, for every lane.',
    )
    expect(s.toLowerCase().split('route planning')).toHaveLength(2)
    const body = draftMessages(out as never, profile('candidate'), LINK, {
      research: { line: item.summary!, source: item.summary!, title: item.title },
    }).email.body
    expect(body.toLowerCase().split('route planning')).toHaveLength(2)
  })

  it('names the post when the summary says something else', () => {
    expect(
      researchSentence(
        'Live traffic, every lane',
        'Trucks now go around jams before a delivery runs late',
      ),
    ).toBe(
      'I read "Live traffic, every lane", and trucks now go around jams before a delivery runs late.',
    )
  })

  it('never ends on the "…" of a cut summary: the last whole clause, or no line at all', () => {
    const cut =
      'Route planning now reroutes trucks around live traffic before a delivery runs late, and drivers see the new stop order on their…'
    expect(wholeClause(cut)).toBe(
      'Route planning now reroutes trucks around live traffic before a delivery runs late',
    )
    expect(wholeClause('Reroutes trucks around…')).toBe('')
    const body = draftMessages(out as never, profile('candidate'), LINK, {
      research: { line: cut, source: cut.replace(/…$/, ''), title: item.title },
    }).email.body
    expect(body).not.toContain('…')
    expect(body).toContain('before a delivery runs late.')
    // still the post's own words
    const checks = checkMessage(
      'email',
      { subject: 's Parcelpine', body },
      {
        company: 'Parcelpine',
        known: knownFor(out as never, profile('candidate')),
        link: LINK,
        research: { line: wholeClause(cut), source: cut.replace(/…$/, '') },
      },
    )
    expect(checks.find((c) => c.rule === 'research_grounded')?.ok).toBe(true)
  })
})

/* ------------------------------------------------ the model's drafts, served */

describe("messagesFor: the model's drafts with the real link, checked again", () => {
  const p = profile('candidate')
  const homework = {
    items: [
      {
        kind: 'changelog' as const,
        title: 'Route planning, now with live traffic',
        url: 'https://parcelpine.example/changelog/route-planning',
        date: '2026-10-28',
        summary:
          'Route planning now reroutes trucks around live traffic before a delivery runs late, for every lane.',
      },
    ],
    pages: [],
  }
  const research =
    'Route planning now reroutes trucks around live traffic before a delivery runs late'
  /** an email of the model's, `extra` words longer than its plainest form */
  const email = (extra = 0) => ({
    subject: 'Dashboards for Parcelpine operations',
    body: [
      'Hi [First name],',
      '',
      'I saw the Operations Analyst role at Parcelpine.',
      '',
      'I made a 30-second film for your Operations Analyst role at Parcelpine:',
      '[film]',
      '',
      `${research}.`,
      '',
      `I build dashboards operations teams use every day${' and keep them running'.repeat(extra / 4)}.`,
      '',
      'Could we find 15 minutes this week?',
      '',
      'Alex Rivera',
      'alex@example.com',
    ].join('\n'),
  })
  const stored = (o: Partial<FilmMessages> = {}): FilmMessages => ({
    drafts: {
      note: 'Hi [First name], I build dashboards for operations teams and made something for Parcelpine. – Alex',
      afterAccept:
        'Hi [First name],\n\nThanks for connecting. I made a 30-second film for Parcelpine: [film]\n\nCould we find 15 minutes this week?\n\nAlex',
      inmail: {
        subject: 'A film for Parcelpine',
        body: 'Hi [First name],\n\nI made a 30-second film for Parcelpine: [film]\n\nCould we find 15 minutes this week?\n\nAlex',
      },
      email: email(),
    },
    writer: { note: 'model', afterAccept: 'model', inmail: 'model', email: 'model' },
    flags: {},
    research: { itemUrl: homework.items[0]!.url, line: research },
    model: 'test',
    rounds: 1,
    firstTry: ['note', 'afterAccept', 'inmail', 'email'],
    ...o,
  })
  const film = (m: FilmMessages | undefined) =>
    ({ ...(out as never as object), homework, messages: m }) as never
  const now = Date.parse('2026-11-03')

  it("swaps in the model's drafts with the real link, and says the model wrote them", () => {
    const m = messagesFor(film(stored()), p, LINK, { opener: 'film', now })
    expect(m.writer).toMatchObject({
      note: 'model',
      afterAccept: 'model',
      inmail: 'model',
      email: 'model',
    })
    expect(m.afterAccept).toContain(LINK)
    expect(m.inmail?.body).toContain(LINK)
    expect(m.email.body).toContain(`:\n${LINK}\n`)
    expect(JSON.stringify(m)).not.toContain('[film]')
    expect(m.flags).toEqual({})
    // the follow-ups stay templates
    expect(m.writer.followUp).toBe('template')
    expect(m.checks.words).toBeGreaterThan(0)
  })

  it('a draft that fell back in the film comes back as a fresh template, with its reasons', () => {
    const why = [
      { rule: 'length' as const, ok: false, why: 'The message is 431 of 400 characters' },
    ]
    const m = messagesFor(
      film(
        stored({
          writer: { note: 'model', afterAccept: 'model', inmail: 'template', email: 'model' },
          flags: { inmail: why },
        }),
      ),
      p,
      LINK,
      { opener: 'film', now },
    )
    expect(m.writer.inmail).toBe('template')
    expect(m.inmail?.body).toContain(LINK)
    expect(m.inmail?.subject).not.toBe('A film for Parcelpine')
    expect(m.flags.inmail).toEqual(why)
  })

  it('checks again with the real link, and falls back when a long one no longer fits', () => {
    const long = `https://share.example/f/${'x'.repeat(420)}`
    const m = messagesFor(film(stored()), p, long, { opener: 'film', now })
    expect(m.writer.afterAccept).toBe('template')
    expect(m.flags.afterAccept?.[0]).toMatchObject({ rule: 'length', ok: false })
    expect(m.flags.afterAccept?.[0]?.why).toMatch(/of 500 characters/)
  })

  it('adds the detail saved after the film as the line after the opening', () => {
    const detail = 'the export to CSV dropped every custom field, so I rebuilt my report by hand'
    const m = messagesFor(film(stored()), p, LINK, { opener: 'film', now, detail })
    expect(m.writer.email).toBe('model')
    expect(m.email.body).toContain(
      "I saw the Operations Analyst role at Parcelpine.\nI've been using Parcelpine, and the export to CSV",
    )
    expect(m.checks.detail).toBe(true)
  })

  it('drops the funding line first, then uses the template (which keeps the detail), each flagged', () => {
    const raised = { date: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10) }
    const words = (b: string) =>
      b
        .split('\n')
        .filter((l) => !l.startsWith('http'))
        .join(' ')
        .split(/\s+/)
        .filter(Boolean).length
    // room for the detail but not the funding line too
    const tight = email(Math.floor((125 - words(email().body.replace('[film]', LINK)) - 6) / 4) * 4)
    const detail = 'I read your post on lanes'
    const kept = messagesFor(
      film(stored({ drafts: { ...stored().drafts, email: tight } })),
      p,
      LINK,
      {
        opener: 'film',
        now,
        detail,
        raised,
      },
    )
    expect(kept.writer.email).toBe('model')
    expect(kept.email.body).toContain('I read your post on lanes.')
    expect(kept.email.body).not.toContain('Congratulations')
    expect(kept.whyNow).toBe(false)
    expect(kept.flags.email?.[0]?.why).toBe('Left out the funding line to stay under 125 words')

    // a detail too long for the model's email: the template comes back with it, and says why
    const long =
      'the export to CSV dropped every custom field across all of our lanes and depots, so I rebuilt the weekly report by hand for the whole team'
    const back = messagesFor(
      film(stored({ drafts: { ...stored().drafts, email: tight } })),
      p,
      LINK,
      {
        opener: 'film',
        now,
        detail: long,
      },
    )
    expect(back.writer.email).toBe('template')
    expect(back.email.body).toContain('the export to CSV dropped every custom field')
    expect(back.flags.email?.[0]?.why).toMatch(
      /^With your saved detail the model's email ran to \d+ of 125 words, so this is the template version, which keeps the detail$/,
    )
  })

  it('keeps the best number in the subject when the film leads with it', () => {
    const m = messagesFor(film(stored()), p, LINK, { opener: 'proof', now })
    expect(m.opener).toBe('proof')
    expect(m.email.subject).toContain('40%')
    expect(m.flags.email?.some((c) => /best number \(40%\)/.test(c.why ?? ''))).toBe(true)
  })

  it('an old film without model drafts gets templates, with the research it had when it was made', () => {
    const m = messagesFor(film(undefined), p, LINK, { opener: 'film', now })
    expect(Object.values(m.writer).every((w) => w === 'template')).toBe(true)
    expect(m.email.body).toContain('I read that route planning now reroutes trucks')
    // a year on, the same film reads the same post only when its own date is used
    const later = messagesFor(film(undefined), p, LINK, {
      opener: 'film',
      now: now + 365 * 86_400_000,
    })
    expect(later.email.body).not.toContain('I read')
  })
})
