/**
 * The judge: a busy founder reading a job seeker's drafts and film, scored by a model.
 *
 * The code checks (src/outreach/checks.ts, src/script/checks.ts, src/script/review.ts,
 * src/profile/proof.ts) catch rule breaks. They can't tell whether a message is warm, specific
 * and human, or whether a reel makes a stranger want a call. This asks a model to read each item
 * the way the person receiving it would, and score it on a short rubric.
 *
 * One model call per item, strict JSON, temperature 0. A reply that isn't valid is sent back once,
 * then the item is "not scored": the judge is advisory and never fails a run. The judge sees only
 * what the recipient would see, with the sender's name taken out, and never the targets or the
 * checks, so it can't grade to the test. Pure apart from the model call, which is passed in.
 */
import { z } from 'zod'
import { LlmHttpError } from '../../src/llm/openai.ts'
import {
  type ChatMessage,
  estimateTokens,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from '../../src/llm/types.ts'

/* ------------------------------------------------------------ the rubrics */

export type ItemKind = 'message' | 'film' | 'referral'

export interface Rubric {
  /** who the judge is while reading this kind of item */
  reader: string
  /** each score, 1 to 5: its key, the label in the table, and the question the judge answers */
  criteria: { key: string; label: string; ask: string }[]
  /** the yes/no question, and its label in the table */
  yes: { label: string; ask: string }
}

export const RUBRICS: Record<ItemKind, Rubric> = {
  message: {
    reader:
      'You are the founder of the company below: busy, reading cold messages on your phone between meetings. You get dozens a week and reply to very few.',
    criteria: [
      {
        key: 'specific',
        label: 'Specific to them',
        ask: 'Could this only have been sent to your company, or would it work for any company with a find-and-replace?',
      },
      {
        key: 'homework',
        label: 'Homework visible',
        ask: 'Can you tell the sender actually used, read or built something with your product?',
      },
      {
        key: 'human',
        label: 'Sounds like a person',
        ask: 'Does it read like one curious person wrote it, not a template or an AI?',
      },
      {
        key: 'notPitch',
        label: 'Not a job pitch',
        ask: 'Is it about your work, rather than asking you for a job? (5 = not a pitch at all)',
      },
      {
        key: 'wantFilm',
        label: 'Makes me want to open the film',
        ask: 'Does the line about the short film give you a reason, in terms of your work, to open it?',
      },
      {
        key: 'easyAnswer',
        label: 'Easy to answer',
        ask: 'Is there one clear question you could answer in a line or two?',
      },
      {
        key: 'thanks',
        label: 'Thanks without begging',
        ask: 'Does it thank you for your time without sounding needy or flattering?',
      },
    ],
    yes: { label: 'Would reply', ask: 'Would you reply to this?' },
  },
  film: {
    reader:
      'You are the founder of the company below. Someone sent you a 30-second film made for your company. Below is every line that appears on screen, scene by scene. You have not seen their résumé and are not looking at your own website.',
    criteria: [
      {
        key: 'standsAlone',
        label: 'Every line makes sense alone',
        ask: 'Does every line make sense to you on its own, without the résumé or the website open?',
      },
      {
        key: 'factWorth',
        label: 'The fact is worth quoting',
        ask: 'Is the line quoted from your company worth putting on screen: something you are proud of, said well?',
      },
      {
        key: 'pitchWanted',
        label: 'The pitch says something I want',
        ask: 'Does the pitch say something they would do that you would actually want for your company or customers?',
      },
      {
        key: 'proofLands',
        label: 'The proof is impressive and believable',
        ask: 'Do the proof cards read as impressive and believable to a stranger?',
      },
    ],
    yes: { label: 'Would take a call', ask: 'Would you take a 15-minute call with this person?' },
  },
  referral: {
    reader:
      'You work at the company below and had one good call with the sender a few weeks ago. They have now written to ask you to pass their name to a hiring manager, with a short blurb you could forward.',
    criteria: [
      {
        key: 'easyYes',
        label: 'Easy to say yes to',
        ask: 'Is it easy to say yes: clear what they want, and little work for you?',
      },
      {
        key: 'easyForward',
        label: 'Easy to forward',
        ask: 'Could you forward the blurb as it is, without rewriting it?',
      },
      {
        key: 'wayOut',
        label: 'Has a real way out',
        ask: 'Does it give you a real, comfortable way to say no?',
      },
    ],
    yes: { label: 'Would pass this on', ask: 'Would you pass this on to the hiring manager?' },
  },
}

/* ------------------------------------------------------------ items and the prompt */

/** One thing to judge: what the recipient would see, about one company */
export interface Item {
  id: string
  kind: ItemKind
  /** the film it belongs to, for the review file */
  film: string
  /** "email", "after accept", "film", "referral ask" */
  label: string
  company: string
  /** what the company does, in their words, so the judge reads as someone who works there */
  about: string
  /** the text exactly as the recipient would see it */
  text: string
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Takes the sender's name (full, and each part of it) and any email address out of a text, so
 * the judge can't score who sent it. Short name parts (two letters or fewer) are left alone.
 */
export function redact(text: string, names: string[]): string {
  const parts = [
    ...new Set(
      names
        .flatMap((n) => [n.trim(), ...n.trim().split(/\s+/)])
        .filter((p) => p.length > 2)
        .sort((a, b) => b.length - a.length),
    ),
  ]
  let out = text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
  for (const p of parts)
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\d])${escapeRe(p)}(?![\\p{L}\\d])`, 'giu'),
      '[sender]',
    )
  return out.replace(/(\[sender\]\s*){2,}/g, '[sender] ')
}

/** The JSON the judge must reply with, for a rubric */
export function verdictSchema(kind: ItemKind) {
  const score = z.number().int().min(1).max(5)
  return z.object({
    scores: z.object(
      Object.fromEntries(RUBRICS[kind].criteria.map((c) => [c.key, score])) as Record<
        string,
        typeof score
      >,
    ),
    yes: z.boolean(),
    reason: z.string().min(1).max(300),
  })
}

/** The judge's prompt for one item. It carries the rubric and the item, and nothing else. */
export function judgePrompt(item: Item): ChatMessage[] {
  const r = RUBRICS[item.kind]
  const keys = r.criteria.map((c) => `"${c.key}": 1-5`).join(', ')
  return [
    {
      role: 'system',
      content: `${r.reader} Be honest and specific, the way you'd talk to a friend about this message. A 3 is ordinary, a 5 is the best you've seen; most cold outreach earns 2 or 3. Reply with only a JSON object.`,
    },
    {
      role: 'user',
      content: [
        `Your company: ${item.company}. What it does: ${item.about}`,
        '',
        `What you received (${item.label}):`,
        '"""',
        item.text,
        '"""',
        '',
        'Score each from 1 (not at all) to 5 (completely):',
        ...r.criteria.map((c) => `- ${c.key}: ${c.ask}`),
        `Then yes: ${r.yes.ask} (true or false)`,
        'And reason: one sentence naming the weakest part, quoting it if you can.',
        '',
        `Reply as {"scores": {${keys}}, "yes": true or false, "reason": "..."}`,
      ].join('\n'),
    },
  ]
}

/* ------------------------------------------------------------ reading the reply */

export interface Verdict {
  scores: Record<string, number>
  yes: boolean
  reason: string
}

/** A reply is a verdict, or the reason it isn't one */
export function parseVerdict(
  kind: ItemKind,
  text: string,
): { ok: true; verdict: Verdict } | { ok: false; error: string } {
  let json: unknown
  try {
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
  } catch {
    return { ok: false, error: 'not valid JSON' }
  }
  const parsed = verdictSchema(kind).safeParse(json)
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    }
  const v = parsed.data
  return {
    ok: true,
    verdict: {
      scores: v.scores as Record<string, number>,
      yes: v.yes,
      reason: v.reason.replace(/\s+/g, ' ').trim(),
    },
  }
}

export type Judged =
  | { item: Item; scored: true; verdict: Verdict; calls: number }
  | { item: Item; scored: false; why: string; calls: number }

/** Raised when the free tier stays rate limited: the runner stops calling and marks the rest */
export class RateLimited extends Error {}

export const isRateLimit = (e: unknown) =>
  e instanceof RateLimited ||
  (e instanceof LlmHttpError && e.status === 429) ||
  /\bHTTP 429\b/.test(String(e))

/** What one judge call needs: a model that returns the reply's text */
export type Complete = (req: LlmRequest) => Promise<Pick<LlmResponse, 'text'>>

/**
 * Judge one item: one call, and one more when the reply isn't a valid verdict, then "not
 * scored". A rate limit is thrown for the runner to handle; any other failure is "not scored".
 */
export async function judgeItem(item: Item, complete: Complete): Promise<Judged> {
  const schema = (() => {
    const { $schema: _drop, ...rest } = z.toJSONSchema(verdictSchema(item.kind)) as Record<
      string,
      unknown
    >
    return rest
  })()
  const messages = judgePrompt(item)
  let calls = 0
  let error = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string
    try {
      calls++
      ;({ text } = await complete({ messages, json: true, schema, temperature: 0 }))
    } catch (e) {
      if (isRateLimit(e)) throw e
      return { item, scored: false, why: `the model failed: ${String(e).slice(0, 160)}`, calls }
    }
    const r = parseVerdict(item.kind, text)
    if (r.ok) return { item, scored: true, verdict: r.verdict, calls }
    error = r.error
    messages.push(
      { role: 'assistant', content: text.slice(0, 2000) },
      {
        role: 'user',
        content: `That reply was invalid: ${error}. Reply with only the JSON object, in the shape asked for.`,
      },
    )
  }
  return { item, scored: false, why: `the reply wasn't valid JSON twice (${error})`, calls }
}

/**
 * Judge every item in order. Identical items (the same prompt) share one call. When the free tier
 * stays rate limited after the provider's own waits, wait once more (backoffMs), try again, and if
 * it's still limited, mark that item and every one after it "not scored". Never throws for a
 * model's failure: the run always finishes and writes its report.
 */
export async function judgeAll(
  items: Item[],
  complete: Complete,
  opts: {
    backoffMs?: number
    sleep?: (ms: number) => Promise<void>
    log?: (s: string) => void
  } = {},
): Promise<Judged[]> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)))
  const backoff = opts.backoffMs ?? 60_000
  const seen = new Map<string, Judged>()
  const out: Judged[] = []
  let stopped: string | null = null
  for (const item of items) {
    if (stopped) {
      out.push({ item, scored: false, why: stopped, calls: 0 })
      continue
    }
    const key = `${item.kind}\n${item.company}\n${item.about}\n${item.label}\n${item.text}`
    const same = seen.get(key)
    if (same) {
      out.push({ ...same, item, calls: 0 })
      continue
    }
    let j: Judged
    try {
      j = await judgeItem(item, complete)
    } catch (e) {
      opts.log?.(`  rate limited on ${item.id}; waiting ${Math.round(backoff / 1000)}s`)
      await sleep(backoff)
      try {
        j = await judgeItem(item, complete)
      } catch (e2) {
        stopped = `the free tier stayed rate limited (${String(isRateLimit(e2) ? e2 : e).slice(0, 120)})`
        j = { item, scored: false, why: stopped, calls: 0 }
      }
    }
    opts.log?.(
      `  ${j.scored ? 'scored    ' : 'not scored'} ${item.id}${j.scored ? `  ${Object.values(j.verdict.scores).join(' ')} ${j.verdict.yes ? 'yes' : 'no'}` : `  ${j.why}`}`,
    )
    seen.set(key, j)
    out.push(j)
  }
  return out
}

/* ------------------------------------------------------------ pacing for the free tier */

/** Groq's free tier for gpt-oss-120b: 8,000 tokens a minute */
export const FREE_TOKENS_A_MINUTE = 8000
/**
 * What a call may use beyond its prompt: the provider caps gpt-oss replies at 1,500 tokens
 * (src/llm/openai.ts), and a cap may be counted against the minute before the reply is written.
 */
export const REPLY_TOKENS = 1500
const MINUTE = 60_000

export interface Spend {
  at: number
  tokens: number
}

/**
 * How long to wait before a call of `tokens`, so the calls in the last minute plus this one fit
 * in `perMinute`. Waits for the oldest calls to leave the window, one at a time. A call bigger
 * than the whole minute waits for the window to empty, then goes alone.
 */
export function paceDelay(log: Spend[], tokens: number, perMinute: number, now: number): number {
  const live = log.filter((s) => s.at > now - MINUTE).sort((a, b) => a.at - b.at)
  let used = live.reduce((n, s) => n + s.tokens, 0)
  if (used + tokens <= perMinute) return 0
  for (const s of live) {
    used -= s.tokens
    if (used + tokens <= perMinute || used === 0) return Math.max(0, s.at + MINUTE - now)
  }
  return 0
}

/**
 * A provider that keeps every call it makes (messages and judge alike) inside a tokens-a-minute
 * budget: it waits before a call that wouldn't fit, then counts the larger of what it expected and
 * what the call used.
 */
export class PacedProvider implements LlmProvider {
  readonly name: string
  readonly #inner: LlmProvider
  readonly #perMinute: number
  readonly #now: () => number
  readonly #sleep: (ms: number) => Promise<void>
  readonly log: Spend[] = []
  waited = 0

  constructor(
    inner: LlmProvider,
    perMinute: number,
    clock: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.#inner = inner
    this.#perMinute = perMinute
    this.#now = clock.now ?? Date.now
    this.#sleep = clock.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)))
    this.name = `paced:${inner.name}`
  }

  /** what a request is expected to cost: its prompt, plus room for the reply */
  static expected(req: Pick<LlmRequest, 'messages'>): number {
    return estimateTokens(req.messages.map((m) => m.content).join('\n')) + REPLY_TOKENS
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const expected = PacedProvider.expected(req)
    const wait = paceDelay(this.log, expected, this.#perMinute, this.#now())
    if (wait) {
      this.waited += wait
      await this.#sleep(wait)
    }
    const at = this.#now()
    const spend = { at, tokens: expected }
    this.log.push(spend)
    const res = await this.#inner.complete(req)
    spend.tokens = Math.max(expected, res.inputTokens + res.outputTokens)
    return res
  }
}

/* ------------------------------------------------------------ the numbers */

export interface Summary {
  kind: ItemKind
  items: number
  scored: number
  /** per criterion: the average over scored items (null when none was scored) */
  averages: { key: string; label: string; average: number | null }[]
  yes: { label: string; rate: number | null; count: number }
}

export function summarize(kind: ItemKind, judged: Judged[]): Summary {
  const r = RUBRICS[kind]
  const mine = judged.filter((j) => j.item.kind === kind)
  const scored = mine.filter((j): j is Extract<Judged, { scored: true }> => j.scored)
  const avg = (key: string) =>
    scored.length
      ? scored.reduce((n, j) => n + (j.verdict.scores[key] ?? 0), 0) / scored.length
      : null
  const yes = scored.filter((j) => j.verdict.yes).length
  return {
    kind,
    items: mine.length,
    scored: scored.length,
    averages: r.criteria.map((c) => ({ key: c.key, label: c.label, average: avg(c.key) })),
    yes: { label: r.yes.label, rate: scored.length ? yes / scored.length : null, count: yes },
  }
}

/** The two lowest-scored items on a criterion, lowest first (ties keep their order) */
export function weakest(kind: ItemKind, key: string, judged: Judged[], n = 2) {
  return judged
    .filter((j): j is Extract<Judged, { scored: true }> => j.scored && j.item.kind === kind)
    .map((j, i) => ({ j, i }))
    .sort((a, b) => (a.j.verdict.scores[key] ?? 0) - (b.j.verdict.scores[key] ?? 0) || a.i - b.i)
    .slice(0, n)
    .map(({ j }) => j)
}
