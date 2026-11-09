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

const URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi
const PLACEHOLDER = /\[[^\]]*\]/g
// the film's length is coldopen's own fact, true of every film, so it needs no source
const FILM_LENGTH = /\b30-second\b/gi

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
  const known = numbersIn(ctx.known)
  const claims = (ctx.link ? all.replaceAll(ctx.link, ' ') : all)
    .replace(URL, ' ')
    .replace(PLACEHOLDER, ' ')
    .replace(FILM_LENGTH, ' ')
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
  if (kind === 'note')
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
    const n = all.split(ctx.link).length - 1
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
  return checks
}

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
    ...posts,
  ]
    .filter(Boolean)
    .join('\n')
}
