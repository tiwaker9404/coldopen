import type { FilmResult } from '../film.ts'
import type { Profile } from '../script/types.ts'

/**
 * The messages that carry a film: an email, a LinkedIn note (300 characters, LinkedIn's limit
 * for a connection request) and a follow-up. Written from what the film already says, so they
 * can't claim anything the film doesn't, and with a [First name] placeholder for the person
 * they go to.
 */
export interface Messages {
  email: { subject: string; body: string }
  linkedin: string
  followUp: string
  /** the second and last follow-up: short, and easy to answer either way */
  lastNote: string
  /** a follow-up short enough for a LinkedIn message */
  linkedinFollowUp: string
  /** to someone you already know there: would they pass the film on */
  intro: string
  /**
   * the note that person forwards: about you in the third person, ready to paste into their
   * referral form or team chat, so passing you on takes them one paste
   */
  forward?: string
  /** how the email measures up to what makes cold email work */
  checks: EmailChecks
  /** which opener these drafts lead with: half your films get each, so you learn which wins */
  opener: Opener
  /** the email opens on their recent funding round (an SEC Form D in the last month) */
  whyNow: boolean
}

/**
 * Two ways to open: with the film ("I made a 30-second film for…") or with your best number
 * ("40% faster onboarding at Rail Inc."). Each film gets one, by its id, so about half of what
 * you send leads each way and the replies show which works for you.
 */
export type Opener = 'film' | 'proof'

export function openerFor(id: string): Opener {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 2 === 0 ? 'film' : 'proof'
}

/** A round counts as news to congratulate for a month after its Form D */
const FRESH_ROUND_DAYS = 30

export function freshRound(raised: { date: string } | null | undefined, now = Date.now()): boolean {
  if (!raised) return false
  const at = Date.parse(raised.date)
  return Number.isFinite(at) && now - at >= 0 && now - at < FRESH_ROUND_DAYS * 86_400_000
}

export interface EmailChecks {
  words: number
  /** under 125 words */
  short: boolean
  /** the subject names their company, not "internship inquiry" */
  aboutThem: boolean
  /** your own detail from using their product is in it */
  detail: boolean
  /** one question to answer, not several */
  oneAsk: boolean
}

const GENERIC_SUBJECT =
  /\b(inquiry|enquiry|application|applying|opportunit|internship|job|resume|cv)\b/i

/** What makes a cold email work, checked: short, about them, one personal detail, one small ask */
export function checkEmail(
  email: { subject: string; body: string },
  company: string,
  detail?: string | null,
): EmailChecks {
  // the signature and the link aren't the message
  const words = email.body
    .split('\n')
    .filter((l) => !/^https?:\/\//.test(l.trim()))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length
  const asks = (email.body.match(/\?/g) ?? []).length
  return {
    words,
    short: words <= 125,
    aboutThem:
      email.subject.toLowerCase().includes(company.toLowerCase()) &&
      !GENERIC_SUBJECT.test(email.subject.replace(company, '')),
    detail: !!detail && email.body.toLowerCase().includes(detail.toLowerCase()),
    oneAsk: asks === 1,
  }
}

const LINKEDIN_LIMIT = 300

const clean = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]$/, '')

export function draftMessages(
  out: Pick<FilmResult, 'company' | 'job' | 'highlights' | 'script'>,
  profile: Profile,
  link: string,
  more: {
    /** the sender's one detail from using their product, in their words */
    detail?: string | null
    /** something from their site the film didn't use, for the follow-up to bring */
    fresh?: string | null
    /** which opener to lead with (see openerFor); the film one when there's no number to lead with */
    opener?: Opener
    /** their latest private round, from SEC Form D filings: a reason to write now */
    raised?: { date: string } | null
  } = {},
): Messages {
  if (profile.preset === 'recruiter') return recruiterMessages(out, profile, link)
  const company = out.company
  const role = out.job?.title
  const me = profile.sender.name
  const first = me.split(' ')[0]!
  const candidate = profile.preset === 'candidate'
  const quote = out.highlights?.quote.text ? clean(out.highlights.quote.text) : ''
  const fromPost = /post$/.test(out.highlights?.quote.source ?? '')
  const proof = (out.highlights?.proof ?? [])
    .slice(0, 2)
    .map((p) => clean(`${p.value} ${p.label}${p.where ? ` at ${p.where}` : ''}`))
  const ask = clean(profile.cta.line).replace(/\?*$/, '?')
  // "for your Operations Analyst role at Parcelpine", or just "for Parcelpine"
  const forWhat = role ? `for your ${role} role at ${company}` : `for ${company}`

  const opener = quote
    ? fromPost
      ? `It answers one line from the post, "${quote}",`
      : `It starts from your own site ("${quote}")`
    : `It's in your brand and starts from your homepage`
  const evidence = proof.length
    ? ` with what I've done: ${proof.join('; ')}.`
    : candidate
      ? ', and everything about me in it comes from my résumé.'
      : '.'
  // the film's headline, unless it only restates the role ("Why I fit your … role")
  const headline = out.script?.pitch.headline ? clean(out.script.pitch.headline) : ''
  const pitch =
    headline && !/^why i fit\b|\brole$/i.test(headline) ? `${headline.replace(/[!?]$/, '')}.` : ''

  const detail = more.detail ? clean(more.detail) : ''
  // lead with the best number only when there is one
  const lead: Opener = more.opener === 'proof' && proof.length ? 'proof' : 'film'
  const whyNow = freshRound(more.raised)
  const best = proof[0] ? `${proof[0][0]!.toUpperCase()}${proof[0].slice(1)}` : ''
  const rest = proof.slice(1)
  const evidenceAfterLead = rest.length
    ? ` with more of what I've done: ${rest.join('; ')}.`
    : candidate
      ? ', and everything about me in it comes from my résumé.'
      : '.'
  const email = {
    subject:
      lead === 'proof'
        ? `${company}: ${proof[0]}`
        : role
          ? `A 30-second film for ${company}'s ${role} team`
          : `A 30-second film for ${company}`,
    body: [
      'Hi [First name],',
      '',
      ...(whyNow ? [`Congratulations on the new funding round.`, ''] : []),
      ...(detail ? [`I've been using ${company}, and ${lower(detail)}.`, ''] : []),
      ...(lead === 'proof'
        ? [`${best}. I made a 30-second film ${forWhat} on what I'd bring:`]
        : [`${detail ? 'So I' : 'I'} made a 30-second film ${forWhat}:`]),
      link,
      '',
      `${opener}${lead === 'proof' ? evidenceAfterLead : evidence}`,
      ...(pitch ? ['', pitch] : []),
      '',
      ask,
      '',
      me,
      profile.cta.contact,
    ].join('\n'),
  }

  const long = `Hi [First name], I made a 30-second film ${forWhat}: ${link} ${ask} – ${first}`
  const short = `Hi [First name], I made a short film for ${company}: ${link} ${ask} – ${first}`
  const led = `Hi [First name], ${proof[0] ?? ''}. I made a 30-second film ${forWhat}: ${link} ${ask} – ${first}`
  const linkedin =
    lead === 'proof' && led.length <= LINKEDIN_LIMIT
      ? led
      : long.length <= LINKEDIN_LIMIT
        ? long
        : short.slice(0, LINKEDIN_LIMIT)

  const fresh = more.fresh ? clean(more.fresh) : ''
  const followUp = [
    'Hi [First name],',
    '',
    fresh
      ? `One more thing since I wrote: your site says "${fresh}", and it's exactly the kind of work I'd want to help with. The film I made ${forWhat} is here: ${link}`
      : `Bumping this in case it got buried: the film I made ${forWhat} is here, ${link}`,
    '',
    fresh ? ask : `Happy to walk you through how it was made. ${ask}`,
    '',
    first,
  ].join('\n')

  const lastNote = [
    'Hi [First name],',
    '',
    `One last note on the film I made ${forWhat}: ${link}`,
    '',
    candidate
      ? `If the timing isn't right, no problem at all. If someone else on the team is the better person to talk to about the role, I'd be grateful for a pointer.`
      : `If the timing isn't right, no problem at all. If someone else on the team is the better person to talk to, I'd be grateful for a pointer.`,
    '',
    first,
  ].join('\n')

  const fu = `Hi [First name], following up on the film I made for ${company}: ${link} ${ask} – ${first}`
  const linkedinFollowUp =
    fu.length <= LINKEDIN_LIMIT
      ? fu
      : `Hi [First name], following up on my film: ${link} – ${first}`

  const intro = [
    'Hi [First name],',
    '',
    role
      ? `Hope you're doing well! I'm applying for the ${role} role at ${company}, and I made a 30-second film for the team: ${link}`
      : `Hope you're doing well! I'd love to work with the team at ${company}, and I made a 30-second film for them: ${link}`,
    '',
    `Would you be open to passing it to the hiring manager, or pointing me to the right person? Here's a short note you can forward as is:`,
    '',
    '[forward]',
    '',
    'Thank you!',
    first,
  ].join('\n')

  // the note they forward: everything it says is on the film or the profile
  const forward = [
    role
      ? `${me} is interested in our ${role} role and made a 30-second film for the team: ${link}`
      : `${me} would love to work with us and made a 30-second film for the team: ${link}`,
    ...(proof.length ? [`Highlights: ${proof.join('; ')}.`] : []),
    `Reach ${first} at ${profile.cta.contact}.`,
  ].join('\n')

  return {
    email,
    linkedin,
    followUp,
    lastNote,
    linkedinFollowUp,
    intro: intro.replace('[forward]', forward),
    forward,
    checks: checkEmail(email, company, detail || null),
    opener: lead,
    whyNow,
  }
}

/** "The one thing I kept hitting" -> "the one thing I kept hitting", keeping "I" and names */
const lower = (s: string) =>
  /^[A-Z][a-z]/.test(s) && !/^I\b/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s

/**
 * The same messages addressed to one person: "[First name]" becomes their first name in all of
 * them except the intro, which goes to someone else (the person you know there).
 */
export function addressed(m: Messages, name: string | undefined): Messages {
  const first = name?.trim().split(/\s+/)[0]
  if (!first) return m
  const fill = (t: string) => t.replaceAll('[First name]', first)
  return {
    ...m,
    email: { subject: m.email.subject, body: fill(m.email.body) },
    checks: m.checks,
    linkedin: fill(m.linkedin),
    followUp: fill(m.followUp),
    lastNote: fill(m.lastNote),
    linkedinFollowUp: fill(m.linkedinFollowUp),
  }
}

/** LinkedIn's limit for InMail is longer, but short ones get more replies (under 400 characters: +22%) */
const INMAIL_LIMIT = 400

/**
 * Messages for a recruiter's film: to the candidate, about the role, in the recruiter's voice.
 * Like the film, every claim about the candidate is their own record.
 */
function recruiterMessages(
  out: Pick<FilmResult, 'company' | 'job' | 'highlights' | 'script'>,
  profile: Profile,
  link: string,
): Messages {
  const company = profile.sender.company ?? out.company
  const role = out.job?.title
  const me = profile.sender.name
  const first = me.split(' ')[0]!
  const what = role ? `our ${role} role` : `a role on our team at ${company}`
  const best = out.highlights?.proof[0]
  const noticed = best
    ? clean(`${best.value} ${best.label}${best.where ? ` at ${best.where}` : ''}`)
    : ''
  const ask = clean(profile.cta.line).replace(/\?*$/, '?')
  const email = {
    subject: role
      ? `${company}'s ${role} role, made for you`
      : `A role at ${company}, made for you`,
    body: [
      'Hi [First name],',
      '',
      `I'm ${first}, ${profile.sender.role ? `a ${profile.sender.role.toLowerCase()}` : 'hiring'} at ${company}. Instead of a long message about ${what}, I made you a 30-second film:`,
      link,
      '',
      noticed
        ? `It starts from your own work. ${noticed[0]!.toUpperCase()}${noticed.slice(1)} is what caught our eye.`
        : 'It starts from your own work.',
      '',
      ask,
      '',
      me,
      profile.cta.contact,
    ].join('\n'),
  }
  const at = best?.where ? ` at ${clean(best.where)}` : ''
  const full = `Hi [First name], I made you a 30-second film about ${what}. It starts from your own work${at}: ${link} ${ask} – ${first}`
  const plain = `Hi [First name], I made you a 30-second film about ${what}: ${link} ${ask} – ${first}`
  const linkedin = full.length <= INMAIL_LIMIT ? full : plain.slice(0, INMAIL_LIMIT)
  const followUp = [
    'Hi [First name],',
    '',
    `Bumping this in case it got buried: the film I made you about ${what} is here, ${link}`,
    '',
    ask,
    '',
    first,
  ].join('\n')
  const lastNote = [
    'Hi [First name],',
    '',
    `Last note from me on ${what}: ${link}`,
    '',
    `If the timing isn't right, no problem at all. If you know someone it would suit, I'd be grateful for a pointer.`,
    '',
    first,
  ].join('\n')
  const linkedinFollowUp = `Hi [First name], following up on the film I made you: ${link} ${ask} – ${first}`
  const intro = [
    'Hi [First name],',
    '',
    `We're hiring for ${what}, and I made a 30-second film for a candidate you may know: ${link}`,
    '',
    'Would you be open to introducing us?',
    '',
    'Thank you!',
    first,
  ].join('\n')
  // the recruiter already knows who it's for: the candidate's first name goes in everywhere
  // except the intro, which goes to someone who knows them
  const them = profile.recipient?.name.trim().split(/\s+/)[0]
  const to = (t: string) => (them ? t.replaceAll('[First name]', them) : t)
  return {
    email: { subject: email.subject, body: to(email.body) },
    linkedin: to(linkedin),
    followUp: to(followUp),
    lastNote: to(lastNote),
    linkedinFollowUp: to(linkedinFollowUp),
    intro,
    checks: checkEmail(email, company, null),
    opener: 'film',
    whyNow: false,
  }
}
