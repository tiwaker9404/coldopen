import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type Homework, parseFeed } from '../../src/brand/homework.ts'
import type { BrandKit } from '../../src/brand/types.ts'
import { ScriptedProvider } from '../../src/llm/scripted.ts'
import type { ChatMessage } from '../../src/llm/types.ts'
import { checkMessage, knownFor, passed } from '../../src/outreach/checks.ts'
import { jobWordsIn, type SenderHomework } from '../../src/outreach/voice.ts'
import {
  assemble,
  briefFor,
  buildMessagePrompt,
  FILM,
  LINK_ROOM,
  type MessageFilm,
  MessagesSchema,
  type ModelMessages,
  messagesSchemaFor,
  promptTokens,
  researchSource,
  type SalesMessages,
  scriptedMessages,
  type WarmMessages,
  WarmMessagesSchema,
  writeMessages,
} from '../../src/outreach/writer.ts'
import { LocalContext } from '../../src/runtime/local.ts'
import { buildStoryboard } from '../../src/script/storyboard.ts'
import type { Profile } from '../../src/script/types.ts'
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
const sales = profile('sales')
const CREATOR = {
  name: 'coldopen',
  url: 'https://tiwaker9404.github.io/coldopen/',
  line: 'An open-source agent that turns a company site into an on-brand pitch',
}
const withCreator: Profile = { ...candidate, creator: CREATOR }

/** What film.ts hands the writer for the Parcelpine fixture, answering its job post */
function filmFor(p: Profile, kit = KIT): MessageFilm {
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
          : { text: '', source: '' },
      proof: proof?.kind === 'proof' ? proof.stats : [],
    },
    requirements: kit.job ? REQS : [],
  }
}

const item = HOMEWORK.items[0]!

/** The sender's homework, as saved with PUT /v1/films/:id/homework */
const DETAIL = 'the per-zone breakdown saved me a spreadsheet'
const QUESTION =
  'Are most of your customers calling the API directly, or going through the Shopify app?'
const BUILT = { url: 'https://github.com/alex/rates', line: 'A carrier rate comparer on your API' }
const hw = (o: Partial<SenderHomework> = {}): SenderHomework => ({
  detail: null,
  question: null,
  built: null,
  ...o,
})

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

/* ------------------------------------------------------------ a job seeker, in the voice */

describe("a job seeker's drafts, in the voice", () => {
  const film = filmFor(candidate)
  /** A careful model's reply: the stand-in writer, from the brief the prompt carries */
  const good = (
    o: { p?: Profile; opener?: 'homework' | 'question'; sender?: SenderHomework | null } = {},
  ) =>
    scriptedMessages(
      briefFor(filmFor(o.p ?? candidate), o.p ?? candidate, item, o.opener ?? 'homework', o.sender),
    ) as WarmMessages
  const write = (
    complete: ReturnType<typeof model>['complete'],
    o: {
      p?: Profile
      opener?: 'homework' | 'question'
      sender?: SenderHomework | null
      now?: number
    } = {},
  ) =>
    writeMessages({
      film: filmFor(o.p ?? candidate),
      profile: o.p ?? candidate,
      homework: HOMEWORK,
      sender: o.sender ?? null,
      opener: o.opener ?? 'homework',
      model: 'test-model',
      now: o.now ?? NOW,
      complete,
    })
  const allText = (d: Awaited<ReturnType<typeof write>>['drafts']) =>
    [d.note, d.afterAccept, d.inmail.subject, d.inmail.body, d.email.subject, d.email.body].join(
      '\n',
    )

  it('the candidate prompt has no proof numbers or role title', () => {
    const [system, user] = buildMessagePrompt(film, candidate, item, 'homework', hw())
    const prompt = `${system!.content}\n${user!.content}`
    expect(prompt).not.toContain('Operations Analyst')
    for (const r of REQS) expect(prompt).not.toContain(r)
    expect(prompt).not.toMatch(/PROOF|What the role asks for|THE ROLE/)
    for (const p of film.highlights!.proof) {
      expect(prompt).not.toContain(p.label)
      expect(prompt).not.toContain(`${p.value} ${p.label}`)
    }
    expect(prompt).not.toContain('best number')
    // what it does carry: what the film noticed, their post, the homework and the voice rules
    expect(user!.content).toContain('NOTICED (what the film says about their homepage)')
    expect(user!.content).toContain('THEIR LATEST POST: "Route planning, now with live traffic"')
    expect(user!.content).toContain("HOMEWORK (the sender's own words; don't add experiences")
    expect(user!.content).toContain('Voice rules for these messages')
  })

  it('a saved question is passed word for word', async () => {
    const sender = hw({ detail: DETAIL, question: QUESTION })
    const prompt = buildMessagePrompt(film, candidate, item, 'homework', sender)[1]!.content
    expect(prompt).toContain(`- their question: ${QUESTION}`)
    expect(prompt).toContain(`question: exactly "${QUESTION}"`)
    // the model kept it: it's in the email as the sender wrote it
    const kept = await write(model(good({ sender })).complete, { sender })
    expect(kept.writer.email).toBe('model')
    expect(kept.drafts.email.body).toContain(QUESTION)
    // the model rephrased it: code puts the sender's own words back
    const reworded = good({ sender })
    reworded.email.question = 'Do customers mostly use the API or the Shopify app?'
    const r = await write(model(reworded).complete, { sender })
    expect(r.writer.email).toBe('model')
    expect(r.drafts.email.body).toContain(`One thing I wondered: a${QUESTION.slice(1)}`)
    expect(r.drafts.email.body).not.toContain('Do customers mostly use')
  })

  it('assemble puts thanks and the signature after the offer', () => {
    const reply: WarmMessages = {
      ...good({ p: withCreator, sender: hw({ detail: DETAIL }) }),
      // a model that thanks them anyway doesn't thank them twice
      afterAccept: `Thanks for connecting. I put what I'd try next with Parcelpine into a 30-second film: ${FILM} How do most teams use it? Thanks for reading.`,
    }
    const d = assemble(reply, film, withCreator, LINK_ROOM, { opener: 'homework', research: true })
    const lines = d.email.body.split('\n')
    expect(lines.slice(-4)).toEqual(['', 'Thanks for reading,', 'Alex Rivera', 'alex@example.com'])
    expect(lines.at(-5)).toMatch(/\?.*If you ever have 15 minutes, I'd love to hear/)
    // the link sits on its own line, right after the tease
    const at = lines.indexOf(LINK_ROOM)
    expect(lines[at - 1]).toBe("I put what I'd try next with Parcelpine into a 30-second film:")
    expect(lines.slice(1, at)).toContain(
      "I've been using Parcelpine, and the per-zone breakdown saved me a spreadsheet.",
    )
    expect(d.email.body).toContain('I built the tool that made it, coldopen: an open-source agent')
    expect(d.afterAccept.endsWith('\n\nThank you for your time,\nAlex')).toBe(true)
    expect(d.afterAccept).not.toContain('Thanks for reading')
    expect(d.afterAccept.split(LINK_ROOM)).toHaveLength(2)
    expect(d.inmail.body.endsWith('Thank you for your time,\nAlex')).toBe(true)
    expect(d.note).toMatch(/^Hi \[First name\], .* – Alex$/)
  })

  it('cuts a creator line that says "film" to the name, and drops it without profile.creator', () => {
    const reply = good({ p: withCreator })
    reply.email.creator =
      'I built the tool that made it, coldopen, which makes a film for any company.'
    const cut = assemble(reply, film, withCreator, FILM, { opener: 'homework', research: true })
    expect(cut.email.body).toContain('\nI built the tool that made it, coldopen.\n')
    const none = assemble(reply, film, candidate, FILM, { opener: 'homework', research: true })
    expect(none.email.body).not.toContain('I built the tool')
  })

  it("opener A/B: 'homework' leads with the homework line, 'question' with the question", async () => {
    const sender = hw({ detail: DETAIL, question: QUESTION })
    const paragraphs = (body: string) => body.split('\n\n')
    const home = await write(model(good({ sender })).complete, { sender, opener: 'homework' })
    expect(paragraphs(home.drafts.email.body)[1]).toBe(
      "I've been using Parcelpine, and the per-zone breakdown saved me a spreadsheet.",
    )
    expect(paragraphs(home.drafts.email.body).at(-2)).toMatch(/^Are most of your customers/)
    const ask = await write(model(good({ sender, opener: 'question' })).complete, {
      sender,
      opener: 'question',
    })
    expect(ask.writer.email).toBe('model')
    expect(paragraphs(ask.drafts.email.body)[1]).toBe(QUESTION)
    expect(paragraphs(ask.drafts.email.body)[2]).toBe(
      "I've been using Parcelpine, and the per-zone breakdown saved me a spreadsheet.",
    )
    expect(paragraphs(ask.drafts.email.body).at(-2)).toMatch(/^If you ever have 15 minutes/)
    // a seller's opener names mean nothing here: the homework leads
    expect(briefFor(film, candidate, item, 'proof').opener).toBe('homework')
  })

  it('an invented product experience is sent back', async () => {
    const sender = hw({ detail: DETAIL })
    const invented = good({ sender })
    invented.email.opening = 'I used Parcelpine to run returns for my store for a year.'
    const m = model(invented, invented)
    const r = await write(m.complete, { sender })
    expect(m.sent).toHaveLength(2)
    const resent = m.sent[1]!.at(-1)!.content
    expect(resent).toContain('- email: Take out "I used Parcelpine to run returns')
    expect(resent).toContain('only say you used, tried or built something when HOMEWORK')
    expect(r.writer.email).toBe('template')
    expect(r.flags.email?.map((c) => c.rule)).toEqual(['homework_grounded'])
    expect(r.drafts.email.body).not.toContain('run returns for my store')
    // the template email opens with what the sender saved
    expect(r.drafts.email.body).toContain('the per-zone breakdown saved me a spreadsheet')
    // and a model that fixes it on the second round keeps its email
    const fixed = await write(model(invented, good({ sender })).complete, { sender })
    expect(fixed.writer.email).toBe('model')
    expect(fixed.rounds).toBe(2)
  })

  it('sends job words and proof numbers back with what to do, and no draft keeps either', async () => {
    const pitch = good()
    pitch.note = "I'm applying for the Operations Analyst role at Parcelpine. Curious how it works."
    pitch.email.opening = 'I shipped 6 open-source AI projects, and Parcelpine caught my eye.'
    const m = model(pitch, pitch)
    const r = await write(m.complete)
    const resent = m.sent[1]!.at(-1)!.content
    expect(resent).toMatch(/- note: Drop the word "role" and every other job word \(role, /)
    expect(resent).toContain('talk about their product and their work instead')
    expect(resent).toContain(
      '- email: Take out "6": the film shows the numbers, so the message has none',
    )
    expect(r.writer).toMatchObject({ note: 'template', email: 'template' })
    expect(jobWordsIn(allText(r.drafts))).toEqual([])
    expect(allText(r.drafts)).not.toMatch(/\b6 open-source/)
  })

  it('asks about their work, not the sender, and says how to fix it', async () => {
    const vague = good()
    vague.email.question = 'Would you like to see more of my projects?'
    const m = model(vague, good())
    const r = await write(m.complete)
    expect(m.sent[1]!.at(-1)!.content).toContain(
      '- email: Ask about something in their post, site or product',
    )
    expect(r.writer.email).toBe('model')
  })

  it('keeps every draft a careful model writes on the first try, with and without homework and a creator line', async () => {
    const senders = [
      null,
      hw({ detail: DETAIL }),
      hw({ question: QUESTION }),
      hw({ built: BUILT }),
      hw({ detail: DETAIL, question: QUESTION, built: BUILT }),
    ]
    for (const p of [candidate, withCreator])
      for (const sender of senders)
        for (const opener of ['homework', 'question'] as const)
          for (const now of [NOW, LATER]) {
            const brief = briefFor(filmFor(p), p, now === NOW ? item : null, opener, sender)
            const r = await write(model(scriptedMessages(brief)).complete, {
              p,
              sender,
              opener,
              now,
            })
            const label = `${p.creator ? 'creator' : 'no creator'}, ${JSON.stringify(sender)}, ${opener}, ${now === NOW ? 'post' : 'no post'}`
            expect(r.flags, label).toEqual({})
            expect(r.firstTry, label).toEqual(['note', 'afterAccept', 'inmail', 'email'])
            expect(jobWordsIn(allText(r.drafts)), label).toEqual([])
            if (sender?.question) expect(r.drafts.email.body, label).toContain(QUESTION)
            expect(r.sender, label).toEqual(sender)
          }
  })

  it('checks the drafts in the voice when they are written, as the API does when it serves them', async () => {
    const r = await write(model(good()).complete)
    const checks = checkMessage(
      'email',
      { ...r.drafts.email, body: r.drafts.email.body.replace(FILM, LINK_ROOM) },
      {
        company: 'Parcelpine',
        known: knownFor(film, candidate, HOMEWORK),
        link: LINK_ROOM,
        candidate: true,
      },
    )
    expect(checks.map((c) => c.rule)).toEqual(
      expect.arrayContaining(['not_job_pitch', 'thanks', 'no_proof_numbers', 'curious']),
    )
    // the post the template and the API read is the one the email was given
    expect(r.research).toEqual({ itemUrl: item.url, line: researchSource(item) })
  })

  it('stays under 3,000 tokens for the largest fixture', () => {
    const long: MessageFilm = {
      ...film,
      script: { ...film.script!, noticed: `Parcelpine leads with “${'Returns '.repeat(20)}”` },
      requirements: Array.from({ length: 8 }, (_, i) => `${i} ${'requirement '.repeat(30)}`),
    }
    const post = { ...item, title: 'T'.repeat(140), summary: 's'.repeat(200) }
    const sender = hw({
      detail: 'd'.repeat(280),
      question: `${'q'.repeat(279)}?`,
      built: { url: `https://${'u'.repeat(290)}`, line: 'b'.repeat(120) },
    })
    const messages = buildMessagePrompt(long, withCreator, post, 'question', sender)
    expect(promptTokens(messages)).toBeLessThan(3000)
  })

  it('replies in the warm shape through the durable runtime, and replays without calling again', async () => {
    expect(messagesSchemaFor('candidate')).toBe(WarmMessagesSchema)
    expect(messagesSchemaFor('sales')).toBe(MessagesSchema)
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
        opener: 'homework',
        model: 'scripted-v1',
        now: NOW,
        complete: (key, m) => ctx.llm(key, { schema: messagesSchemaFor('candidate'), messages: m }),
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

/* ------------------------------------------------------------ a seller, as before */

describe("a seller's drafts, as before step 3", () => {
  const film = filmFor(sales)
  const good = (opener: 'film' | 'proof' = 'film', research = true) =>
    scriptedMessages(briefFor(film, sales, research ? item : null, opener)) as SalesMessages
  const write = (
    complete: ReturnType<typeof model>['complete'],
    o: { now?: number; opener?: 'film' | 'proof' } = {},
  ) =>
    writeMessages({
      film,
      profile: sales,
      homework: HOMEWORK,
      opener: o.opener ?? 'film',
      model: 'test-model',
      now: o.now ?? NOW,
      complete,
    })

  it('adds the greeting, the film line, the link and the signature', () => {
    const d = assemble(good(), film, sales, LINK_ROOM, { opener: 'film', research: true })
    expect(d.note.startsWith('Hi [First name], ')).toBe(true)
    expect(d.note.endsWith(' – Maya')).toBe(true)
    expect(d.note).not.toContain(LINK_ROOM)
    expect(d.afterAccept.split(LINK_ROOM)).toHaveLength(2)
    expect(d.email.body).toContain(
      `I made a 30-second film for your Operations Analyst role at Parcelpine:\n${LINK_ROOM}`,
    )
    expect(d.email.body.endsWith('Maya Chen\nmaya@tessellate.example')).toBe(true)
  })

  it('leads with the best number when the film opens with proof, even if the model forgot to', async () => {
    const prompt = buildMessagePrompt(film, sales, item, 'proof')[1]!.content
    expect(prompt).toContain("Lead the email's opening with the sender's best number: 31%")
    const r = await write(model(good('proof', false)).complete, { opener: 'proof', now: LATER })
    expect(r.drafts.email.body.split('\n\n')[1]).toMatch(/\. 31% lift in week-4 retention/)
    expect(buildMessagePrompt(film, sales, item, 'film')[1]!.content).not.toContain('best number')
  })

  it('falls back when the research line says things the post does not', async () => {
    const reply = good()
    const off = {
      ...reply,
      email: { ...reply.email, research: 'Your team clearly wants a data culture shift soon.' },
    }
    const r = await write(model(off, off).complete)
    expect(r.writer.email).toBe('template')
    expect(r.flags.email?.map((c) => c.rule)).toContain('research_grounded')
  })

  it('tells the model to put [film] where the link goes, and keeps its other reasons as they were', async () => {
    const reply = good('film', false)
    const noLink = {
      ...reply,
      afterAccept: 'Thanks for connecting. Parcelpine looks great to me. Worth a 15-minute look?',
    }
    const m = model(noLink, good('film', false))
    const r = await write(m.complete, { now: LATER })
    const resent = m.sent[1]!.at(-1)!.content
    expect(resent).toContain(`- afterAccept: Put ${FILM} where the link goes`)
    expect(r.writer.afterAccept).toBe('model')
    expect(r.sender).toBeUndefined()
  })

  it('gives the model no post when nothing is recent', async () => {
    const m = model(good('film', false))
    const r = await write(m.complete, { now: LATER })
    expect(m.sent[0]![1]!.content).toContain('THEIR LATEST POST: none, so email.research is null')
    expect(r.research).toBeNull()
  })

  it('sales prompts are unchanged', async () => {
    // snapshotted before step 3 from the same kit, without a job post
    const kit = { ...KIT, job: undefined, facts: KIT.facts.slice(0, 2) } as unknown as BrandKit
    const f = filmFor(sales, kit)
    const out: Record<string, unknown> = {}
    for (const opener of ['film', 'proof'] as const)
      for (const research of [true, false]) {
        const post = research ? item : null
        const reply = scriptedMessages(briefFor(f, sales, post, opener))
        const sent: ChatMessage[][] = []
        const written = await writeMessages({
          film: f,
          profile: sales,
          homework: research ? HOMEWORK : null,
          opener,
          model: 'test-model',
          now: NOW,
          complete: async (_k, m) => {
            sent.push(m)
            return reply
          },
        })
        out[`${opener}-${research ? 'research' : 'plain'}`] = {
          prompt: buildMessagePrompt(f, sales, post, opener),
          reply,
          written,
          sent: sent.length,
        }
      }
    // compared as JSON: the formatter may lay the file out differently, never change a value
    const file = join(import.meta.dirname, '__snapshots__/sales-writer.json')
    expect(JSON.parse(JSON.stringify(out))).toEqual(JSON.parse(readFileSync(file, 'utf8')))
  })
})

describe('the research line, for a seller', () => {
  it('drops the trailing "…" of a cut summary before the model sees it', () => {
    expect(researchSource({ ...item, summary: 'Route planning now reroutes trucks…' })).toBe(
      'Route planning now reroutes trucks',
    )
  })

  it('checks a seller’s research line against the post it restates', () => {
    const film = filmFor(sales)
    const r = scriptedMessages(briefFor(film, sales, item, 'film')) as SalesMessages
    const d = assemble(r, film, sales, FILM, { opener: 'film', research: true })
    const checks = checkMessage('email', d.email, {
      company: 'Parcelpine',
      known: knownFor(film, sales, HOMEWORK),
      link: FILM,
      research: { line: r.email.research!, source: researchSource(item) },
    })
    expect(checks.find((c) => c.rule === 'research_grounded')?.ok).toBe(true)
    expect(passed(checks.filter((c) => c.rule !== 'length'))).toBe(true)
  })
})
