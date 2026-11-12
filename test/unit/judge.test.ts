import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ASHWIN, FEEDS } from '../../evals/fixture-films.ts'
import { asReceived, filmLines } from '../../evals/judge/items.ts'
import {
  type Complete,
  type Item,
  judgeAll,
  judgeItem,
  judgePrompt,
  PacedProvider,
  paceDelay,
  parseVerdict,
  REPLY_TOKENS,
  RUBRICS,
  redact,
  summarize,
  weakest,
} from '../../evals/judge/judge.ts'
import { reviewFile, summaryFile, TARGETS, targetTable } from '../../evals/judge/report.ts'
import { LlmHttpError } from '../../src/llm/openai.ts'
import type { LlmProvider, LlmRequest } from '../../src/llm/types.ts'
import type { Storyboard } from '../../src/script/storyboard.ts'

const SENDER = 'Alex Rivera'

const item = (over: Partial<Item> = {}): Item => ({
  id: 'parcelpine_fixture_plain_email',
  kind: 'message',
  film: 'parcelpine_fixture_plain',
  label: 'email',
  company: 'Parcelpine',
  about: 'Shipping rates for small stores',
  text: 'Hi Sam,\n\nI tried your rate API.\n\nThanks for reading,\n[sender]',
  ...over,
})

const messageReply = (score = 4, yes = true, reason = 'The tease is vague.') =>
  JSON.stringify({
    scores: Object.fromEntries(RUBRICS.message.criteria.map((c) => [c.key, score])),
    yes,
    reason,
  })

/** a stub model that answers from a list, one reply per call, and remembers what it was asked */
const stub = (...replies: (string | Error)[]) => {
  const asked: LlmRequest[] = []
  const complete: Complete = async (req) => {
    asked.push(req)
    const r = replies.shift() ?? messageReply()
    if (r instanceof Error) throw r
    return { text: r }
  }
  return { complete, asked }
}

const rateLimited = () => new LlmHttpError(429, 'Rate limit reached. Please try again in 12s.')

describe('rubric parsing', () => {
  it('reads a verdict with every score, the yes and the reason', () => {
    const r = parseVerdict('message', messageReply(5, false, '  Too   long. '))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.verdict.scores.specific).toBe(5)
    expect(Object.keys(r.verdict.scores)).toEqual(RUBRICS.message.criteria.map((c) => c.key))
    expect(r.verdict).toMatchObject({ yes: false, reason: 'Too long.' })
  })

  it('reads a verdict wrapped in a code fence', () => {
    expect(parseVerdict('message', `\`\`\`json\n${messageReply()}\n\`\`\``).ok).toBe(true)
  })

  it('rejects a reply that is not JSON, misses a score, or scores outside 1 to 5', () => {
    expect(parseVerdict('message', 'I would reply, 4/5')).toEqual({
      ok: false,
      error: 'not valid JSON',
    })
    const missing = JSON.parse(messageReply())
    delete missing.scores.thanks
    expect(parseVerdict('message', JSON.stringify(missing)).ok).toBe(false)
    const six = JSON.parse(messageReply())
    six.scores.human = 6
    const r = parseVerdict('message', JSON.stringify(six))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/scores\.human/)
    const half = JSON.parse(messageReply())
    half.scores.human = 3.5
    expect(parseVerdict('message', JSON.stringify(half)).ok).toBe(false)
  })

  it('each kind has its own rubric: a film verdict needs the film scores', () => {
    expect(parseVerdict('film', messageReply()).ok).toBe(false)
    const film = JSON.stringify({
      scores: { standsAlone: 4, factWorth: 3, pitchWanted: 4, proofLands: 5 },
      yes: true,
      reason: 'The pitch is generic.',
    })
    expect(parseVerdict('film', film).ok).toBe(true)
    const referral = JSON.stringify({
      scores: { easyYes: 5, easyForward: 4, wayOut: 5 },
      yes: true,
      reason: 'The blurb is long.',
    })
    expect(parseVerdict('referral', referral).ok).toBe(true)
  })
})

describe('not-scored handling', () => {
  it('sends an invalid reply back once, then scores the corrected one', async () => {
    const { complete, asked } = stub('{"scores": {}}', messageReply(3))
    const j = await judgeItem(item(), complete)
    expect(j.scored).toBe(true)
    expect(j.calls).toBe(2)
    expect(asked[1]!.messages.at(-1)!.content).toMatch(/invalid/)
    expect(asked.every((r) => r.temperature === 0 && r.json === true && r.schema)).toBe(true)
  })

  it('marks an item not scored after two invalid replies, without throwing', async () => {
    const { complete, asked } = stub('nope', 'still nope')
    const j = await judgeItem(item(), complete)
    expect(j).toMatchObject({ scored: false, calls: 2 })
    if (!j.scored) expect(j.why).toMatch(/valid JSON twice/)
    expect(asked).toHaveLength(2)
  })

  it('marks an item not scored when the model fails for another reason', async () => {
    const { complete } = stub(new Error('fetch failed'))
    const j = await judgeItem(item(), complete)
    expect(j.scored).toBe(false)
  })

  it('backs off once on a rate limit, then marks the rest not scored, and still finishes', async () => {
    const waits: number[] = []
    const { complete, asked } = stub(messageReply(5), rateLimited(), rateLimited())
    const items = [1, 2, 3, 4].map((n) => item({ id: `m${n}`, text: `message ${n}` }))
    const out = await judgeAll(items, complete, {
      backoffMs: 60_000,
      sleep: async (ms) => {
        waits.push(ms)
      },
    })
    expect(out.map((j) => j.scored)).toEqual([true, false, false, false])
    expect(waits).toEqual([60_000])
    expect(asked).toHaveLength(3)
    for (const j of out.slice(1)) if (!j.scored) expect(j.why).toMatch(/rate limited/)
  })

  it('carries on after a rate limit that clears on the retry', async () => {
    const { complete } = stub(rateLimited(), messageReply(4), messageReply(2))
    const out = await judgeAll(
      [item({ id: 'a', text: 'a' }), item({ id: 'b', text: 'b' })],
      complete,
      {
        sleep: async () => {},
      },
    )
    expect(out.map((j) => j.scored)).toEqual([true, true])
  })

  it('judges identical items once and gives both the same verdict', async () => {
    const { complete, asked } = stub(messageReply(4))
    const out = await judgeAll([item({ id: 'a' }), item({ id: 'b' })], complete)
    expect(asked).toHaveLength(1)
    expect(out.map((j) => j.item.id)).toEqual(['a', 'b'])
    expect(out.every((j) => j.scored)).toBe(true)
  })
})

describe('the prompt', () => {
  const board: Storyboard = {
    company: 'Parcelpine',
    sender: SENDER,
    duration: 29.2,
    scenes: [
      {
        kind: 'hook',
        dur: 3.2,
        text: 'Made for the Parcelpine team',
        sub: 'A 30-second film for Parcelpine',
      },
      { kind: 'site', dur: 5.2, caption: 'Parcelpine leads with rates', host: 'parcelpine.com' },
      {
        kind: 'insight',
        dur: 5.4,
        value: '38%',
        text: 'fewer late deliveries',
        source: 'parcelpine.com',
        caption: 'From their changelog, Oct 2026',
        why: "I'd ask which stores move it most",
      },
      {
        kind: 'pitch',
        dur: 6,
        from: `${SENDER}, Acme`,
        headline: "What I'd try first",
        points: ['Ships agents'],
      },
      {
        kind: 'proof',
        dur: 4.8,
        stats: [{ value: '6', label: 'projects shipped', did: 'Built six agents', where: 'Acme' }],
      },
      {
        kind: 'cta',
        dur: 4.6,
        line: 'Trade notes on rates?',
        contact: 'alex@example.com',
        signoff: `Made for Parcelpine by ${SENDER}`,
        made: { name: 'coldopen', url: 'https://tiwaker9404.github.io/coldopen/' },
      },
    ],
  }

  it("never includes the sender's name or email, in a message or on a film", () => {
    const email = asReceived(
      `Subject: Your rate API\n\nHi [First name],\n\nI'm Alex. [film]\n\nThanks for reading,\n${SENDER}\nalex@example.com`,
      'email',
    )
    for (const it of [
      item({ text: redact(email, [SENDER]) }),
      item({ kind: 'film', label: 'the film', text: redact(filmLines(board), [SENDER]) }),
    ]) {
      const prompt = judgePrompt(it)
        .map((m) => m.content)
        .join('\n')
      expect(prompt).not.toMatch(/alex|rivera/i)
      expect(prompt).toContain('[sender]')
    }
    // the parts of the film that matter are all there
    const film = filmLines(board)
    for (const line of [
      '38% fewer late deliveries',
      'From their changelog, Oct 2026',
      'Built six agents',
      'Made with coldopen, which I built',
    ])
      expect(film).toContain(line)
    expect(email).toContain('Hi Sam,')
    expect(email).not.toContain('[film]')
  })

  it('never includes the targets or the code checks', () => {
    for (const kind of ['message', 'film', 'referral'] as const) {
      const prompt = judgePrompt(item({ kind }))
        .map((m) => m.content)
        .join('\n')
      expect(prompt).not.toMatch(
        /75|≥|target|threshold|not_job_pitch|homework_grounded|checkMessage|standsAlone\(|readableProof/i,
      )
      expect(prompt).not.toContain(String(TARGETS.average))
      // every criterion and the yes question are asked
      for (const c of RUBRICS[kind].criteria) expect(prompt).toContain(`- ${c.key}: `)
      expect(prompt).toContain(RUBRICS[kind].yes.ask)
    }
  })

  it('redacts each part of a name as a whole word only', () => {
    expect(redact('Ashwin Tiwari wrote it. – Ashwin', ['Ashwin Tiwari'])).toBe(
      '[sender] wrote it. – [sender]',
    )
    // "Al" is too short to take out, and "Alexandria" isn't "Alex"
    expect(redact('Al from Alexandria', ['Al Rivera', 'Alex'])).toBe('Al from Alexandria')
  })
})

describe('pacing for the free tier', () => {
  it('waits only when the last minute plus this call would go over the budget', () => {
    const now = 100_000
    expect(paceDelay([], 3000, 8000, now)).toBe(0)
    expect(paceDelay([{ at: now - 10_000, tokens: 4000 }], 4000, 8000, now)).toBe(0)
    // 4,000 + 4,000 + 3,000 is over 8,000: wait for the oldest call to leave the window
    const log = [
      { at: now - 50_000, tokens: 4000 },
      { at: now - 20_000, tokens: 4000 },
    ]
    expect(paceDelay(log, 3000, 8000, now)).toBe(10_000)
    // a call from more than a minute ago doesn't count
    expect(paceDelay([{ at: now - 61_000, tokens: 8000 }], 8000, 8000, now)).toBe(0)
    // a call bigger than the whole minute waits for the window to empty, then goes alone
    expect(paceDelay([{ at: now - 30_000, tokens: 1000 }], 9000, 8000, now)).toBe(30_000)
  })

  it('a paced provider sleeps before a call that would not fit, and counts what calls used', async () => {
    let t = 0
    const slept: number[] = []
    const inner: LlmProvider = {
      name: 'stub',
      complete: async () => ({
        text: '{}',
        model: 'stub',
        inputTokens: 5000,
        outputTokens: 2000,
        latencyMs: 1,
      }),
    }
    const p = new PacedProvider(inner, 8000, {
      now: () => t,
      sleep: async (ms) => {
        slept.push(ms)
        t += ms
      },
    })
    const req = { messages: [{ role: 'user' as const, content: 'x'.repeat(400) }] }
    expect(PacedProvider.expected(req)).toBe(100 + REPLY_TOKENS)
    await p.complete(req)
    expect(slept).toEqual([])
    // the first call used 7,000 (more than it expected), so the next must wait a full minute
    t += 5_000
    await p.complete(req)
    expect(slept).toEqual([55_000])
    expect(p.log.map((s) => s.tokens)).toEqual([7000, 7000])
    expect(p.waited).toBe(55_000)
  })
})

describe('the summary', () => {
  it('averages each line, rates the yeses against the targets, and names the weakest drafts', async () => {
    const { complete } = stub(
      messageReply(5, true),
      messageReply(3, false, 'The tease is abstract.'),
      messageReply(4, true),
    )
    const judged = await judgeAll(
      ['a', 'b', 'c'].map((id) => item({ id, text: `text ${id}` })),
      complete,
    )
    const s = summarize('message', judged)
    expect(s.averages[0]).toMatchObject({ key: 'specific', average: 4 })
    expect(s.yes).toMatchObject({ rate: 2 / 3, count: 2 })
    expect(weakest('message', 'human', judged).map((j) => j.item.id)).toEqual(['b', 'c'])
    const table = targetTable(judged).join('\n')
    expect(table).toContain('| message | Specific to them | 4.00 | ≥ 4 | met |')
    expect(table).toContain(
      '| message | **Would reply** | 67% (2/3) | ≥ 75% | missed by 8 points |',
    )
    expect(table).toContain('| film | **Would take a call** | not scored |')
    const meta = { model: 'stub', seconds: 1, calls: 3, waitedSeconds: 0, films: [] }
    const original = new Map([['b', 'Hi Sam, from Alex Rivera']])
    expect(summaryFile(judged, original, meta)).toMatch(/Every line met its target/)
    const review = reviewFile(judged, original, meta)
    expect(review).toContain('The judge: The tease is abstract.')
    // Ashwin reads the draft as it was sent, name and all
    expect(review).toContain('Hi Sam, from Alex Rivera')
  })
})

describe("Ashwin's homework in the judged eval: what a real user would save", () => {
  const sites = Object.keys(FEEDS)
  const page = (site: string) =>
    readFileSync(join(import.meta.dirname, `../../fixtures/sites/${site}/index.html`), 'utf8')
      .replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .toLowerCase()

  it('saves a detail and a question on one film per site, and nothing on the one with their latest post', () => {
    for (const site of sites) {
      const plain = ASHWIN[`${site}_ashwin_plain`]!.hw
      const research = ASHWIN[`${site}_ashwin_research`]!.hw
      expect(plain.detail, site).toBeTruthy()
      expect(plain.question, site).toMatch(/\?$/)
      expect(research).toEqual({ detail: null, question: null, built: null })
    }
  })

  it('asks about a part of their product, not a kind of customer, in plain words with no numbers', () => {
    for (const site of sites) {
      const { detail, question } = ASHWIN[`${site}_ashwin_plain`]!.hw
      const text = page(site)
      // two words in a row from their own page: a named part of the product ("fraud check")
      const pairs = (s: string) =>
        (s.toLowerCase().match(/[a-z][a-z-]+/g) ?? [])
          .map((w, i, ws) => `${w} ${ws[i + 1] ?? ''}`)
          .filter((p) => text.includes(p.replace(/s\b/g, '')) && p.length > 9)
      expect(pairs(question!).length, question!).toBeGreaterThan(0)
      expect(question).not.toMatch(/\bmost (shippers|clinics|brands|customers)\b/i)
      for (const line of [detail!, question!]) expect(line).not.toMatch(/\d/)
    }
  })
})
