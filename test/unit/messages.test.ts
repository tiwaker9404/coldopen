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
  contextFor,
  draftMessages,
  freshRound,
  messagesFor,
  newerPost,
  openerFor,
  researchSentence,
  type SenderHomework,
  wholeClause,
} from '../../src/outreach/messages.ts'
import { jobWordsIn } from '../../src/outreach/voice.ts'
import type { FilmMessages } from '../../src/outreach/writer.ts'
import { hiringProfile, recruiterProfile, withRole } from '../../src/profile/pitch.ts'
import { numbersIn, sameNumber } from '../../src/script/checks.ts'
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
  it("a job seeker's: about their work, the film as a tease, a question and thanks; no job words, no numbers", () => {
    const p = profile('candidate')
    const m = draftMessages(out as never, p, 'https://share.example/f/x')
    expect(m.email.subject).toBe('A question about Parcelpine')
    // no homework and nothing quotable from their homepage (the quote is from the job post)
    expect(
      m.email.body.startsWith(
        "Hi [First name],\n\nI've been reading about what Parcelpine is building.\n\n",
      ),
    ).toBe(true)
    expect(m.email.body).toContain(
      "I put what I'd try next with Parcelpine into a 30-second film:\nhttps://share.example/f/x",
    )
    // this profile has no creator line, and the film has no related project
    expect(m.email.body).not.toContain('I built')
    expect(m.email.body).toContain(
      "One thing I wondered: what's the hardest part of what Parcelpine is building right now? If you ever have 15 minutes, I'd love to hear how you think about it.",
    )
    expect(
      m.email.body.trimEnd().endsWith(`Thanks for reading,\nAlex Rivera\n${p.cta.contact}`),
    ).toBe(true)
    for (const t of [m.email.subject, m.email.body, m.linkedin, m.afterAccept!, m.inmail!.body]) {
      expect(jobWordsIn(t), t).toEqual([])
      // the film shows the proof
      expect(t).not.toContain('40%')
      expect(t).not.toContain('dashboards in daily use')
    }
    expect(m.linkedin).toBe(
      "Hi [First name], I've been reading about what Parcelpine is building and would like to connect. – Alex",
    )
    expect(m.afterAccept).toContain('thanks for connecting')
    expect(m.afterAccept).toContain('https://share.example/f/x')
    expect(m.afterAccept?.trimEnd().endsWith('Thank you for your time,\nAlex')).toBe(true)
    expect(m.inmail?.subject).toContain('Parcelpine')
    expect(m.opener).toBe('homework')
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
  const hw = (o: Partial<SenderHomework>): SenderHomework => ({
    detail: null,
    question: null,
    built: null,
    ...o,
  })

  it('opens with your detail, and checks length, subject, detail and ask', () => {
    const p = profile('candidate')
    const plain = draftMessages(out as never, p, 'https://share.example/f/x')
    expect(plain.checks).toMatchObject({ aboutThem: true, detail: false, oneAsk: true })
    const m = draftMessages(out as never, p, 'https://share.example/f/x', {
      homework: hw({
        detail: 'The one thing I kept hitting was losing a draft when my wifi dropped',
      }),
    })
    expect(m.email.subject).toBe('Notes from using Parcelpine')
    expect(m.email.body).toContain(
      "Hi [First name],\n\nI've been using Parcelpine, and the one thing I kept hitting was losing a draft when my wifi dropped.\n\nI put what I'd try next",
    )
    expect(m.email.body).toContain('One thing I wondered: how do most Parcelpine customers use it?')
    expect(m.checks.detail).toBe(true)
    expect(m.checks.short).toBe(m.checks.words <= 125)
  })

  it('asks your saved question word for word, and leads with what you built', () => {
    const p = profile('candidate')
    const question =
      'Are most of your customers calling the API directly, or going through the Shopify app?'
    const m = draftMessages(out as never, p, 'https://share.example/f/x', {
      homework: hw({
        detail: 'the rate API saved me a spreadsheet',
        question,
        built: {
          url: 'https://github.com/alex/rates',
          line: 'A carrier rate comparer on your API',
        },
      }),
    })
    expect(m.email.subject).toBe('Something I built with Parcelpine')
    expect(m.email.body).toContain(
      'I built something small with Parcelpine: a carrier rate comparer on your API (https://github.com/alex/rates).',
    )
    expect(m.email.body.toLowerCase()).toContain(question.toLowerCase())
    expect(m.afterAccept).toContain(question)
    expect(m.inmail?.body).toContain(question)
    // the note leads with the build too, without its link
    expect(m.linkedin).toContain('I built something small with Parcelpine: a carrier rate comparer')
    expect(m.linkedin).not.toContain('http')
    expect(m.checks.detail).toBe(true)
  })

  it('says you built the tool that made the film, when you did', () => {
    const p = ProfileSchema.parse({
      ...profile('candidate'),
      creator: {
        name: 'coldopen',
        url: 'https://tiwaker9404.github.io/coldopen/',
        line: 'An open-source agent that turns a site into a short on-brand pitch',
      },
    })
    const m = draftMessages(out as never, p, 'https://share.example/f/x')
    expect(m.email.body).toContain(
      'I built the tool that made it, coldopen: an open-source agent that turns a site into a short on-brand pitch.',
    )
    // the creator line takes the related project's place
    expect(m.email.body).not.toContain("Something I built that's close")
    // a creator line that says "film" again keeps only the name, so the film is named once
    const filmy = ProfileSchema.parse({
      ...p,
      creator: {
        ...p.creator!,
        line: "Paste a company's website, get a 30-second film made for them",
      },
    })
    const f = draftMessages(out as never, filmy, 'https://share.example/f/x')
    expect(f.email.body).toContain('I built the tool that made it, coldopen.\n')
  })

  it('brings something new to the one follow-up when there is something', () => {
    const p = profile('candidate')
    const m = draftMessages(out as never, p, 'https://share.example/f/x', {
      fresh: 'Trusted by 4,000 shippers',
    })
    expect(m.followUp).toContain(
      `One more thing I noticed since I wrote: Parcelpine's site says "Trusted by 4,000 shippers".`,
    )
    expect(m.followUp).not.toContain('Writing once more')
    expect(m.followUp).toContain('Thanks either way,')
    const newer = draftMessages(out as never, p, 'https://share.example/f/x', {
      newer: { title: 'Returns, now with QR drop-off', line: 'QR drop-off is live' },
    })
    expect(newer.followUp).toContain(
      'I just read your newer post, "Returns, now with QR drop-off".',
    )
    // nothing new: one plain note, then let it go
    const plain = draftMessages(out as never, p, 'https://share.example/f/x')
    expect(plain.followUp).toContain('Writing once more in case this got buried.')
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

  it("splits a job seeker's films between their homework and their question, on the same hash", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `film_${i.toString(36)}x${i * 7}`)
    for (const id of ids)
      expect(openerFor(id, 'candidate')).toBe(openerFor(id) === 'film' ? 'homework' : 'question')
    expect(openerFor('abc', 'sales')).toBe(openerFor('abc'))
  })

  it('the question opener asks first; the homework opener shows the homework first', () => {
    const p = profile('candidate')
    const homework = {
      detail: 'I tried the rate API to compare two carriers',
      question: 'Are most of your customers calling the API directly?',
      built: null,
    }
    const q = draftMessages(out as never, p, LINK, { homework, opener: 'question' })
    expect(q.opener).toBe('question')
    expect(q.email.body).toContain(
      "Hi [First name],\n\nI've had one question about Parcelpine in mind: are most of your customers calling the API directly?\n\nI tried the rate API",
    )
    expect(q.email.body).toContain(
      "If you ever have 15 minutes, I'd love to hear how you think about it.\n\nThanks for reading,",
    )
    const h = draftMessages(out as never, p, LINK, { homework, opener: 'homework' })
    expect(h.opener).toBe('homework')
    expect(h.email.body.startsWith('Hi [First name],\n\nI tried the rate API')).toBe(true)
    // a stored opener from before (film or proof) reads as the homework one
    expect(draftMessages(out as never, p, LINK, { homework, opener: 'proof' }).opener).toBe(
      'homework',
    )
  })

  it("leads a seller's email with your best number, keeping the subject about them", () => {
    const p = profile('sales')
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

/** The sender's homework, every way they can save it (or not) */
const HOMEWORK: [string, SenderHomework | null][] = [
  ['no homework', null],
  [
    'a detail',
    {
      detail: 'the export to CSV kept every custom field, which saved me a report',
      question: null,
      built: null,
    },
  ],
  [
    'something built',
    {
      detail: null,
      question: null,
      built: {
        url: 'https://github.com/alex/small-build',
        line: 'A tiny dashboard on their public API',
      },
    },
  ],
  [
    'a question',
    {
      detail: null,
      question: 'Which part of the product do new customers set up first?',
      built: null,
    },
  ],
  [
    'all three',
    {
      detail: 'I tried the docs quickstart and had it running in an afternoon',
      question: 'Do most customers start from the quickstart or a sales call?',
      built: {
        url: 'https://github.com/alex/small-build',
        line: 'A tiny dashboard on their public API',
      },
    },
  ],
]
const CREATOR = {
  name: 'coldopen',
  url: 'https://tiwaker9404.github.io/coldopen/',
  line: "Paste a company's website, get a 30-second film made for them",
}
/** The research post, as the site's feed has it: messagesFor picks it the way a film does */
const POSTS = {
  items: [
    {
      kind: 'changelog' as const,
      title: RESEARCH.title,
      url: 'https://example.com/changelog/route-planning',
      date: '2026-10-28',
      summary: RESEARCH.source,
    },
  ],
  pages: [],
}
const NOW = Date.parse('2026-11-03')

/** The proof values a draft says, ignoring its link, placeholders, the film's length and the 15 minutes */
const proofSaid = (text: string, proof: string[]) => {
  const said = numbersIn(
    text
      .replaceAll(LINK, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/\b30[\s-]*second\b/g, ' ')
      .replace(/\b\d+[\s-]*min(ute)?s?\b/gi, ' '),
  )
  return proof.filter((v) => numbersIn(v).some((n) => said.some((x) => sameNumber(x, n))))
}

describe('every template passes the checks', () => {
  it('has fixture films and example profiles to check', () => {
    expect(KITS).toHaveLength(6)
    expect(PROFILES.length).toBeGreaterThanOrEqual(8)
  })

  // one case per fixture film, over every profile, both openers and with and without research;
  // a job seeker's also with every kind of homework, with and without a creator line, and checked
  // in the voice, through messagesFor as the API serves them
  for (const kit of KITS)
    it(`${kit.name}${kit.job ? ', with its job' : ''}: every draft, for every profile`, () => {
      for (const base of PROFILES) {
        const seeker = base.preset === 'candidate'
        const profiles = seeker
          ? [base, ProfileSchema.parse({ ...base, creator: CREATOR })]
          : [base]
        for (const p of profiles)
          for (const opener of seeker
            ? (['homework', 'question'] as const)
            : (['film', 'proof'] as const))
            for (const research of [null, RESEARCH])
              for (const [what, hw] of seeker ? HOMEWORK : HOMEWORK.slice(0, 1)) {
                const film = { ...filmFor(kit, p), ...(research ? { homework: POSTS } : {}) }
                const m = seeker
                  ? messagesFor(film, p, LINK, {
                      opener,
                      now: NOW,
                      ...(hw ? { homework: hw } : {}),
                    })
                  : draftMessages(film, p, LINK, { opener, research })
                const ctx = {
                  ...(seeker
                    ? contextFor(film, p, LINK, hw)
                    : { company: kit.name, known: knownFor(film, p), link: LINK }),
                  research: research
                    ? { line: seeker ? RESEARCH.source : RESEARCH.line, source: RESEARCH.source }
                    : null,
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
                const who = `${p.sender.name}${p.creator ? ' (creator)' : ''}, ${opener} first${research ? ', with research' : ''}, ${what}`
                for (const [kind, text] of drafts) {
                  const checks = checkMessage(kind, text, ctx)
                  expect(
                    passed(checks),
                    `${who}, ${kind}: ${failures(checks)}\n${JSON.stringify(text)}`,
                  ).toBe(true)
                  // the email says "film" once, in its film line
                  if (kind === 'email') expect(checks.map((c) => c.rule)).toContain('film_once')
                  if (seeker) {
                    // no candidate draft has a job word or a number the film shows
                    const all = typeof text === 'string' ? text : `${text.subject}\n${text.body}`
                    expect(jobWordsIn(all), `${who}, ${kind}: ${all}`).toEqual([])
                    expect(proofSaid(all, ctx.proof ?? []), `${who}, ${kind}: ${all}`).toEqual([])
                  }
                }
                if (seeker) {
                  for (const t of [m.intro, m.forward ?? ''])
                    expect(jobWordsIn(t), `${who}, intro: ${t}`).toEqual([])
                  // the email asks the saved question when there is one
                  if (hw?.question)
                    expect(m.email.body.toLowerCase(), who).toContain(hw.question.toLowerCase())
                  expect(m.opener).toBe(opener)
                }
                expect(Object.values(m.writer).every((w) => w === 'template')).toBe(true)
                expect(m.flags).toEqual({})
              }
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

  it('shortens step by step, from your detail and a curious line to their work alone, instead of cutting', () => {
    const p = profile('candidate')
    const note = (detail: string) =>
      draftMessages(out as never, p, LINK, { homework: { detail, question: null, built: null } })
        .linkedin
    // room for the detail and the curious line
    expect(note('the rate API saved me a spreadsheet')).toBe(
      "Hi [First name], I've been using Parcelpine, and the rate API saved me a spreadsheet. Curious how most Parcelpine customers use it. – Alex",
    )
    // room for the detail alone
    const mid =
      'the per-zone breakdown in the rate API saved me a whole spreadsheet when I compared two carriers for a side project'
    expect(note(mid)).toBe(`Hi [First name], I've been using Parcelpine, and ${mid}. – Alex`)
    // a detail too long for a note: their work, in a whole sentence
    const long = `${mid}, and the docs for the webhook retries were clearer than most I've read this year`
    expect(note(long)).toBe(
      "Hi [First name], I've been reading about what Parcelpine is building and would like to connect. – Alex",
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

describe("a seller's warm email in five parts", () => {
  const p = profile('sales')
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
      for (const q of PROFILES.filter((x) => x.preset === 'sales')) {
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

describe("a job seeker's email in the voice", () => {
  const p = profile('candidate')
  const homework = {
    detail: 'I tried the rate API to compare two carriers for a side project',
    question: 'Are most of your customers calling the API directly?',
    built: null,
  }

  it('runs homework, film, built, question and offer, thanks: in that order, under 125 words', () => {
    const film = {
      ...out,
      related: {
        name: 'integration-triage',
        url: 'https://github.com/a/it',
        line: 'Diagnoses failing API calls',
      },
    }
    const body = draftMessages(film as never, p, LINK, { homework }).email.body
    const at = (t: string) => body.indexOf(t)
    for (const t of [
      homework.detail,
      "I put what I'd try next",
      "Something I built that's close",
      'One thing I wondered',
      'If you ever have 15 minutes',
      'Thanks for reading,',
    ])
      expect(at(t), t).toBeGreaterThan(0)
    expect(at(homework.detail)).toBeLessThan(at("I put what I'd try next"))
    expect(at("I put what I'd try next")).toBeLessThan(at("Something I built that's close"))
    expect(at("Something I built that's close")).toBeLessThan(at('One thing I wondered'))
    expect(at('One thing I wondered')).toBeLessThan(at('If you ever have 15 minutes'))
    expect(at('If you ever have 15 minutes')).toBeLessThan(at('Thanks for reading,'))
  })

  it("leads with their latest post when you haven't saved homework, on every fixture", () => {
    for (const kit of KITS)
      for (const q of PROFILES.filter((x) => x.preset === 'candidate')) {
        const film = filmFor(kit, q)
        const e = draftMessages(film, q, LINK, { research: RESEARCH }).email
        expect(e.body, e.body).toContain('Hi [First name],\n\nI read that route planning')
        // the post is named once: the tease and the question don't quote its title again
        expect(e.body.toLowerCase().split('route planning')).toHaveLength(2)
        // and the subject is about it
        expect(e.subject).toBe(`${kit.name}'s route planning, now with live traffic`)
      }
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
    expect(m.email.body).toContain("I've been reading about what Parcelpine is building.")
  })

  it('leaves out a saved line that would break a rule, rather than editing it', () => {
    // their own words, but a job word: the draft opens on their work instead
    const m = draftMessages(out as never, p, LINK, {
      homework: { detail: 'I saw the opening on your careers page', question: null, built: null },
    })
    expect(m.email.body).not.toContain('careers page')
    expect(jobWordsIn(m.email.body)).toEqual([])
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

describe("a job seeker's one follow-up brings a newer post", () => {
  const item = (title: string, date: string, kind: 'blog' | 'news' = 'blog') => ({
    kind,
    title,
    url: `https://example.com/${title.toLowerCase().replace(/\W+/g, '-')}`,
    date,
    summary: `${title}, explained.`,
  })
  const read = item('Route planning, now with live traffic', '2026-10-28')
  const posts = {
    // the email reads the blog post (news ranks below it), so the newer news item is new to them
    items: [
      read,
      item('Older notes', '2026-10-01'),
      item('QR drop-off is live', '2026-11-01', 'news'),
    ],
    pages: [],
  }
  const now = Date.parse('2026-11-03')

  it('picks the newest post after the one the email read, never the same one', () => {
    expect(newerPost(posts, read, now)?.title).toBe('QR drop-off is live')
    expect(newerPost({ ...posts, items: [read] }, read, now)).toBeNull()
    // the email read nothing: the newest one
    expect(newerPost(posts, null, now)?.title).toBe('QR drop-off is live')
    // nothing from the future
    expect(newerPost(posts, read, Date.parse('2026-10-30'))).toBeNull()
  })

  it('messagesFor puts it in the follow-up', () => {
    const m = messagesFor(
      { ...(out as never as object), homework: posts } as never,
      profile('candidate'),
      LINK,
      { now },
    )
    expect(m.email.body).toContain('I read that route planning, now with live traffic, explained.')
    expect(m.followUp).toContain('I just read your newer post, "QR drop-off is live".')
    expect(m.linkedinFollowUp).toContain('QR drop-off is live')
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

/* ------------------------------------------------ recruiter and hiring films pass the checks too */

/** A Pitch a role profile, as the recruiter makes it: the candidate's résumé, the recruiter's company */
const recruiterFor = (kit: BrandKit) =>
  recruiterProfile({
    candidateText: readFileSync(join(root, 'fixtures/resumes/priya-analyst.md'), 'utf8'),
    recruiter: { name: 'Hannah Brooks', company: kit.name, contact: 'hannah@example.com' },
    ...(kit.job ? { role: kit.job.title } : {}),
  })

/** Every draft a preset's film has: a hiring film has no InMail */
function draftsOf(m: ReturnType<typeof draftMessages>) {
  const drafts: [MessageKind, string | { subject: string; body: string }][] = [
    ['note', m.linkedin],
    ['afterAccept', m.afterAccept!],
    ...(m.inmail ? [['inmail', m.inmail] as [MessageKind, { subject: string; body: string }]] : []),
    ['email', m.email],
    ['followUp', m.followUp],
    ['lastNote', m.lastNote],
    ['linkedinFollowUp', m.linkedinFollowUp],
  ]
  return drafts
}

describe('recruiter and hiring templates pass the checks', () => {
  for (const kit of KITS)
    it(`${kit.name}${kit.job ? ', with its job' : ''}: every recruiter and hiring draft`, () => {
      const presets: [string, Profile][] = [
        ['recruiter', recruiterFor(kit)],
        // without the candidate's name, the drafts keep the placeholder
        ['recruiter, no name', ProfileSchema.parse({ ...recruiterFor(kit), recipient: undefined })],
        [
          'hiring',
          withRole(
            hiringProfile({
              recruiter: { name: 'Hannah Brooks', company: kit.name },
              ...(kit.job ? { role: kit.job.title } : {}),
            }),
            kit,
            'https://jobs.example/apply',
          ),
        ],
      ]
      for (const [who, p] of presets) {
        const film = filmFor(kit, p)
        const m = draftMessages(film, p, LINK)
        const company = p.sender.company ?? kit.name
        expect(p.preset, who).toBe(who.split(',')[0])
        if (p.preset === 'hiring') expect(m.inmail).toBeUndefined()
        else expect(m.inmail).toBeDefined()
        const ctx = { company, known: knownFor(film, p), link: LINK }
        for (const [kind, text] of draftsOf(m)) {
          const checks = checkMessage(kind, text, ctx)
          expect(
            passed(checks),
            `${who}, ${kind}: ${failures(checks)}\n${JSON.stringify(text)}`,
          ).toBe(true)
          const all = typeof text === 'string' ? text : `${text.subject}\n${text.body}`
          expect(all, `${who}, ${kind}`).not.toContain('!')
          for (const b of BEGGING) expect(all.toLowerCase()).not.toContain(b.toLowerCase())
        }
      }
    })

  it("the recruiter's last note ends easy either way, without asking a favor", () => {
    const p = recruiterFor(KITS[5]!)
    expect(p.preset).toBe('recruiter')
    const m = draftMessages(out as never, p, LINK)
    expect(m.lastNote).not.toContain('grateful')
    expect(m.lastNote).toContain("If the timing isn't right, no problem at all.")
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
  // a seller's drafts: how a stored model draft is served (a job seeker's are checked in the voice too, below)
  const p = profile('sales')
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
      'Maya Chen',
      'maya@example.com',
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
  const hw = (detail: string): SenderHomework => ({ detail, question: null, built: null })

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
    expect(m.notes).toEqual({})
    // the follow-ups stay templates
    expect(m.writer.followUp).toBe('template')
    expect(m.checks.words).toBeGreaterThan(0)
  })

  it('an email that fails on its own falls back with its flags and no notes', () => {
    const shouty = { ...email(), body: email().body.replace('this week?', 'this week?!') }
    const m = messagesFor(
      film(stored({ drafts: { ...stored().drafts, email: shouty } })),
      p,
      LINK,
      { opener: 'film', now },
    )
    expect(m.writer.email).toBe('template')
    expect(m.flags.email?.map((c) => c.rule)).toEqual(['no_exclamation'])
    expect(m.notes?.email).toBeUndefined()
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
    const m = messagesFor(film(stored()), p, LINK, { opener: 'film', now, homework: hw(detail) })
    expect(m.writer.email).toBe('model')
    expect(m.email.body).toContain(
      "I saw the Operations Analyst role at Parcelpine.\nI've been using Parcelpine, and the export to CSV",
    )
    expect(m.checks.detail).toBe(true)
  })

  it('drops the funding line first (a note, not a flag), then uses the template, which keeps the detail', () => {
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
        homework: hw(detail),
        raised,
      },
    )
    expect(kept.writer.email).toBe('model')
    expect(kept.email.body).toContain('I read your post on lanes.')
    expect(kept.email.body).not.toContain('Congratulations')
    expect(kept.whyNow).toBe(false)
    // a kept draft that code changed has notes and no flags
    expect(kept.flags.email).toBeUndefined()
    expect(kept.notes?.email).toEqual(['Left out the funding line to stay under 125 words'])

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
        homework: hw(long),
      },
    )
    expect(back.writer.email).toBe('template')
    expect(back.email.body).toContain('the export to CSV dropped every custom field')
    // both: the check the model's email failed, and what code did about it
    expect(back.flags.email).toHaveLength(1)
    expect(back.flags.email?.[0]).toMatchObject({ rule: 'length', ok: false })
    expect(back.flags.email?.[0]?.why).toMatch(/^\d+ of 125 words$/)
    expect(back.notes?.email).toHaveLength(1)
    expect(back.notes?.email?.[0]).toMatch(
      /^With your saved detail the model's email ran to \d+ of 125 words, so this is the template version, which keeps the detail$/,
    )
  })

  it('keeps the best number in the subject when the film leads with it', () => {
    const m = messagesFor(film(stored()), p, LINK, { opener: 'proof', now })
    expect(m.opener).toBe('proof')
    expect(m.email.subject).toContain('40%')
    expect(m.writer.email).toBe('model')
    expect(m.flags.email).toBeUndefined()
    expect(m.notes?.email?.some((n) => /best number \(40%\)/.test(n))).toBe(true)
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

describe("messagesFor: a job seeker's drafts are checked in the voice", () => {
  const p = profile('candidate')
  const now = Date.parse('2026-11-03')
  const homework = { items: [], pages: [] }
  const saved: SenderHomework = {
    detail: 'I tried the rate API to compare two carriers for a side project',
    question: 'Are most of your customers calling the API directly?',
    built: null,
  }
  // a voice draft of the model's, as step 3 will write them
  const voiceDrafts = (): FilmMessages['drafts'] => ({
    note: 'Hi [First name], I tried the Parcelpine rate API to compare two carriers. Curious how most teams use it. – Alex',
    afterAccept:
      "Hi [First name], thanks for connecting.\n\nI tried the rate API to compare two carriers for a side project.\n\nI put what I'd try next with Parcelpine into a 30-second film: [film]\n\nAre most of your customers calling the API directly?\n\nThank you for your time,\nAlex",
    inmail: {
      subject: 'The Parcelpine rate API',
      body: "Hi [First name],\n\nI tried the rate API to compare two carriers for a side project.\n\nI put what I'd try next with Parcelpine into a 30-second film: [film]\n\nAre most of your customers calling the API directly?\n\nThank you for your time,\nAlex",
    },
    email: {
      subject: 'The Parcelpine rate API',
      body: [
        'Hi [First name],',
        '',
        'I tried the rate API to compare two carriers for a side project.',
        '',
        "I put what I'd try next with Parcelpine into a 30-second film:",
        '[film]',
        '',
        "One thing I wondered: are most of your customers calling the API directly? If you ever have 15 minutes, I'd love to hear how you think about it.",
        '',
        'Thanks for reading,',
        'Alex Rivera',
        'alex@example.com',
      ].join('\n'),
    },
  })
  const stored = (drafts: FilmMessages['drafts']): FilmMessages => ({
    drafts,
    writer: { note: 'model', afterAccept: 'model', inmail: 'model', email: 'model' },
    flags: {},
    research: null,
    model: 'test',
    rounds: 1,
    firstTry: ['note', 'afterAccept', 'inmail', 'email'],
  })
  const film = (m: FilmMessages) =>
    ({ ...(out as never as object), homework, messages: m }) as never

  it('keeps a model draft that passes the voice checks, word for word', () => {
    const m = messagesFor(film(stored(voiceDrafts())), p, LINK, { homework: saved, now })
    expect(m.writer).toMatchObject({
      note: 'model',
      afterAccept: 'model',
      inmail: 'model',
      email: 'model',
    })
    expect(m.flags).toEqual({})
    // the homework isn't added a second time: the model's opening is the homework
    expect(m.email.body.split('I tried the rate API')).toHaveLength(2)
  })

  it('sends a draft from before the voice back to the template, with the reasons', () => {
    const old = voiceDrafts()
    old.email = {
      subject: 'A 30-second film for Parcelpine',
      body: old.email.body
        .replace(
          'I tried the rate API to compare two carriers for a side project.',
          'I saw the Operations Analyst role at Parcelpine. 40% faster month-end close at Initech.',
        )
        .replace('\nThanks for reading,', ''),
    }
    old.afterAccept = old.afterAccept.replace('Thank you for your time,\n', '')
    const m = messagesFor(film(stored(old)), p, LINK, { homework: saved, now })
    expect(m.writer.email).toBe('template')
    expect(m.flags.email?.map((c) => c.rule)).toEqual(
      expect.arrayContaining(['not_job_pitch', 'thanks', 'no_proof_numbers']),
    )
    expect(m.writer.afterAccept).toBe('template')
    expect(m.flags.afterAccept?.map((c) => c.rule)).toEqual(['thanks'])
    // what's served is the warm template, with the saved question word for word
    expect(m.email.body.toLowerCase()).toContain(saved.question!.toLowerCase())
    expect(jobWordsIn(`${m.email.subject}\n${m.email.body}`)).toEqual([])
  })

  it("a model draft that claims an experience the homework doesn't say falls back", () => {
    const made = voiceDrafts()
    made.email = {
      ...made.email,
      body: made.email.body.replace(
        'I tried the rate API to compare two carriers for a side project.',
        'I used Parcelpine to run returns for my store for a year.',
      ),
    }
    const m = messagesFor(film(stored(made)), p, LINK, { homework: saved, now })
    expect(m.writer.email).toBe('template')
    expect(m.flags.email?.map((c) => c.rule)).toEqual(['homework_grounded'])
  })
})

/* ------------------------------------------------ other presets keep their voice */

describe('sales, recruiter and hiring templates are unchanged', () => {
  // taken before the candidate voice changed (batch 4, step 2): only candidate drafts move
  it('sales templates are unchanged, for every fixture, opener, research and detail', async () => {
    const all: Record<string, unknown> = {}
    const sales = PROFILES.filter((p) => p.preset === 'sales')
    expect(sales.length).toBeGreaterThan(0)
    for (const kit of KITS)
      for (const p of sales)
        for (const opener of ['film', 'proof'] as const)
          for (const research of [null, RESEARCH])
            for (const detail of [null, 'I read your post on lanes'])
              for (const fresh of [null, 'Trusted by 4,000 shippers']) {
                const key = [kit.name, kit.job ? 'job' : '-', p.sender.name, opener]
                  .concat(research ? 'research' : '-', detail ? 'detail' : '-')
                  .concat(fresh ? 'fresh' : '-')
                  .join(' | ')
                all[key] = draftMessages(filmFor(kit, p), p, LINK, {
                  opener,
                  research,
                  ...(detail ? { homework: { detail, question: null, built: null } } : {}),
                  ...(fresh ? { fresh } : {}),
                })
              }
    await expect(`${JSON.stringify(all, null, 2)}\n`).toMatchFileSnapshot(
      '__snapshots__/sales-templates.json',
    )
  })

  it('recruiter and hiring templates are unchanged', async () => {
    const all: Record<string, unknown> = {}
    for (const kit of KITS) {
      const hiring = withRole(
        hiringProfile({
          recruiter: { name: 'Hannah Brooks', company: kit.name },
          ...(kit.job ? { role: kit.job.title } : {}),
        }),
        kit,
        'https://jobs.example/apply',
      )
      for (const [who, p] of [
        ['recruiter', recruiterFor(kit)],
        ['hiring', hiring],
      ] as const)
        all[`${kit.name} | ${kit.job ? 'job' : '-'} | ${who}`] = draftMessages(
          filmFor(kit, p),
          p,
          LINK,
        )
    }
    await expect(`${JSON.stringify(all, null, 2)}\n`).toMatchFileSnapshot(
      '__snapshots__/recruiter-hiring-templates.json',
    )
  })
})
