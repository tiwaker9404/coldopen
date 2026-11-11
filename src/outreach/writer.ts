/**
 * The model writes the messages that carry a film: the LinkedIn connection note, the message
 * once they accept, an InMail and the warm email. It writes text only, from the film's own
 * facts. Code adds the greeting, the film's link and the signature, checks every draft with
 * checkMessage, sends failed drafts back once with the reasons, and swaps any draft that still
 * fails for its template. The same shape as the script writer (src/script/writer.ts).
 *
 * A job seeker's drafts are written in the voice (voice.ts): their work first, from the sender's
 * own homework, the film as a tease about their work, what the sender built, one real question
 * and thanks. Their prompt carries no proof and no role title: the film shows the proof, and a
 * job title in the prompt ends up in the message. A seller's prompt is unchanged.
 */
import { z } from 'zod'
import { type Homework, type HomeworkItem, pickResearch } from '../brand/homework.ts'
import type { FilmResult } from '../film.ts'
import { type ChatMessage, estimateTokens } from '../llm/types.ts'
import { BANNED, BEGGING, TASTE_RULES } from '../script/taste.ts'
import type { Profile } from '../script/types.ts'
import {
  type Check,
  type CheckContext,
  checkMessage,
  emailWords,
  FILM_LENGTH,
  knownFor,
  MESSAGE_LIMITS,
  type MessageKind,
  passed,
} from './checks.ts'
import { contextFor, draftMessages, midSentence, type Opener } from './messages.ts'
import {
  homeworkLine,
  JOB_WORDS,
  lowerStart,
  OFFER,
  type SenderHomework,
  SIGN_OFF,
  THANKS,
  VOICE_RULES,
} from './voice.ts'

/** A seller's reply. It never writes the link, the greeting or the signature. */
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
export type SalesMessages = z.infer<typeof MessagesSchema>

/**
 * A job seeker's reply, in the voice. The email comes in the parts the templates have: the
 * opening (their homework, or what their homepage leads with), the tease that carries [film],
 * the line about what the sender built (null without profile.creator), the question and the
 * 15-minute offer. Code adds the greeting, "Thanks for reading," and the signature.
 */
export const WarmMessagesSchema = z.object({
  note: z.string(),
  afterAccept: z.string(),
  inmail: z.object({ subject: z.string(), body: z.string() }),
  email: z.object({
    subject: z.string(),
    opening: z.string(),
    tease: z.string(),
    creator: z.string().nullable(),
    question: z.string(),
    offer: z.string(),
  }),
})
export type WarmMessages = z.infer<typeof WarmMessagesSchema>

/** The model's reply, in the shape its preset asks for */
export type ModelMessages = SalesMessages | WarmMessages
export const isWarm = (r: ModelMessages): r is WarmMessages => 'tease' in r.email

/** The reply's shape for a preset: a job seeker's in the voice, everyone else's as before */
export const messagesSchemaFor = (preset: Profile['preset']): z.ZodType<ModelMessages> =>
  (preset === 'candidate' ? WarmMessagesSchema : MessagesSchema) as z.ZodType<ModelMessages>

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
  /**
   * a job seeker's homework as the model was given it, so the API can tell when the sender saved
   * new homework after the drafts were written (and offer to write them again)
   */
  sender?: SenderHomework | null
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
const filmLine = (film: MessageFilm) => `I made a ${FILM_LENGTH} film ${forWhat(film)}:`
/** How a job seeker's after-accept message and InMail end, as the templates do */
const DM_THANKS = 'Thank you for your time,'

/** How the email is laid out: the opener it leads with, research, and the sender's saved question */
export interface Shape {
  opener: Opener
  research: boolean
  /** a job seeker's saved question, which the email carries word for word */
  saved?: string | null
}

/**
 * The model's text with the parts code owns: the greeting, the link and the signature, laid out
 * as the templates are. With `link` = LINK_ROOM for checking, FILM for storing.
 */
export function assemble(
  reply: ModelMessages,
  film: MessageFilm,
  profile: Profile,
  link: string,
  o: Shape,
): Drafts {
  if (isWarm(reply)) return assembleWarm(reply, film, profile, link, o)
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** A thanks the model closed with anyway: code adds its own, so it would say it twice */
const CLOSING_THANKS = new RegExp(
  `(^|[.?!]\\s+)(${THANKS.map(escapeRe).join('|')})\\b[^.?!\\n]*[.,!]?\\s*$`,
  'i',
)
const dropClosingThanks = (t: string) => t.replace(CLOSING_THANKS, '$1').trim()
/** "a 30 second film" is the film line's own phrase; code owns the film's length, so it fixes the spelling */
const FILM_PHRASE = /\b30[\s‐-―-]*sec(?:ond)?s?\s+(film|video)\b/gi
const FILM_WORD = /\b(film|video)s?\b/i

/** The tease, with the link on its own line where [film] was, as the template email has it */
function teaseLines(tease: string, link: string): string[] {
  const t = tease.replace(FILM_PHRASE, `${FILM_LENGTH} film`).trim()
  const parts = t.split(FILM)
  // no [film], or two: written as is, so has_link says what's wrong
  if (parts.length !== 2) return [sentence(t.replaceAll(FILM, link))]
  const [before, after] = parts.map((p) => p.trim()) as [string, string]
  return [...(before ? [before] : []), link, ...(after ? [after] : [])]
}

/**
 * What the sender built, as the model wrote it. A line that says "film" would mention the film
 * twice, so it's cut to the name, as the templates do.
 */
function creatorLine(line: string | null, c: Profile['creator']): string {
  if (!c || !line?.trim()) return ''
  return FILM_WORD.test(line) ? `I built the tool that made it, ${c.name}.` : sentence(line)
}

const norm = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[?.!]+$/, '')

/**
 * The email's question: the model's, which carries the sender's saved question word for word
 * when there is one. A model that rephrased it gets the saved question back, said the way the
 * templates say it: the sender wrote it on purpose.
 */
function questionLine(q: string, saved: string | null | undefined, company: string, o: Opener) {
  const mine = q.replace(/\s+/g, ' ').trim()
  if (!saved?.trim() || norm(mine).includes(norm(saved))) return mine
  const asked = saved.replace(/\s+/g, ' ').trim().replace(/[.!]$/, '').replace(/\?*$/, '?')
  return o === 'question'
    ? `I've had one question about ${company} in mind: ${midSentence(asked)}`
    : `One thing I wondered: ${midSentence(asked)}`
}

/**
 * A job seeker's drafts, laid out as the step 2 templates are. The email: greeting, (the
 * question, when the question leads), the opening, the tease with the link on its own line,
 * what the sender built, (the question, when the homework leads) and the offer, then "Thanks
 * for reading," and the signature. The after-accept message and InMail end "Thank you for your
 * time," and the first name.
 */
function assembleWarm(
  reply: WarmMessages,
  film: MessageFilm,
  profile: Profile,
  link: string,
  o: Shape,
): Drafts {
  const first = firstName(profile)
  const dm = (t: string) =>
    [hello, '', dropClosingThanks(t.trim()).replaceAll(FILM, link), '', DM_THANKS, first].join('\n')
  const e = reply.email
  const lead: Opener = o.opener === 'question' ? 'question' : 'homework'
  const q = questionLine(e.question, o.saved, film.company, lead)
  const offer = sentence(e.offer)
  const creator = creatorLine(e.creator, profile.creator)
  const body = [
    hello,
    '',
    ...(lead === 'question' ? [q, ''] : []),
    sentence(e.opening),
    '',
    ...teaseLines(e.tease, link),
    ...(creator ? ['', creator] : []),
    '',
    (lead === 'question' ? [offer] : [q, offer]).filter(Boolean).join(' '),
    '',
    SIGN_OFF,
    profile.sender.name,
    profile.cta.contact,
  ].join('\n')
  return {
    note: `${hello} ${reply.note.trim()}${noteSign(profile)}`,
    afterAccept: dm(reply.afterAccept),
    inmail: { subject: reply.inmail.subject.trim(), body: dm(reply.inmail.body) },
    email: { subject: e.subject.trim(), body },
  }
}

/** Room the model has for its own words, after the parts code adds */
export function budgets(film: MessageFilm, profile: Profile, saved?: string | null) {
  const first = firstName(profile)
  if (profile.preset === 'candidate') {
    const wrap =
      [hello, '', '', '', DM_THANKS, first].join('\n').length + LINK_ROOM.length - FILM.length
    const frame = emailWords([hello, SIGN_OFF, profile.sender.name, profile.cta.contact].join('\n'))
    return {
      note: MESSAGE_LIMITS.note - `${hello} `.length - noteSign(profile).length,
      afterAccept: MESSAGE_LIMITS.afterAccept - wrap,
      inmailSubject: MESSAGE_LIMITS.inmailSubject,
      inmailBody: MESSAGE_LIMITS.inmailBody - wrap,
      // a rephrased saved question comes back with "I've had one question about <company> in mind:"
      emailWords: MESSAGE_LIMITS.emailWords - frame - (saved ? 9 : 0),
    }
  }
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
  /** the proof the film shows, best first (none for a job seeker: the film shows it) */
  proof: string[]
  best: string
  research: { title: string; summary: string } | null
  opener: Opener
  ask: string
  sender: string
  candidate: boolean
  budgets: ReturnType<typeof budgets>
  /** a job seeker's brief: what the film noticed, the sender's homework and what they built */
  warm?: WarmBrief
}

export interface WarmBrief {
  /** the film's noticed line, about their homepage */
  noticed: string
  /** their own line the film shows, when it's from their site (never from a job post) */
  quote: string
  /** the sender's saved homework, verbatim */
  homework: SenderHomework
  /** what the sender built that made this film */
  creator: { name: string; line: string } | null
}

export function briefFor(
  film: MessageFilm,
  profile: Profile,
  item: HomeworkItem | null,
  opener: Opener,
  sender?: SenderHomework | null,
): MessageBrief {
  if (profile.preset === 'candidate') {
    const raw = film.highlights?.quote
    const fromPost = /post$/.test(raw?.source ?? '')
    const homework: SenderHomework = {
      detail: sender?.detail?.trim() || null,
      question: sender?.question?.trim() || null,
      built: sender?.built ?? null,
    }
    return {
      company: film.company,
      // no role and no requirements: they'd be quoted back as a job pitch
      requirements: [],
      hook: film.script?.hook ?? '',
      headline: film.script?.pitch.headline ?? '',
      // the film shows the proof; the messages never repeat it
      proof: [],
      best: '',
      research: item ? { title: item.title, summary: researchSource(item) } : null,
      opener: opener === 'question' ? 'question' : 'homework',
      ask: OFFER,
      sender: profile.sender.name,
      candidate: true,
      budgets: budgets(film, profile, homework.question),
      warm: {
        noticed: film.script?.noticed ?? '',
        quote: !fromPost && raw?.text ? clean(raw.text) : '',
        homework,
        creator: profile.creator
          ? { name: profile.creator.name, line: profile.creator.line }
          : null,
      },
    }
  }
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
    candidate: false,
    budgets: budgets(film, profile),
  }
}

const SYSTEM = `You write the short messages that carry a ${FILM_LENGTH} personalized film, made by the sender for one company, to one person there.
Write text only. Never write a greeting, a signature or a URL: code adds them. Where the film's link goes, write ${FILM}.

${TASTE_RULES}
(The word limits above are for the film's lines; these messages have their own limits below.)

Reply with only a JSON object of this exact shape:
{"note": string, "afterAccept": string, "inmail": {"subject": string, "body": string}, "email": {"subject": string, "opening": string, "research": string | null, "fit": string, "ask": string}}`

/** A job seeker's system prompt: the same opening line, the film's taste rules left out (they're for the film's lines) */
const WARM_SYSTEM = `You write the short messages that carry a ${FILM_LENGTH} personalized film, made by the sender for one company, to one person there. The sender is curious about the company's work and writes in the first person ("I").
Write text only. Never write a greeting, a signature or a URL: code adds them. Where the film's link goes, write ${FILM}.

Plain words, like a sharp person talking. No flattery ("amazing", "impressive", "love what you're doing"), no filler ("just wanted to", "reach out", "I hope this finds you well"), no exclamation marks, no emoji. Never use these words: ${BANNED.slice(0, 24).join(', ')}.

Reply with only a JSON object of this exact shape:
{"note": string, "afterAccept": string, "inmail": {"subject": string, "body": string}, "email": {"subject": string, "opening": string, "tease": string, "creator": string | null, "question": string, "offer": string}}`

export function buildMessagePrompt(
  film: MessageFilm,
  profile: Profile,
  item: HomeworkItem | null,
  opener: Opener,
  sender?: SenderHomework | null,
): ChatMessage[] {
  const b = briefFor(film, profile, item, opener, sender)
  if (b.warm) return warmPrompt(b, b.warm)
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
- afterAccept: sent once they accept, at most ${b.budgets.afterAccept} characters. Thanks for connecting, then ${FILM} (required, exactly once, where the link goes), then exactly one question: the ask.
- inmail: subject at most ${b.budgets.inmailSubject} characters and names ${b.company}; body at most ${b.budgets.inmailBody} characters, with ${FILM} (required, exactly once, where the link goes) and exactly one question.
- email: no ${FILM} in any part; code adds "I made a ${FILM_LENGTH} film…" and the link right after the opening, so no part mentions the film or a video. subject names ${b.company}, not "inquiry" or "application". opening: one sentence. research: ${b.research ? 'one short sentence restating what the post says in your own words, keeping its key words (the check counts how many of your words come from the post). You may add at most a few words of reaction, such as "which caught my eye". No new claims about what it means for them or for the role' : 'null'}. fit: one or two sentences on why the sender fits, from the proof. ask: one question asking for 15 minutes. All four parts together at most ${b.budgets.emailWords} words. The email has exactly one question, in the ask.
- ${lead}
- Every message names ${b.company}. No exclamation marks. Numbers only from the proof or the role.
- Never beg or ask a favor: no "refer me", "referral", "any openings", "pass my resume", "pick your brain", "just checking in", "I'd be grateful".`
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ]
}

/** The job words, as the prompt and the rewrite request name them */
const JOB_LIST = JOB_WORDS.filter((w) => w !== 'openings' && w !== 'résumé').join(', ')

/**
 * A job seeker's request: what the sender saved and what the film noticed, the voice rules,
 * then what each draft holds. No proof, no role title and no requirements.
 */
function warmPrompt(b: MessageBrief, w: WarmBrief): ChatMessage[] {
  const c = b.company
  const hw = w.homework
  const opening = hw.built
    ? `opening: one or two sentences on what the sender built with ${c}, in their words from HOMEWORK, with its link, as "I built something small with ${c}: …".`
    : hw.detail
      ? `opening: one or two sentences from what the sender saved about using ${c}, in their words from HOMEWORK, as "I've been using ${c}, and …" (or their own sentence when it starts with "I").`
      : b.research
        ? `opening: one sentence on what THEIR LATEST POST says, in its words ("I read that …"). The sender saved no homework, so don't say they used, tried or built anything.`
        : `opening: one sentence on what their homepage leads with (NOTICED), in their words. The sender saved no homework, so don't say they used, tried or built anything.`
  const question = hw.question
    ? `question: exactly "${hw.question}", the sender's own question, word for word.`
    : `question: one question about something in ${b.research ? 'THEIR LATEST POST, ' : ''}NOTICED${hw.detail || hw.built ? ' or the homework' : ''}, using one of their words. About their work, not about the sender.`
  const creator = w.creator
    ? `creator: one sentence starting "I built the tool that made it, ${w.creator.name}," saying what it does in the sender's words from CREATOR, without the word "film".`
    : 'creator: null (the sender has no CREATOR line).'
  const user = `COMPANY: ${c}
NOTICED (what the film says about their homepage): ${w.noticed || '(nothing)'}${w.quote ? `\nTHEIR LINE THE FILM SHOWS: "${w.quote}"` : ''}
${b.research ? `THEIR LATEST POST: "${b.research.title}": ${b.research.summary}` : 'THEIR LATEST POST: none'}
HOMEWORK (the sender's own words; don't add experiences they didn't write):
- using their product: ${hw.detail ?? 'nothing saved'}
- built with it: ${hw.built ? `${hw.built.line} (${hw.built.url})` : 'nothing saved'}
- their question: ${hw.question ?? 'nothing saved'}
CREATOR (what the sender built that made this film): ${w.creator ? `${w.creator.name}: ${w.creator.line}` : 'none'}
SENDER: ${b.sender}

${VOICE_RULES}

THE MESSAGES (limits are checked in code; going over means a rewrite):
- note: a LinkedIn connection note, at most ${b.budgets.note} characters. One line about their work (the homework, or what NOTICED says) that says "${c}" in full, and one curious line. No link, no ${FILM}, no ask for their time, at most one question.
- afterAccept: sent once they accept, at most ${b.budgets.afterAccept} characters. Thanks for connecting, one sentence from the homework (or NOTICED) that says "${c}" in full, the tease with ${FILM} (required, exactly once, where the link goes), then the question. No ask for their time. Code adds "Thank you for your time," and the name, so don't thank them at the end.
- inmail: subject at most ${b.budgets.inmailSubject} characters, about their work, names ${c}; body at most ${b.budgets.inmailBody} characters: the homework (or NOTICED), the tease with ${FILM} (required, exactly once), the question. No ask for their time. Code adds the thanks and the name.
- email, in parts, all together at most ${b.budgets.emailWords} words. Code adds the greeting, "Thanks for reading," and the signature.${b.opener === 'question' ? ' Code puts the question first, then the opening.' : ''}
  - subject: their work (the post's title, or what the homework is about), names ${c}. Never "inquiry", "application" or a job word.
  - ${opening}
  - tease: one sentence saying what's in the film in terms of their work, ending "into a ${FILM_LENGTH} film: ${FILM}", for example "I put what I'd try next with ${c}'s <their thing> into a ${FILM_LENGTH} film: ${FILM}". The only part that mentions the film.
  - ${creator}
  - ${question}
  - offer: the soft 15-minute offer, as a statement, not a question: "${OFFER}" or close to it.
- Every message says "${c}" in full (not "you", "your team" or a short name): the check looks for it. No numbers at all, except "15 minutes" and "${FILM_LENGTH}". No exclamation marks.
- Never beg or ask a favor: no ${BEGGING.slice(0, 8)
    .map((x) => `"${x}"`)
    .join(', ')}.`
  return [
    { role: 'system', content: WARM_SYSTEM },
    { role: 'user', content: user },
  ]
}

/** The whole request's size in tokens, for Groq's free tier (8k a minute) */
export const promptTokens = (messages: ChatMessage[]) =>
  estimateTokens(messages.map((m) => m.content).join('\n'))

/* ------------------------------------------------------------ write, check, fall back */

/**
 * What the rewrite request says about a failed check: its why, except where the model needs to
 * be told what to write instead. A missing or doubled link: it can't write the link itself. In a
 * job seeker's drafts, the voice rules say what to do: drop the job word, end with thanks, ask
 * about their work, leave the numbers to the film, keep to the homework.
 */
export function resend(
  c: Check,
  o: { warm?: boolean; saved?: string | null; company?: string } = {},
): string {
  if (c.rule === 'has_link')
    return /\d+ times/.test(c.why ?? '')
      ? `Put ${FILM} where the link goes, once only`
      : `Put ${FILM} where the link goes`
  if (!o.warm) return c.why ?? c.rule
  const quoted = c.why?.match(/^(?:Says|Claims) "(.+?)"(?:, which|;)/)?.[1]
  switch (c.rule) {
    case 'not_job_pitch':
      return `Drop the word "${quoted ?? 'role'}" and every other job word (${JOB_LIST}); talk about their product and their work instead`
    case 'thanks':
      return 'End with thanks: the last words before the name are "Thanks for reading" or "Thank you for your time", with nothing after them'
    case 'curious':
      return o.saved
        ? `Use the sender's saved question word for word: "${o.saved}"`
        : 'Ask about something in their post, site or product: one question that uses a word from THEIR LATEST POST, NOTICED or the homework'
    case 'no_proof_numbers':
      return `Take out ${quoted ? `"${quoted}"` : 'the number'}: the film shows the numbers, so the message has none`
    case 'homework_grounded':
      return `Take out "${quoted ?? 'the claim'}": only say you used, tried or built something when HOMEWORK or CREATOR says so, in the sender's words; otherwise write about their product without "I tried" or "I used"`
    case 'names_company':
      return `Say "${o.company ?? 'the company'}" in full, exactly as written in COMPANY`
    case 'film_once':
      return `Mention the film only in the tease, as "a ${FILM_LENGTH} film" right before ${FILM}`
    default:
      return c.why ?? c.rule
  }
}

/**
 * One model call writes all four drafts. Code assembles and checks each; drafts that fail go
 * back once with the reasons, and any draft that still fails is replaced by its template.
 */
export async function writeMessages(opts: {
  film: MessageFilm
  profile: Profile
  /** what they've published lately (their posts) */
  homework: Homework | null | undefined
  /** a job seeker's own homework for this film: their detail, question and small build */
  sender?: SenderHomework | null
  opener: Opener
  complete: CompleteMessages
  model: string
  now?: number
}): Promise<FilmMessages> {
  const { film, profile } = opts
  const warm = profile.preset === 'candidate'
  const sender = warm ? (opts.sender ?? null) : null
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
  const opener = briefFor(film, profile, item, opts.opener, sender).opener
  // a job seeker's drafts are checked in the voice, against their own homework, as the API checks them
  const ctx: CheckContext = warm
    ? contextFor(
        { ...film, ...(opts.homework ? { homework: opts.homework } : {}) },
        profile,
        LINK_ROOM,
        sender,
      )
    : {
        company: film.company,
        // knownFor already counts the email's 15-minute ask as ours to say
        known: knownFor(film, profile, opts.homework),
        link: LINK_ROOM,
      }
  const check = (d: WrittenDraft, drafts: Drafts, reply: ModelMessages): Check[] =>
    checkMessage(d satisfies MessageKind, drafts[d], {
      ...ctx,
      research:
        d === 'email' && source && !isWarm(reply) && reply.email.research
          ? { line: reply.email.research, source }
          : null,
    })
  const shape: Shape = { opener, research: !!item, saved: sender?.question ?? null }
  const hints = { warm, saved: sender?.question ?? null, company: film.company }

  const messages = buildMessagePrompt(film, profile, item, opts.opener, sender)
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
      firstChecks[d].filter((c) => !c.ok).map((c) => `- ${d}: ${resend(c, hints)}`),
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
    ...(sender ? { homework: sender } : {}),
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
  // a job seeker's email has no research line of its own: the post is the one both it and the
  // template were given, so the API reads the same post for either
  const line = warm
    ? source
    : emailReply
      ? item && !isWarm(emailReply)
        ? emailReply.email.research
        : null
      : source
  return {
    drafts,
    writer,
    flags,
    research: item && line ? { itemUrl: item.url, line } : null,
    model: opts.model,
    rounds,
    firstTry,
    ...(warm ? { sender } : {}),
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
  if (b.warm) return scriptedWarm(b, b.warm)
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
    `Thanks for connecting. I made a ${FILM_LENGTH} film ${b.role ? `for the ${b.role} role at ${b.company}` : `for ${b.company}`}: ${FILM} ${proofLine} ${b.ask}`,
    `Thanks for connecting. Here's the film I made for ${b.company}: ${FILM} ${b.ask}`,
  ]
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .find((t) => fits(t, b.budgets.afterAccept))!
  const inmailBody = [
    `${b.role ? `I saw the ${b.role} role at ${b.company}` : `I've been following ${b.company}`}, and I made a ${FILM_LENGTH} film for the team: ${FILM} ${proofLine} ${b.ask}`,
    `I made a ${FILM_LENGTH} film for ${b.company}: ${FILM} ${b.ask}`,
  ]
    .map((t) => t.replace(/\s+/g, ' ').trim())
    .find((t) => fits(t, b.budgets.inmailBody))!
  const subjects = [
    b.role ? `${b.company}'s ${b.role} role: a ${FILM_LENGTH} film` : '',
    `A ${FILM_LENGTH} film for ${b.company}`,
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

/** A line of theirs that can be quoted: no question, no shout, no word that reads as ours */
const quotable = (s: string) => {
  const t = s.toLowerCase().replace(/[‘’]/g, "'")
  return !!s && !/[?!]/.test(s) && !BANNED.some((x) => t.includes(x.replace(/[‘’]/g, "'")))
}

/**
 * A job seeker's drafts from the stand-in: the sender's homework (or their post, or what their
 * homepage leads with), the tease, what the sender built, their saved question (or one about the
 * post or homepage), the offer. Only the sender's words and the company's: no claims of its own.
 */
function scriptedWarm(b: MessageBrief, w: WarmBrief): WarmMessages {
  const c = b.company
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length
  const rawTitle = b.research ? clean(b.research.title) : ''
  const title = quotable(rawTitle) ? rawTitle : ''
  const post = b.research ? { title, line: clean(b.research.summary) } : null
  const rawPromise = w.noticed.match(/“([^”]+)”/)?.[1]
  const promise = rawPromise && quotable(rawPromise) ? clean(rawPromise) : ''
  const mine = homeworkLine(c, w.homework, post)
  const opening =
    mine?.line ??
    (promise
      ? `${c}'s homepage leads with "${promise}".`
      : `I've been reading about what ${c} is building.`)
  const aboutPost = mine?.kind === 'post'
  const saved = w.homework.question?.replace(/\s+/g, ' ').trim()
  const question = saved
    ? saved.replace(/[.!]$/, '').replace(/\?*$/, '?')
    : title && !aboutPost
      ? `What have customers said since "${title}" went out?`
      : promise && !opening.includes(promise)
        ? `What made you lead the homepage with "${promise}"?`
        : `What's the hardest part of what ${c} is building right now?`
  const tease = `I put what I'd try next with ${c} into a ${FILM_LENGTH} film: ${FILM}`
  const creator = w.creator
    ? FILM_WORD.test(w.creator.line)
      ? `I built the tool that made it, ${w.creator.name}.`
      : `I built the tool that made it, ${w.creator.name}: ${lowerStart(clean(w.creator.line))}.`
    : null
  const offer = OFFER
  // inside the word budget: drop what the sender built first, then the homework for a plainer opening
  const total = (o: string, cr: string | null) =>
    words([o, tease, cr ?? '', question, offer].join(' '))
  const plain = `I've been reading about what ${c} is building.`
  const [open, made] =
    total(opening, creator) <= b.budgets.emailWords
      ? [opening, creator]
      : total(opening, null) <= b.budgets.emailWords
        ? [opening, null]
        : [plain, null]

  const tail = `Curious how most ${c} customers use it.`
  const noteLead = w.homework.built
    ? `I built something small with ${c}: ${lowerStart(clean(w.homework.built.line))}.`
    : mine?.kind === 'detail'
      ? mine.line
      : ''
  const note =
    [
      noteLead && `${noteLead} ${tail}`,
      noteLead,
      saved && `I've been looking at ${c} and wondered: ${question}`,
      title && `I read ${c}'s post "${title}". Curious what customers make of it.`,
      `I've been reading about what ${c} is building and would like to connect.`,
      `Curious about what ${c} is building.`,
    ].find((n) => !!n && fits(n, b.budgets.note) && n.includes(c)) ??
    `Curious about what ${c} is building.`
  const dms = (hello: string) =>
    [`${hello}${opening} ${tease} ${question}`, `${hello}${tease} ${question}`].map((t) =>
      t.replace(/\s+/g, ' ').trim(),
    )
  const afterAccept =
    dms('Thanks for connecting. ').find((t) => fits(t, b.budgets.afterAccept)) ??
    dms('Thanks for connecting. ').at(-1)!
  const inmailBody = dms('').find((t) => fits(t, b.budgets.inmailBody)) ?? dms('').at(-1)!
  const subjects = [
    title
      ? title.toLowerCase().includes(c.toLowerCase())
        ? title
        : `${c}'s ${lowerFirst(title)}`
      : '',
    w.homework.built ? `Something I built with ${c}` : '',
    w.homework.detail ? `Notes from using ${c}` : '',
    `A question about ${c}`,
  ].filter((s) => !!s && fits(s, MESSAGE_LIMITS.inmailSubject))
  return {
    note,
    afterAccept,
    inmail: { subject: subjects[0] ?? c, body: inmailBody },
    email: {
      subject: subjects[0] ?? c,
      opening: open,
      tease,
      creator: made,
      question,
      offer,
    },
  }
}
