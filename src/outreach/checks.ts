/**
 * Checks for every message coldopen drafts: the LinkedIn note, the message once they accept,
 * InMail, the warm email and the follow-ups. Each rule comes back as passed or failed, with a
 * plain sentence saying why it failed, so a model draft can be kept, sent back for a rewrite
 * with the reasons, or swapped for its template, and the person can see why.
 * Pure: no network, no clock.
 */
import type { Homework } from '../brand/homework.ts'
import type { FilmResult } from '../film.ts'
import { numbersIn, overlap, sameNumber } from '../script/checks.ts'
import { BANNED, BEGGING } from '../script/taste.ts'
import type { Profile } from '../script/types.ts'
import { builtLine, detailLine, endsWithThanks, jobWordsIn, type SenderHomework } from './voice.ts'

export const MESSAGE_LIMITS = {
  /** a connection note on a free LinkedIn account */
  note: 200,
  afterAccept: 500,
  inmailSubject: 60,
  /** short InMails get more replies than long ones */
  inmailBody: 400,
  emailWords: 125,
} as const

export type MessageKind =
  | 'note'
  | 'afterAccept'
  | 'inmail'
  | 'email'
  | 'followUp'
  | 'lastNote'
  | 'linkedinFollowUp'

export type CheckRule =
  | 'length'
  | 'grounded'
  | 'no_begging'
  | 'one_ask'
  | 'names_company'
  | 'no_link'
  | 'has_link'
  | 'banned'
  | 'no_exclamation'
  | 'research_grounded'
  | 'film_once'
  | 'not_job_pitch'
  | 'thanks'
  | 'no_proof_numbers'
  | 'curious'
  | 'homework_grounded'
  | 'no_repeated_numbers'

export interface Check {
  rule: CheckRule
  ok: boolean
  /** why it failed, in a plain sentence */
  why?: string
}

export interface CheckContext {
  company: string
  /** everything a number may come from: site facts, profile proof and homework, joined */
  known: string
  /** the film's share link */
  link?: string
  /** the email's research line and the post text it came from */
  research?: { line: string; source: string } | null
  /**
   * a job seeker's message: the voice rules apply (voice.ts): no job words, thanks at the end,
   * no proof numbers, one curious question and only the experiences their homework says.
   * voiceFor builds the fields below.
   */
  candidate?: boolean
  /** what they wrote and do (their site, their posts, the sender's notes on their product): a curious question shares a word with it */
  theirs?: string
  /** the sender's own saved question for them, which is always curious */
  question?: string | null
  /** the values of the proof the film shows: the film says them, so the messages don't */
  proof?: string[]
  /**
   * what a first-person claim ("I tried…", "I built…") may rest on: the sender's saved detail and
   * built line, and the names of what they built (their creator line, a related project)
   */
  own?: { claims: string[]; names: string[] }
}

/**
 * How close the research line must stay to what the company wrote. The same bar checkScript
 * uses to say a line "repeats the fact" (overlap > 0.6): at that point it's a restatement, not
 * an invention. Here a restatement is exactly what we want.
 */
export const RESEARCH_OVERLAP = 0.6

/** Email-like drafts count words; LinkedIn drafts count characters. */
const EMAILS: MessageKind[] = ['email', 'followUp', 'lastNote']
/** Drafts that must carry exactly one question for them to answer. */
const ONE_ASK: MessageKind[] = ['afterAccept', 'inmail', 'email']
const NAMES_COMPANY: MessageKind[] = ['note', 'afterAccept', 'inmail', 'email']
const HAS_LINK: MessageKind[] = ['afterAccept', 'inmail', 'email']
/** A job seeker's first messages, which carry the voice: their work, not the job */
const VOICE: MessageKind[] = ['note', 'afterAccept', 'inmail', 'email']
/** The ones that end with thanks before the signature */
const THANKED: MessageKind[] = ['afterAccept', 'inmail', 'email']
/** The ones that ask one real question about their work */
const CURIOUS: MessageKind[] = ['afterAccept', 'email']

const URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi
const PLACEHOLDER = /\[[^\]]*\]/g

/**
 * How long every film is. The messages' film lines ("I made a 30-second film for…") are written
 * from this, and knownFor counts it as known, so the two can't drift apart.
 */
export const FILM_SECONDS = 30
/** "30-second", as the film lines say it */
export const FILM_LENGTH = `${FILM_SECONDS}-second`
/**
 * The film's length, however a draft spells it ("30-second", "30 seconds", "30‑sec"): coldopen's
 * own fact, true of every film, so it needs no source.
 */
const FILM_LENGTH_RE = new RegExp(`\\b${FILM_SECONDS}[\\s\u2010-\u2015-]*sec(?:ond)?s?\\b`, 'gi')
/**
 * What knownFor says about the film's length. It's known as a phrase, not as a bare number: a
 * bare 30 would also ground "cut churn 30%".
 */
export const FILM_KNOWN = `Every film is ${FILM_LENGTH}, ${FILM_SECONDS} seconds long.`

/** The one email line allowed to say "film": the one code writes ("I made a 30-second film for …") */
const isFilmLine = (line: string) => line.includes(`${FILM_LENGTH} film`)
const FILM_WORDS = /\b(film|video)s?\b/i

/** Where a stored draft keeps the film until the real link goes in (writer.ts FILM) */
const FILM_SLOT = '[film]'
/**
 * How many places a draft carries the film: its link, or the [film] slot it's stored with. The
 * panel shows that one place as a GIF in the email, an "Attach the GIF here" slot on LinkedIn
 * with the link kept as a backup, or the link itself, and each is the film once.
 */
const filmPlaces = (text: string, link: string) =>
  text.split(link).length - 1 + (link === FILM_SLOT ? 0 : text.split(FILM_SLOT).length - 1)

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** curly apostrophes count as straight ones, so "I’d be grateful for" still matches */
const straight = (s: string) => s.replace(/[‘’]/g, "'")
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

/** Words in an email's body. Lines that are only a link aren't the message. checkEmail counts the same way. */
export const emailWords = (body: string) =>
  body
    .split('\n')
    .filter((l) => !/^https?:\/\//.test(l.trim()))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length

function lengthChecks(kind: MessageKind, subject: string, body: string): Check[] {
  const chars = (n: number, max: number, what = '') =>
    n <= max
      ? { rule: 'length' as const, ok: true }
      : { rule: 'length' as const, ok: false, why: `${what}${n} of ${max} characters` }
  if (kind === 'inmail')
    return [
      chars(subject.length, MESSAGE_LIMITS.inmailSubject, 'The subject is '),
      chars(body.length, MESSAGE_LIMITS.inmailBody, 'The message is '),
    ]
  if (EMAILS.includes(kind)) {
    const n = emailWords(body)
    return [
      n <= MESSAGE_LIMITS.emailWords
        ? { rule: 'length', ok: true }
        : { rule: 'length', ok: false, why: `${n} of ${MESSAGE_LIMITS.emailWords} words` },
    ]
  }
  // a follow-up on LinkedIn goes to someone already connected, so it gets a message's room
  const max = kind === 'note' ? MESSAGE_LIMITS.note : MESSAGE_LIMITS.afterAccept
  return [chars(body.length, max)]
}

/**
 * The numbers a sentence says twice the way a quoted change card does: a sentence with an arrow
 * ("6h → 45m") that repeats any of its numbers, or one that says the same pair of numbers twice
 * ("from 6 to 45 … 6 hours to 45 minutes"). "From 2 days to 2 hours" is one pair, so it's fine.
 */
export function repeatedNumbers(text: string): string[] {
  const twice = new Set<string>()
  for (const sentence of text.split(/(?<=[.?!])\s+|\n+/)) {
    const ns = (sentence.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ''))
    const arrow = /→|->/.test(sentence)
    const seen = new Set<string>()
    const pairs = new Set<string>()
    ns.forEach((n, i) => {
      if (arrow && seen.has(n)) twice.add(n)
      seen.add(n)
      if (i > 0 && ns[i - 1] !== n) {
        const pair = `${ns[i - 1]}|${n}`
        if (pairs.has(pair)) {
          twice.add(ns[i - 1]!)
          twice.add(n)
        }
        pairs.add(pair)
      }
    })
  }
  return [...twice]
}

/**
 * Every rule that applies to this kind of message, each passed or failed. A draft is good to
 * keep when every check passes (see passed).
 */
export function checkMessage(
  kind: MessageKind,
  text: string | { subject: string; body: string },
  ctx: CheckContext,
): Check[] {
  const subject = typeof text === 'string' ? '' : text.subject
  const body = typeof text === 'string' ? text : text.body
  const all = `${subject}\n${body}`
  const lower = straight(all).toLowerCase()
  const checks: Check[] = [...lengthChecks(kind, subject, body)]

  // grounding: the link, URLs and placeholders aren't claims, so their digits don't count
  const known = numbersIn(ctx.known.replaceAll(FILM_KNOWN, ' '))
  const claims = (ctx.link ? all.replaceAll(ctx.link, ' ') : all)
    .replace(URL, ' ')
    .replace(PLACEHOLDER, ' ')
    .replace(FILM_LENGTH_RE, ' ')
  const unknown = [...new Set(numbersIn(claims))].filter(
    (n) => !known.some((k) => sameNumber(k, n)),
  )
  checks.push(
    unknown.length
      ? {
          rule: 'grounded',
          ok: false,
          why: `Says ${unknown.map((n) => `"${n}"`).join(' and ')} but neither their site nor your profile does`,
        }
      : { rule: 'grounded', ok: true },
  )

  // a change card ("6h → 45m") quoted with its label ("report prep, from 6 hours to 45 minutes")
  // says the same numbers twice in one breath
  const twice = repeatedNumbers(claims)
  checks.push(
    twice.length
      ? {
          rule: 'no_repeated_numbers',
          ok: false,
          why: `Says ${twice.map((n) => `"${n}"`).join(' and ')} twice in one sentence; quote the proof's label alone`,
        }
      : { rule: 'no_repeated_numbers', ok: true },
  )

  const begs = BEGGING.filter((b) =>
    new RegExp(`(^|[^a-z0-9'])${escapeRe(straight(b).toLowerCase())}($|[^a-z0-9'])`).test(lower),
  )
  checks.push(
    begs.length
      ? {
          rule: 'no_begging',
          ok: false,
          why: `Asks a favor with "${begs[0]}"; offer the film and ask one small thing instead`,
        }
      : { rule: 'no_begging', ok: true },
  )

  // questions are counted in the body: a subject that asks is still a subject
  const asks = count(body, /\?/g)
  if (ctx.candidate && VOICE.includes(kind)) checks.push(voiceAsk(kind, body))
  else if (kind === 'note')
    checks.push(
      asks === 0
        ? { rule: 'one_ask', ok: true }
        : {
            rule: 'one_ask',
            ok: false,
            why: 'Asks a question; the note only asks to connect, and the ask comes once they accept',
          },
    )
  else if (ONE_ASK.includes(kind))
    checks.push(
      asks === 1
        ? { rule: 'one_ask', ok: true }
        : {
            rule: 'one_ask',
            ok: false,
            why:
              asks === 0
                ? 'Has no question; end on one small, clear ask'
                : `Asks ${asks} questions; keep one, so it's easy to answer`,
          },
    )
  else if (asks > 1)
    // a follow-up may close without asking again, but never asks twice
    checks.push({
      rule: 'one_ask',
      ok: false,
      why: `Asks ${asks} questions; keep one, so it's easy to answer`,
    })
  else checks.push({ rule: 'one_ask', ok: true })

  if (NAMES_COMPANY.includes(kind)) {
    const named = !!ctx.company.trim() && lower.includes(straight(ctx.company).toLowerCase())
    checks.push(
      named
        ? { rule: 'names_company', ok: true }
        : { rule: 'names_company', ok: false, why: `Doesn't name ${ctx.company}` },
    )
  }

  if (kind === 'note') {
    const linked = count(body, URL) > 0 || (!!ctx.link && body.includes(ctx.link))
    checks.push(
      linked
        ? {
            rule: 'no_link',
            ok: false,
            why: 'Has a link; a note with a link reads as spam, so the film goes in the message once they accept',
          }
        : { rule: 'no_link', ok: true },
    )
  }
  if (HAS_LINK.includes(kind) && ctx.link) {
    const n = filmPlaces(all, ctx.link)
    checks.push(
      n === 1
        ? { rule: 'has_link', ok: true }
        : {
            rule: 'has_link',
            ok: false,
            why:
              n === 0
                ? 'Leaves out the link to the film'
                : `Has the film's link ${n} times; once is enough`,
          },
    )
  }

  const banned = BANNED.filter((b) => lower.includes(straight(b)))
  checks.push(
    banned.length
      ? {
          rule: 'banned',
          ok: false,
          why: `Uses "${banned[0]}", which reads as machine-written or salesy`,
        }
      : { rule: 'banned', ok: true },
  )
  checks.push(
    all.includes('!')
      ? { rule: 'no_exclamation', ok: false, why: 'Uses an exclamation mark' }
      : { rule: 'no_exclamation', ok: true },
  )

  // the email says "film" once, in the line code writes before the link; anywhere else in the
  // body says it twice. The subject is a subject, so a film there is fine.
  if (kind === 'email') {
    const lines = body.split('\n')
    const at = lines.findIndex(isFilmLine)
    const rest = lines
      .filter((_, i) => i !== at)
      .join('\n')
      // the link (or its [film] placeholder) isn't the message saying it
      .replaceAll(ctx.link || '\u0000', ' ')
      .replace(URL, ' ')
      .replace(PLACEHOLDER, ' ')
    checks.push(
      FILM_WORDS.test(rest)
        ? {
            rule: 'film_once',
            ok: false,
            why: 'Mentions the film again; the film line already does',
          }
        : { rule: 'film_once', ok: true },
    )
  }

  if (kind === 'email' && ctx.research) {
    const o = overlap(ctx.research.line, ctx.research.source)
    checks.push(
      o >= RESEARCH_OVERLAP
        ? { rule: 'research_grounded', ok: true }
        : {
            rule: 'research_grounded',
            ok: false,
            why: "The research line says things their post doesn't; keep it to what they wrote",
          },
    )
  }
  if (ctx.candidate && VOICE.includes(kind)) checks.push(...voiceChecks(kind, subject, body, ctx))
  return checks
}

/* ------------------------------------------------------------ a job seeker's voice (voice.ts) */

/**
 * A question that asks for their time rather than about their work: "15 minutes", or "could we
 * talk / can you hop on a call". A question about their sales calls is about their work.
 */
const TIME_ASK =
  /\b\d+[\s-]*min(ute)?s?\b|\b(could|can|would|shall|should|may)\s+(we|you|i)\b[^?]*\b(talk|chat|call|meet|speak|connect|hop on|find time|grab time|grab coffee)\b|\b(free|available|open)\s+(for|to)\s+(a\s+)?(quick\s+|short\s+)?(call|chat|talk)\b/i
/** The 15-minute offer said as a statement ("If you ever have 15 minutes, …") */
const TIME_OFFER = /\b\d+[\s-]*min(ute)?s?\b/i
/** "I tried…", "I used…", "I built…", "when I…": the sender claiming an experience */
const CLAIM =
  /\b(I tried|I used|I built|when I|I've been using|I've used|I tested|I played with)\b/i

/**
 * The sentences of a text, each with its end mark. A link is dropped but the punctuation after
 * it stays ("…on your API (https://…)." still ends its sentence), or the next sentence would be
 * read as part of this one.
 */
const sentencesOf = (s: string) =>
  (
    s
      .replace(URL, (u) => ` ${u.match(/[)\].,;:!?]+$/)?.[0]?.replace(/^[)\]]+/, '') ?? ''}`)
      .match(/[^.?!\n]+[.?!]*/g) ?? []
  )
    .map((x) => x.trim())
    .filter(Boolean)
const questionsOf = (s: string) => sentencesOf(s).filter((x) => x.endsWith('?'))

/** Words too common to show a question is about their work */
const COMMON = new Set(
  'what when where which while would could should have your yours youre about most more does like with that this there their them they been being from into just also some much many really curious wonder wondered anyone people team teams thing things think using used something someone else ever here other others over than then were will want wanted know hear love'.split(
    ' ',
  ),
)
const contentWords = (s: string) =>
  new Set(
    straight(s)
      .toLowerCase()
      .replace(/'/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !COMMON.has(w)),
  )
const sharesWord = (a: string, b: string) => {
  const theirs = contentWords(b)
  return [...contentWords(a)].some((w) => theirs.has(w))
}

/**
 * How many questions a job seeker's message asks: the note one curious question at most and no
 * time ask; the after-accept message and InMail one question; the email its curious question
 * and, optionally, the 15-minute offer as a second (or as a statement). Never two asks for time.
 */
function voiceAsk(kind: MessageKind, body: string): Check {
  const qs = questionsOf(body)
  const timeQs = qs.filter((q) => TIME_ASK.test(q))
  const offers = sentencesOf(body).filter((x) => !x.endsWith('?') && TIME_OFFER.test(x))
  const timeAsks = timeQs.length + offers.length
  const fail = (why: string): Check => ({ rule: 'one_ask', ok: false, why })
  if (kind === 'note') {
    if (timeAsks)
      return fail('Asks for their time; the note only says hello, and the ask comes later')
    if (qs.length > 1) return fail(`Asks ${qs.length} questions; a note has room for one at most`)
    return { rule: 'one_ask', ok: true }
  }
  if (timeAsks > 1) return fail('Asks for their time twice; offer the 15 minutes once')
  if (!qs.length) return fail('Has no question; ask one thing about their work')
  const most = kind === 'email' ? 2 : 1
  if (qs.length > most)
    return fail(`Asks ${qs.length} questions; keep one about their work, so it's easy to answer`)
  if (qs.length === 2 && timeQs.length !== 1)
    return fail(
      'Asks 2 questions; the second may only be the 15-minute offer, so keep one about their work',
    )
  return { rule: 'one_ask', ok: true }
}

function voiceChecks(kind: MessageKind, subject: string, body: string, ctx: CheckContext): Check[] {
  const out: Check[] = []
  const all = `${subject}\n${body}`

  const job = jobWordsIn(all)
  out.push(
    job.length
      ? {
          rule: 'not_job_pitch',
          ok: false,
          why: `Says "${job[0]}"; they know you're looking, so talk about their product instead`,
        }
      : { rule: 'not_job_pitch', ok: true },
  )

  if (THANKED.includes(kind))
    out.push(
      endsWithThanks(body)
        ? { rule: 'thanks', ok: true }
        : {
            rule: 'thanks',
            ok: false,
            why: 'Doesn\'t end with thanks; close with "Thanks for reading" before your name',
          },
    )

  // the film shows the proof; a number of it here is the job pitch the film already makes
  const said = numbersIn(
    (ctx.link ? all.replaceAll(ctx.link, ' ') : all)
      .replace(URL, ' ')
      .replace(PLACEHOLDER, ' ')
      .replace(FILM_LENGTH_RE, ' ')
      .replace(/\b\d+[\s-]*min(ute)?s?\b/gi, ' '),
  )
  const shown = (ctx.proof ?? []).filter((v) =>
    numbersIn(v).some((n) => said.some((s) => sameNumber(s, n))),
  )
  out.push(
    shown.length
      ? {
          rule: 'no_proof_numbers',
          ok: false,
          why: `Says "${shown[0]}", which the film already shows; leave the numbers to the film`,
        }
      : { rule: 'no_proof_numbers', ok: true },
  )

  if (CURIOUS.includes(kind)) {
    const asked = questionsOf(body).filter((q) => !TIME_ASK.test(q))
    // word for word, though a question after a colon may start lower-case ("I wondered: are…")
    const saved = ctx.question?.replace(/\s+/g, ' ').trim().toLowerCase()
    const verbatim = !!saved && body.replace(/\s+/g, ' ').toLowerCase().includes(saved)
    const about = asked.some((q) => sharesWord(q, `${ctx.company}\n${ctx.theirs ?? ''}`))
    out.push(
      verbatim || about
        ? { rule: 'curious', ok: true }
        : {
            rule: 'curious',
            ok: false,
            why: asked.length
              ? "The question isn't about their work; ask about something in their post, site or product"
              : 'Has no question about their work; ask one thing you wondered about their product or post',
          },
    )

    // an experience with their product is the sender's to claim, in their own saved words
    const claims = sentencesOf(body).filter((x) => CLAIM.test(x))
    const names = (ctx.own?.names ?? []).filter(Boolean).map((n) => straight(n).toLowerCase())
    const sources = (ctx.own?.claims ?? []).filter(Boolean)
    const ungrounded = claims.filter(
      (x) =>
        !names.some((n) => straight(x).toLowerCase().includes(n)) &&
        !sources.some((src) => overlap(x, src) >= HOMEWORK_OVERLAP),
    )
    out.push(
      ungrounded.length
        ? {
            rule: 'homework_grounded',
            ok: false,
            why: `Claims "${ungrounded[0]!.slice(0, 60)}", which your homework doesn't say; keep to what you saved`,
          }
        : { rule: 'homework_grounded', ok: true },
    )
  }
  return out
}

/**
 * How close a first-person claim must stay to the sender's saved homework: at least half its
 * words are theirs. Looser than the research line's bar, since "I tried it" wraps their words.
 */
export const HOMEWORK_OVERLAP = 0.5

export const passed = (checks: Check[]) => checks.every((c) => c.ok)

/** The length of the email's ask, part of its structure rather than a claim */
export const ASK_LENGTH = '15 minutes, a 15-minute call'

/**
 * Everything a message may take a number from, joined into one text for CheckContext.known:
 * what the film shows from their site (the quoted line and the film's own lines, which passed
 * the script's grounding), the job, related work, the sender's profile (offer, points, proof and
 * the ask, so "Worth a 15-minute look?" counts as theirs) and what they published lately.
 */
export function knownFor(
  out: Partial<Pick<FilmResult, 'company' | 'job' | 'highlights' | 'script' | 'related'>>,
  profile: Profile,
  homework?: Homework | null,
): string {
  const s = out.script
  const film = s
    ? [s.hook, s.noticed, s.insight.why, s.pitch.headline, ...s.pitch.points, s.cta]
    : []
  const proof = (out.highlights?.proof ?? []).map((p) => `${p.value} ${p.label} ${p.where ?? ''}`)
  // what each post is called and what it says (the first line of its description)
  const posts = (homework?.items ?? []).flatMap((i) => [i.title, i.summary ?? ''])
  return [
    out.company ?? '',
    out.job?.title ?? '',
    out.highlights?.quote.text ?? '',
    ...proof,
    ...film,
    out.related ? `${out.related.name} ${out.related.line}` : '',
    profile.offer,
    ...profile.points,
    ...profile.proof.map((p) => `${p.value} ${p.label} ${p.where ?? ''}`),
    profile.sender.company ?? '',
    profile.sender.role ?? '',
    profile.cta.line,
    // the email's ask is always for 15 minutes (its fifth part), so that number is ours to say,
    // whether the model or a template wrote the ask
    ASK_LENGTH,
    // and how long every film is, from the constant the film lines are written with
    FILM_KNOWN,
    ...posts,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * The voice fields of a job seeker's CheckContext: what they wrote (their site's quote, the
 * film's noticed line, their posts, and the sender's notes on their product), the sender's
 * saved question, the proof values the film shows, and what a first-person claim may rest on.
 */
export function voiceFor(
  out: Partial<Pick<FilmResult, 'company' | 'highlights' | 'script' | 'related'>>,
  profile: Profile,
  homework?: Homework | null,
  sender?: SenderHomework | null,
): Required<Pick<CheckContext, 'candidate' | 'theirs' | 'question' | 'proof' | 'own'>> {
  const posts = (homework?.items ?? []).flatMap((i) => [i.title, i.summary ?? ''])
  return {
    candidate: true,
    theirs: [
      out.company ?? '',
      out.highlights?.quote.text ?? '',
      out.script?.noticed ?? '',
      ...posts,
      sender?.detail ?? '',
      sender?.built?.line ?? '',
    ]
      .filter(Boolean)
      .join('\n'),
    question: sender?.question ?? null,
    proof: (out.highlights?.proof ?? []).map((p) => p.value),
    own: {
      // their words as saved, and as the templates say them ("I've been using Acme, and …")
      claims: [
        sender?.detail ?? '',
        sender?.built?.line ?? '',
        sender?.detail && out.company ? detailLine(out.company, sender.detail) : '',
        sender?.built && out.company ? builtLine(out.company, sender.built) : '',
      ].filter(Boolean),
      names: [
        profile.creator?.name ?? '',
        out.related?.name ?? '',
        sender?.built?.url ?? '',
      ].filter(Boolean),
    },
  }
}
