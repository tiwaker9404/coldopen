import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Homework, parseFeed } from '../../src/brand/homework.ts'
import type { BrandKit } from '../../src/brand/types.ts'
import { ScriptedProvider } from '../../src/llm/scripted.ts'
import type { ChatMessage } from '../../src/llm/types.ts'
import { checkMessage, knownFor, passed } from '../../src/outreach/checks.ts'
import {
  assemble,
  briefFor,
  buildMessagePrompt,
  FILM,
  LINK_ROOM,
  type MessageFilm,
  MessagesSchema,
  type ModelMessages,
  promptTokens,
  researchSource,
  scriptedMessages,
  writeMessages,
} from '../../src/outreach/writer.ts'
import { LocalContext } from '../../src/runtime/local.ts'
import { buildStoryboard } from '../../src/script/storyboard.ts'
import { deterministicScript } from '../../src/script/writer.ts'
import { profile } from '../helpers/index.ts'

/** The day the fixture changelog is read on: its dates are fixed, so the pick never drifts */
const NOW = Date.parse('2026-11-03T12:00:00Z')
const LATER = Date.parse('2027-06-01T00:00:00Z')

const HOMEWORK: Homework = {
  items: parseFeed(
    readFileSync(
      join(import.meta.dirname, '../../fixtures/sites/parcelpine/changelog.xml'),
      'utf8',
    ),
    'http://127.0.0.1/',
  ).map((i) => ({ kind: 'changelog' as const, ...i })),
  pages: [],
}

const REQS = ['Improve route planning and delivery times', 'Write SQL that operations teams use']
const KIT = {
  name: 'Parcelpine',
  host: 'parcelpine.example',
  headline: 'Returns that keep the customer.',
  description: 'Parcelpine turns returns into exchanges for Shopify brands.',
  job: { title: 'Operations Analyst', url: 'https://jobs.example/parcelpine' },
  facts: [
    { id: 'f1', text: 'Returns that keep the customer.', kind: 'headline' },
    { id: 'f2', text: '61% of returns become exchanges or store credit', kind: 'stat' },
    ...REQS.map((text, i) => ({ id: `j${i + 1}`, text, kind: 'requirement' })),
  ],
} as unknown as BrandKit

const candidate = profile('candidate')

/** What film.ts hands the writer for the Parcelpine fixture, answering its job post */
function filmFor(kit = KIT, p = candidate): MessageFilm {
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
          ? { text: insight.text, source: insight.source }
          : {
              text: '',
              source: '',
            },
      proof: proof?.kind === 'proof' ? proof.stats : [],
    },
    requirements: kit.job ? REQS : [],
  }
}

const film = filmFor()
const item = HOMEWORK.items[0]!
/** A careful model's reply: the stand-in writer, from the brief the prompt carries */
const good = (opener: 'film' | 'proof' = 'film', research = true): ModelMessages =>
  scriptedMessages(briefFor(film, candidate, research ? item : null, opener))

/** A model that answers each round with the next reply, recording what it was sent */
function model(...replies: ModelMessages[]) {
  const sent: ChatMessage[][] = []
  return {
    sent,
    complete: async (_key: string, messages: ChatMessage[]) => {
      sent.push(messages)
      return replies[Math.min(sent.length, replies.length) - 1]!
    },
  }
}

const write = (
  complete: ReturnType<typeof model>['complete'],
  o: { now?: number; opener?: 'film' | 'proof' } = {},
) =>
  writeMessages({
    film,
    profile: candidate,
    homework: HOMEWORK,
    opener: o.opener ?? 'film',
    model: 'test-model',
    now: o.now ?? NOW,
    complete,
  })

describe('assembling a model draft', () => {
  it('adds the greeting, the link and the signature, and never a link in the note', () => {
    const d = assemble(good(), film, candidate, LINK_ROOM, { opener: 'film', research: true })
    expect(d.note.startsWith('Hi [First name], ')).toBe(true)
    expect(d.note.endsWith(' – Alex')).toBe(true)
    expect(d.note).not.toContain(LINK_ROOM)
    expect(d.afterAccept.startsWith('Hi [First name],\n\n')).toBe(true)
    expect(d.afterAccept.split(LINK_ROOM)).toHaveLength(2)
    expect(d.inmail.body.split(LINK_ROOM)).toHaveLength(2)
    expect(d.email.body).toContain(
      `I made a 30-second film for your Operations Analyst role at Parcelpine:\n${LINK_ROOM}`,
    )
    expect(d.email.body.endsWith('Alex Rivera\nalex@example.com')).toBe(true)
  })

  it('lays the email out in five parts with research, and four without', () => {
    const paragraphs = (body: string) => body.split('\n\n').length
    const five = assemble(good(), film, candidate, FILM, { opener: 'film', research: true })
    const four = assemble(good('film', false), film, candidate, FILM, {
      opener: 'film',
      research: false,
    })
    // greeting, opening, film, research, fit, ask, signature
    expect(paragraphs(five.email.body)).toBe(7)
    expect(paragraphs(four.email.body)).toBe(6)
    expect(five.email.body).toContain('Your post says route planning now reroutes trucks')
    expect(four.email.body).not.toContain('Your post says')
  })

  it('never takes a research line when there is no post to ground it in', () => {
    const invented = { ...good(), email: { ...good().email, research: 'You just raised 40M' } }
    const d = assemble(invented, film, candidate, FILM, { opener: 'film', research: false })
    expect(d.email.body).not.toContain('raised')
  })
})

describe('the model writes the messages, and code checks them', () => {
  it('keeps every draft a careful model writes, in one round', async () => {
    const m = model(good())
    const r = await write(m.complete)
    expect(r.writer).toEqual({
      note: 'model',
      afterAccept: 'model',
      inmail: 'model',
      email: 'model',
    })
    expect(r.flags).toEqual({})
    expect(r.rounds).toBe(1)
    expect(m.sent).toHaveLength(1)
    expect(r.firstTry).toEqual(['note', 'afterAccept', 'inmail', 'email'])
    // stored with the placeholders, for the API to fill in
    expect(r.drafts.afterAccept).toContain(FILM)
    expect(r.drafts.email.body).toContain(`\n${FILM}\n`)
    expect(r.model).toBe('test-model')
  })

  it('sends a 230-character note back once with the reason, then uses the template note', async () => {
    const long = { ...good(), note: `I'm applying at Parcelpine. ${'x'.repeat(200)}` }
    const m = model(long, long)
    const r = await write(m.complete)
    expect(m.sent).toHaveLength(2)
    const revise = m.sent[1]!.at(-1)!.content
    expect(revise).toMatch(/^Revise note\./)
    expect(revise).toMatch(/- note: \d+ of 200 characters/)
    expect(r.writer.note).toBe('template')
    expect(r.flags.note?.map((c) => c.rule)).toEqual(['length'])
    expect(r.drafts.note).toMatch(
      /^Hi \[First name\], I'm applying for the Operations Analyst role/,
    )
    // the other drafts were fine the first time and stay the model's
    expect(r.writer.email).toBe('model')
    expect(r.writer.afterAccept).toBe('model')
    expect(r.firstTry).not.toContain('note')
  })

  it('keeps a draft the model fixes on the second round', async () => {
    const long = { ...good(), note: `I'm applying at Parcelpine. ${'x'.repeat(200)}` }
    const m = model(long, good())
    const r = await write(m.complete)
    expect(r.rounds).toBe(2)
    expect(r.writer.note).toBe('model')
    expect(r.flags).toEqual({})
  })

  it('falls back for an email that claims "cut churn 30%", and only for that draft', async () => {
    const reply = good()
    const bad = { ...reply, email: { ...reply.email, fit: 'At my last job I cut churn 30%.' } }
    const r = await write(model(bad, bad).complete)
    expect(r.writer.email).toBe('template')
    expect(r.flags.email?.[0]).toMatchObject({ rule: 'grounded', ok: false })
    expect(r.flags.email?.[0]?.why).toMatch(/"30%"/)
    expect(r.writer.note).toBe('model')
    expect(r.writer.inmail).toBe('model')
    expect(r.drafts.email.body).not.toContain('30%')
  })

  it('catches begging, a second question and a missing link in the model drafts', async () => {
    const reply = good()
    const bad: ModelMessages = {
      ...reply,
      afterAccept: 'Thanks for connecting, Parcelpine. Could you refer me to the hiring manager?',
      inmail: { ...reply.inmail, body: `Parcelpine film: ${FILM} Free this week? Or next?` },
    }
    const r = await write(model(bad, bad).complete)
    expect(r.flags.afterAccept?.map((c) => c.rule)).toEqual(
      expect.arrayContaining(['no_begging', 'has_link']),
    )
    expect(r.flags.inmail?.map((c) => c.rule)).toEqual(['one_ask'])
  })

  it('leads with the best number when the film opens with proof, even if the model forgot to', async () => {
    const prompt = buildMessagePrompt(film, candidate, item, 'proof')[1]!.content
    expect(prompt).toContain(
      "Lead the email's opening with the sender's best number: 6 open-source",
    )
    const r = await write(model(good('proof')).complete, { opener: 'proof' })
    const opening = r.drafts.email.body.split('\n\n')[1]!
    expect(opening).toBe(
      'I saw the Operations Analyst role at Parcelpine. 6 open-source AI projects shipped.',
    )
    // the film opener says nothing about numbers
    expect(buildMessagePrompt(film, candidate, item, 'film')[1]!.content).not.toContain(
      'best number',
    )
  })

  it('says in the prompt where [film] goes in each draft, and that the email opening leaves the film out', () => {
    const prompt = buildMessagePrompt(film, candidate, item, 'film')[1]!.content
    const line = (draft: string) => prompt.split('\n').find((l) => l.startsWith(`- ${draft}:`))!
    expect(line('note')).toContain(`no ${FILM}`)
    expect(line('afterAccept')).toContain(`${FILM} (required, exactly once, where the link goes)`)
    expect(line('inmail')).toContain(`${FILM} (required, exactly once, where the link goes)`)
    expect(line('email')).toContain(`no ${FILM} in any part`)
    expect(line('email')).toContain(
      'code adds "I made a 30-second film…" and the link right after the opening, so no part mentions the film or a video',
    )
  })

  it('tells the model to put [film] where the link goes when a draft left it out', async () => {
    const reply = good()
    const noLink = {
      ...reply,
      afterAccept: 'Thanks for connecting. Parcelpine looks great to me. Free for 15 minutes?',
    }
    const m = model(noLink, good())
    const r = await write(m.complete)
    const resent = m.sent[1]!.at(-1)!.content
    expect(resent).toContain(`- afterAccept: Put ${FILM} where the link goes`)
    expect(resent).not.toContain('Leaves out the link')
    expect(r.writer.afterAccept).toBe('model')
  })

  it('sends back an email whose opening mentions the film, since code adds the film line', async () => {
    const reply = good()
    const twice = {
      ...reply,
      email: { ...reply.email, opening: 'I made you a video for Parcelpine' },
    }
    const m = model(twice, good())
    const r = await write(m.complete)
    expect(r.firstTry).not.toContain('email')
    expect(m.sent[1]!.at(-1)!.content).toContain(
      '- email: Mentions the film again; the film line already does',
    )
    expect(r.writer.email).toBe('model')
  })

  it('opens with the film when there is no number to lead with', () => {
    const none = { ...film, highlights: { quote: film.highlights!.quote, proof: [] } }
    expect(briefFor(none, candidate, null, 'proof').opener).toBe('film')
  })
})

describe('the research line, from the fixture changelog read on a pinned day', () => {
  it('picks "Route planning, now with live traffic" for an operations role, and the line passes', async () => {
    const m = model(good())
    const r = await write(m.complete)
    expect(r.research?.itemUrl).toBe('http://127.0.0.1/parcelpine/changelog/live-traffic')
    expect(m.sent[0]![1]!.content).toContain(
      'THEIR LATEST POST: "Route planning, now with live traffic": Route planning now reroutes',
    )
    const checks = checkMessage('email', r.drafts.email, {
      company: 'Parcelpine',
      known: `${knownFor(film, candidate, HOMEWORK)}\n15 minutes`,
      link: FILM,
      research: { line: r.research!.line, source: researchSource(item) },
    })
    expect(checks.find((c) => c.rule === 'research_grounded')).toEqual({
      rule: 'research_grounded',
      ok: true,
    })
    expect(passed(checks)).toBe(true)
  })

  it('falls back when the research line says things the post does not', async () => {
    const reply = good()
    const off = {
      ...reply,
      email: { ...reply.email, research: 'Your team clearly wants a data culture shift soon.' },
    }
    const r = await write(model(off, off).complete)
    expect(r.writer.email).toBe('template')
    expect(r.flags.email?.map((c) => c.rule)).toEqual(['research_grounded'])
  })

  it('gives the model no post when nothing is recent, and the email has four parts', async () => {
    const m = model(good('film', false))
    const r = await write(m.complete, { now: LATER })
    expect(m.sent[0]![1]!.content).toContain('THEIR LATEST POST: none, so email.research is null')
    expect(r.research).toBeNull()
    expect(r.writer.email).toBe('model')
    expect(r.drafts.email.body.split('\n\n')).toHaveLength(6)
  })

  it('asks for a restatement of the post, with at most a few words of reaction and no new claims', () => {
    const prompt = buildMessagePrompt(film, candidate, item, 'film')[1]!.content
    expect(prompt).toContain(
      'restating what the post says in your own words, keeping its key words',
    )
    expect(prompt).toContain('at most a few words of reaction, such as "which caught my eye"')
    expect(prompt).toContain('No new claims about what it means for them or for the role')
    expect(prompt).not.toContain('what that post means')
  })

  it('drops the trailing "…" of a cut summary before the model sees it', () => {
    expect(researchSource({ ...item, summary: 'Route planning now reroutes trucks…' })).toBe(
      'Route planning now reroutes trucks',
    )
  })
})

describe('the request stays small', () => {
  it('stays under about 1,500 tokens, even with five long requirements and a long post', () => {
    const long = {
      ...film,
      requirements: Array.from({ length: 8 }, (_, i) => `${i} ${'requirement '.repeat(30)}`),
    }
    const post = { ...item, title: 'T'.repeat(140), summary: 's'.repeat(200) }
    const messages = buildMessagePrompt(long, candidate, post, 'proof')
    expect(promptTokens(messages)).toBeLessThan(1500)
    // only five requirements, each one line
    expect(messages[1]!.content.match(/^- \d requirement/gm)).toHaveLength(5)
  })
})

describe('through the durable runtime', () => {
  it('parses the reply with MessagesSchema via ctx.llm, and replays without calling again', async () => {
    let calls = 0
    const llm = new ScriptedProvider(() => {
      calls++
      return JSON.stringify(good())
    }, [0, 1])
    const journalFile = join(
      (await import('node:os')).tmpdir(),
      `messages-${process.pid}-${Date.now()}.json`,
    )
    const run = async () => {
      const ctx = new LocalContext({ runId: 'run_msg', llm, journalFile })
      await ctx.load()
      return writeMessages({
        film,
        profile: candidate,
        homework: HOMEWORK,
        opener: 'film',
        model: 'scripted-v1',
        now: NOW,
        complete: (key, m) => ctx.llm(key, { schema: MessagesSchema, messages: m }),
      })
    }
    const first = await run()
    expect(first.writer.email).toBe('model')
    expect(calls).toBe(1)
    const again = await run()
    expect(again).toEqual(first)
    expect(calls).toBe(1)
  })
})
