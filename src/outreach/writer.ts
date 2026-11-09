/**
 * The model writes the messages that carry a film: the LinkedIn connection note, the message
 * once they accept, an InMail and the warm email. It writes text only, from the film's own
 * facts. Code adds the greeting, the film's link and the signature, checks every draft with
 * checkMessage, sends failed drafts back once with the reasons, and swaps any draft that still
 * fails for its template. The same shape as the script writer (src/script/writer.ts).
 */
import { z } from 'zod'
import { type Homework, type HomeworkItem, pickResearch } from '../brand/homework.ts'
import type { FilmResult } from '../film.ts'
import { type ChatMessage, estimateTokens } from '../llm/types.ts'
import { TASTE_RULES } from '../script/taste.ts'
import type { Profile } from '../script/types.ts'
import {
  type Check,
  checkMessage,
  emailWords,
  knownFor,
  MESSAGE_LIMITS,
  type MessageKind,
  passed,
} from './checks.ts'
import { draftMessages, type Opener } from './messages.ts'

/** The model's reply. It never writes the link, the greeting or the signature. */
export const MessagesSchema = z.object({
  note: z.string(),
  afterAccept: z.string(),
  inmail: z.object({ subject: z.string(), body: z.string() }),
  email: z.object({
    subject: z.string(),
    opening: z.string(),
    research: z.string().nullable(),
    fit: z.string(),
    ask: z.string(),
  }),
})
export type ModelMessages = z.infer<typeof MessagesSchema>

/** Where the film's link goes in a stored draft; the API fills in the real link */
export const FILM = '[film]'

/**
 * A share link as long as real ones get (`<share url>/f/<company slug, 40>-<10 chars>`), so a
 * draft checked with it still fits once the real link goes in.
 */
export const LINK_ROOM = `https://films.example.com/f/${'x'.repeat(40)}-${'x'.repeat(10)}`

/** The four drafts the model writes, by the name checkMessage knows them by */
export const DRAFTS = ['note', 'afterAccept', 'inmail', 'email'] as const
export type WrittenDraft = (typeof DRAFTS)[number]

export interface Drafts {
  note: string
  afterAccept: string
  inmail: { subject: string; body: string }
  email: { subject: string; body: string }
}

/** What a film stores: the drafts (with [film] and [First name] still in them), and who wrote each */
export interface FilmMessages {
  drafts: Drafts
  writer: Record<WrittenDraft, 'model' | 'template'>
  /** the checks a draft failed on its last try, for each draft that fell back to its template */
  flags: Partial<Record<WrittenDraft, Check[]>>
  /** the post the email's research line is about, and the line, when the email has one */
  research: { itemUrl: string; line: string } | null
  model: string
  /** how many model calls it took (1, or 2 when a draft was sent back) */
  rounds: number
  /** the drafts that passed every check on the model's first try */
  firstTry: WrittenDraft[]
}

/** What the film says, as the messages need it */
export type MessageFilm = Pick<
  FilmResult,
  'company' | 'job' | 'highlights' | 'script' | 'related'
> & {
  /** the job post's requirements, when the film answers one */
  requirements?: string[]
}

export type CompleteMessages = (key: string, messages: ChatMessage[]) => Promise<ModelMessages>

const clean = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]$/, '')
const sentence = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return !t || /[.?…]$/.test(t) ? t : `${t}.`
}
const firstName = (p: Profile) => p.sender.name.split(' ')[0]!

/** "40% faster month-end close at Initech", the number the film leads with */
function bestProof(film: MessageFilm): string {
  const p = film.highlights?.proof[0]
  return p ? clean(`${p.value} ${p.label}${p.where ? ` at ${p.where}` : ''}`) : ''
}

/** The post text a research line must stay close to: its summary (a cut one loses its "…"), or its title */
export const researchSource = (item: HomeworkItem) =>
  (item.summary ?? item.title).replace(/\s*…$/, '')

const forWhat = (film: MessageFilm) =>
  film.job?.title ? `for your ${film.job.title} role at ${film.company}` : `for ${film.company}`

/* ------------------------------------------------------------ assembly */

const hello = 'Hi [First name],'
const noteSign = (p: Profile) => ` – ${firstName(p)}`
const filmLine = (film: MessageFilm) => `I made a 30-second film ${forWhat(film)}:`

/**
 * The model's text with the parts code owns: the greeting, the link and the signature, laid out
 * as the templates are. With `link` = LINK_ROOM for checking, FILM for storing.
 */
export function assemble(
  reply: ModelMessages,
  film: MessageFilm,
  profile: Profile,
  link: string,
  o: { opener: Opener; research: boolean },
): Drafts {
  const first = firstName(profile)
  const withLink = (t: string) => t.replaceAll(FILM, link)
  const short = (t: string) => [hello, '', withLink(t.trim()), '', first].join('\n')
  // the proof opener leads part 1 with the best number, so /v1/me/openers stays comparable
  const best = bestProof(film)
  const value = film.highlights?.proof[0]?.value ?? ''
  const opening = sentence(reply.email.opening)
  const part1 =
    o.opener === 'proof' && best && !opening.includes(value)
      ? `${opening} ${best[0]!.toUpperCase()}${best.slice(1)}.`
      : opening
  const research = o.research && reply.email.research ? sentence(reply.email.research) : ''
  const body = [
    hello,
    '',
    part1,
    '',
    filmLine(film),
    link,
    ...(research ? ['', research] : []),
    ...(reply.email.fit.trim() ? ['', sentence(reply.email.fit)] : []),
    '',
    sentence(reply.email.ask),
    '',
    profile.sender.name,
    profile.cta.contact,
  ].join('\n')
  return {
    note: `${hello} ${reply.note.trim()}${noteSign(profile)}`,
    afterAccept: short(reply.afterAccept),
    inmail: { subject: reply.inmail.subject.trim(), body: short(reply.inmail.body) },
    email: { subject: reply.email.subject.trim(), body },
  }
}

/** Room the model has for its own words, after the parts code adds */
export function budgets(film: MessageFilm, profile: Profile) {
  const first = firstName(profile)
  const wrap = [hello, '', '', '', first].join('\n').length + LINK_ROOM.length - FILM.length
  const emailFrame = emailWords(
    [hello, filmLine(film), LINK_ROOM, profile.sender.name, profile.cta.contact].join('\n'),
  )
  return {
    note: MESSAGE_LIMITS.note - `${hello} `.length - noteSign(profile).length,
    afterAccept: MESSAGE_LIMITS.afterAccept - wrap,
    inmailSubject: MESSAGE_LIMITS.inmailSubject,
    inmailBody: MESSAGE_LIMITS.inmailBody - wrap,
    // the proof opener adds the best number to the opening
    emailWords: MESSAGE_LIMITS.emailWords - emailFrame - 2,
  }
}

/* ------------------------------------------------------------ the prompt */

export interface MessageBrief {
  company: string
  role?: string
  requirements: string[]
  hook: string
  headline: string
  /** the proof the film shows, best first */
  proof: string[]
  best: string
  research: { title: string; summary: string } | null
  opener: Opener
  ask: string
  sender: string
  candidate: boolean
  budgets: ReturnType<typeof budgets>
}

export function briefFor(
  film: MessageFilm,
  profile: Profile,
  item: HomeworkItem | null,
  opener: Opener,
): MessageBrief {
  const proof = (film.highlights?.proof ?? []).map((p) =>
    clean(`${p.value} ${p.label}${p.where ? ` at ${p.where}` : ''}`),
  )
  const best = bestProof(film)
  return {
    company: film.company,
    ...(film.job?.title ? { role: film.job.title } : {}),
    // at most 5, each cut to a line, so the request stays small
    requirements: (film.requirements ?? [])
      .slice(0, 5)
      .map((r) => (r.length > 160 ? `${r.slice(0, 159)}…` : r)),
    hook: film.script?.hook ?? '',
    headline: film.script?.pitch.headline ?? '',
    proof,
    best,
    research: item ? { title: item.title, summary: researchSource(item) } : null,
    // lead with a number only when there is one
    opener: opener === 'proof' && best ? 'proof' : 'film',
    ask: clean(profile.cta.line).replace(/\?*$/, '?'),
    sender: profile.sender.name,
    candidate: profile.preset === 'candidate',
    budgets: budgets(film, profile),
  }
}

const SYSTEM = `You write the short messages that carry a 30-second personalized film, made by the sender for one company, to one person there.
Write text only. Never write a greeting, a signature or a URL: code adds them. Where the film's link goes, write ${FILM}.

${TASTE_RULES}
(The word limits above are for the film's lines; these messages have their own limits below.)

Reply with only a JSON object of this exact shape:
{"note": string, "afterAccept": string, "inmail": {"subject": string, "body": string}, "email": {"subject": string, "opening": string, "research": string | null, "fit": string, "ask": string}}`

export function buildMessagePrompt(
  film: MessageFilm,
  profile: Profile,
  item: HomeworkItem | null,
  opener: Opener,
): ChatMessage[] {
  const b = briefFor(film, profile, item, opener)
  const lead =
    b.opener === 'proof'
      ? `Lead the email's opening with the sender's best number: ${b.best}.`
      : "Open the email with the role (I saw the role) or what they've shipped."
  const user = `${b.candidate ? 'The sender wants to work at this company. Write in the first person ("I"). Ask for a conversation, never for a job.' : 'The sender sells to this company. Talk about their customers and outcomes.'}

COMPANY: ${b.company}${b.role ? `\nTHE ROLE: ${b.role}` : ''}${b.requirements.length ? `\nWhat the role asks for:\n${b.requirements.map((r) => `- ${r}`).join('\n')}` : ''}
THE FILM: opens "${b.hook}", pitch "${b.headline}"
PROOF (the only results you may mention):
${b.proof.map((p, i) => `${i + 1}. ${p}`).join('\n') || '(none)'}
${b.research ? `THEIR LATEST POST: "${b.research.title}": ${b.research.summary}` : 'THEIR LATEST POST: none, so email.research is null'}
SENDER: ${b.sender}. The ask: ${b.ask}

THE MESSAGES (limits are checked in code; going over means a rewrite):
- note: a LinkedIn connection note, at most ${b.budgets.note} characters. Who you are to them and that you made something for ${b.company}. No link, no ${FILM}, no question, no ask.
- afterAccept: sent once they accept, at most ${b.budgets.afterAccept} characters. Thanks for connecting, ${FILM} once, then exactly one question: the ask.
- inmail: subject at most ${b.budgets.inmailSubject} characters and names ${b.company}; body at most ${b.budgets.inmailBody} characters, with ${FILM} once and exactly one question.
- email (code adds the film's link after the opening): subject names ${b.company}, not "inquiry" or "application". opening: one sentence. research: ${b.research ? "one sentence on what that post means for the role or for them, kept to what the post says, without repeating the post's title word for word" : 'null'}. fit: one or two sentences on why the sender fits, from the proof. ask: one question asking for 15 minutes. All four parts together at most ${b.budgets.emailWords} words. The email has exactly one question, in the ask.
- ${lead}
- Every message names ${b.company}. No exclamation marks. Numbers only from the proof or the role.
- Never beg or ask a favor: no "refer me", "referral", "any openings", "pass my resume", "pick your brain", "just checking in", "I'd be grateful".`
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ]
}

/** The whole request's size in tokens, for Groq's free tier (8k a minute) */
export const promptTokens = (messages: ChatMessage[]) =>
  estimateTokens(messages.map((m) => m.content).join('\n'))

/* ------------------------------------------------------------ write, check, fall back */

/** The email's ask is always for 15 minutes, so that number is ours to say */
const ASK_LENGTH = '15 minutes, a 15-minute call'

/**
 * One model call writes all four drafts. Code assembles and checks each; drafts that fail go
 * back once with the reasons, and any draft that still fails is replaced by its template.
 */
export async function writeMessages(opts: {
  film: MessageFilm
  profile: Profile
  homework: Homework | null | undefined
  opener: Opener
  complete: CompleteMessages
  model: string
  now?: number
}): Promise<FilmMessages> {
  const { film, profile } = opts
  const now = opts.now ?? Date.now()
  const item = opts.homework
    ? pickResearch(
        opts.homework,
        {
          ...(film.job?.title ? { role: film.job.title } : {}),
          requirements: film.requirements ?? [],
          points: profile.points,
        },
        now,
      )
    : null
  const source = item ? researchSource(item) : null
  const opener = briefFor(film, profile, item, opts.opener).opener
  const ctx = {
    company: film.company,
    // the 15-minute ask is part of the email's structure (the prompt asks for it), not a claim
    known: `${knownFor(film, profile, opts.homework)}\n${ASK_LENGTH}`,
    link: LINK_ROOM,
  }
  const check = (d: WrittenDraft, drafts: Drafts, reply: ModelMessages): Check[] =>
    checkMessage(d satisfies MessageKind, drafts[d], {
      ...ctx,
      research:
        d === 'email' && source && reply.email.research
          ? { line: reply.email.research, source }
          : null,
    })
  const shape = { opener, research: !!item }

  const messages = buildMessagePrompt(film, profile, item, opts.opener)
  const first = await opts.complete('messages-1', messages)
  const firstDrafts = assemble(first, film, profile, LINK_ROOM, shape)
  const firstChecks = Object.fromEntries(
    DRAFTS.map((d) => [d, check(d, firstDrafts, first)]),
  ) as Record<WrittenDraft, Check[]>
  const firstTry = DRAFTS.filter((d) => passed(firstChecks[d]))

  // each draft keeps the model reply it passed with
  const chosen = new Map<WrittenDraft, ModelMessages>(firstTry.map((d) => [d, first]))
  const lastChecks = { ...firstChecks }
  let rounds = 1
  const failed = DRAFTS.filter((d) => !chosen.has(d))
  if (failed.length) {
    rounds = 2
    const problems = failed.flatMap((d) =>
      firstChecks[d].filter((c) => !c.ok).map((c) => `- ${d}: ${c.why ?? c.rule}`),
    )
    const second = await opts.complete('messages-2', [
      ...messages,
      { role: 'assistant', content: JSON.stringify(first) },
      {
        role: 'user',
        content: `Revise ${failed.join(', ')}. Fix every problem below and keep the other messages as they are:\n${problems.join('\n')}\nReply with only the corrected JSON.`,
      },
    ])
    const secondDrafts = assemble(second, film, profile, LINK_ROOM, shape)
    for (const d of failed) {
      const c = check(d, secondDrafts, second)
      lastChecks[d] = c
      if (passed(c)) chosen.set(d, second)
    }
  }

  // the templates, with the same research item, for whatever the model couldn't get right
  const template = draftMessages(film, profile, FILM, {
    opener,
    research: item && source ? { line: source, source, title: item.title } : null,
  })
  const fallback: Drafts = {
    note: template.linkedin,
    afterAccept: template.afterAccept!,
    inmail: template.inmail!,
    email: template.email,
  }
  const writer = {} as FilmMessages['writer']
  const flags: FilmMessages['flags'] = {}
  const drafts = { ...fallback }
  for (const d of DRAFTS) {
    const reply = chosen.get(d)
    if (reply) {
      const stored = assemble(reply, film, profile, FILM, shape)
      ;(drafts as Record<WrittenDraft, unknown>)[d] = stored[d]
      writer[d] = 'model'
    } else {
      writer[d] = 'template'
      flags[d] = lastChecks[d].filter((c) => !c.ok)
    }
  }

  const emailReply = chosen.get('email')
  const line = emailReply ? (item ? emailReply.email.research : null) : source
  return {
    drafts,
    writer,
    flags,
    research: item && line ? { itemUrl: item.url, line } : null,
    model: opts.model,
    rounds,
    firstTry,
  }
}

/* ------------------------------------------------------------ the stand-in model */

const fits = (s: string, max: number) => s.length <= max

/**
 * A rule-based stand-in for the model, used in tests, evals and the no-key demo (through
 * ScriptedProvider). It writes from the same brief the prompt carries, the way a careful model
 * would, so the checks and the assembly can be measured without paying for a model.
 */
export function scriptedMessages(b: MessageBrief): ModelMessages {
  const who = b.candidate
    ? b.role
      ? `I'm applying for the ${b.role} role at ${b.company} and made a short film for the team`
      : `I'd like to work with the ${b.company} team and made a short film for you`
    : `I made a short film for the ${b.company} team`
  const note = [
    `${who}. Would like to connect.`,
    `I made a short film for the ${b.company} team. Would like to connect.`,
    `I made something for ${b.company}.`,
  ].find((n) => fits(n, b.budgets.note))!
  const proofLine = b.proof.length ? `It shows ${b.proof.slice(0, 2).join(' and ')}.` : ''
  const afterAccept = [
    `Thanks for connecting. I made a 30-second film ${b.role ? `for the ${b.role} role at ${b.company}` : `for ${b.company}`}: ${FILM} ${proofLine} ${b.ask}`,
    `Thanks for connecting. Here's the film I made for ${b.company}: ${FILM} ${b.ask}`,
  ]
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .find((t) => fits(t, b.budgets.afterAccept))!
  const inmailBody = [
    `${b.role ? `I saw the ${b.role} role at ${b.company}` : `I've been following ${b.company}`}, and I made a 30-second film for the team: ${FILM} ${proofLine} ${b.ask}`,
    `I made a 30-second film for ${b.company}: ${FILM} ${b.ask}`,
  ]
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .find((t) => fits(t, b.budgets.inmailBody))!
  const subjects = [
    b.role ? `${b.company}'s ${b.role} role: a 30-second film` : '',
    `A 30-second film for ${b.company}`,
    b.company,
  ].filter(Boolean)
  const opening = b.role
    ? `I saw the ${b.role} role at ${b.company}`
    : `I've been following what ${b.company} is building`
  // what the post says, in their words, tied to why it matters to the sender
  const research = b.research
    ? `Your post says ${lowerFirst(b.research.summary.replace(/[.]$/, ''))}, ${b.candidate ? 'which is the work I want to do' : 'which is where we fit'}`
    : null
  const bring = b.candidate ? "What I'd bring" : 'What we have done for teams like yours'
  const fit = b.proof.length
    ? `${bring}: ${b.proof.slice(b.opener === 'proof' ? 1 : 0, 3).join('; ') || b.proof[0]}`
    : ''
  const ask = 'Could we find 15 minutes this week?'
  // keep inside the word budget: drop the extra proof first, then the research line
  const parts = (f: string, r: string | null) => [opening, r ?? '', f, ask].join(' ')
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length
  const shortFit = b.proof.length
    ? `${bring}: ${b.proof[b.opener === 'proof' ? 1 : 0] ?? b.proof[0]}`
    : ''
  const [f, r] =
    words(parts(fit, research)) <= b.budgets.emailWords
      ? [fit, research]
      : words(parts(shortFit, research)) <= b.budgets.emailWords
        ? [shortFit, research]
        : [shortFit, null]
  return {
    note,
    afterAccept,
    inmail: {
      subject: subjects.find((s) => fits(s, b.budgets.inmailSubject)) ?? b.company,
      body: inmailBody,
    },
    email: {
      subject: subjects.find((s) => fits(s, MESSAGE_LIMITS.inmailSubject)) ?? b.company,
      opening,
      research: r,
      fit: f,
      ask,
    },
  }
}

const lowerFirst = (s: string) =>
  /^[A-Z][a-z]/.test(s) && !/^I\b/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s
