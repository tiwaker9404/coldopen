import type { FilmResult } from '../film.ts'
import { BANNED } from '../script/taste.ts'
import type { Profile } from '../script/types.ts'
import { type Check, emailWords, MESSAGE_LIMITS, type MessageKind } from './checks.ts'

/**
 * The messages that carry a film, in the order you send them: a LinkedIn connection note
 * (200 characters, a free account's limit, with no link and no ask), the message once they
 * accept (the film and one ask), an InMail, the warm email in five parts, and the follow-ups.
 * Written from what the film already says, so they can't claim anything the film doesn't, and
 * with a [First name] placeholder for the person they go to. Every one passes checkMessage
 * (checks.ts), because these templates are the fallback when a model's draft doesn't.
 */
export interface Messages {
  email: { subject: string; body: string }
  /** the connection note (the key is kept for older clients): no link, no question */
  linkedin: string
  /** the first message once they accept: thanks, the film, one ask */
  afterAccept?: string
  /** InMail, which is free only to an Open Profile or someone in a group with you */
  inmail?: { subject: string; body: string }
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
  /** a hiring film: the LinkedIn post that carries it, ready to paste */
  post?: string
  /** how the email measures up to what makes cold email work */
  checks: EmailChecks
  /** which opener these drafts lead with: half your films get each, so you learn which wins (job seekers and sellers) */
  opener?: Opener
  /** the email opens on their recent funding round (an SEC Form D in the last month) */
  whyNow: boolean
  /** who wrote each draft: the model, or these templates (all templates until the model writes them) */
  writer: Partial<Record<DraftName, 'model' | 'template'>>
  /** the checks a draft failed, by draft, and why it fell back to the template */
  flags: Record<string, Check[]>
}

/** A draft, named by the kind of message it is (the connection note is the `linkedin` field). */
export type DraftName = MessageKind

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
  // the link isn't the message
  const words = emailWords(email.body)
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

const clean = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]$/, '')

/**
 * Words from their site or the film can only go into a message the checks would pass: a quoted
 * line with a question or an exclamation mark would add an ask or shout, and a banned word would
 * read as ours. Such a line is left out (and the plainer sentence used) rather than edited.
 */
const quotable = (s: string) => {
  const t = s.toLowerCase().replace(/[‘’]/g, "'")
  return !!s && !/[?!]/.test(s) && !BANNED.some((b) => t.includes(b.replace(/[‘’]/g, "'")))
}

/** The first draft that fits, in order: the drafts run from fullest to plainest. */
const firstFit = <T>(drafts: T[], fits: (d: T) => boolean): T =>
  drafts.find(fits) ?? drafts[drafts.length - 1]!

/** The headline the film's noticed line quotes ("Northwind leads with “Every pallet…”") */
const promiseIn = (noticed: string | undefined) => noticed?.match(/\u201c([^\u201d]+)\u201d/)?.[1]

export function draftMessages(
  out: Pick<FilmResult, 'company' | 'job' | 'highlights' | 'script' | 'related'>,
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
    /**
     * one thing they published lately (homework), for the email's research line: the line
     * itself, the text it came from, and the post's title
     */
    research?: { line: string; source: string; title?: string } | null
  } = {},
): Messages {
  if (profile.preset === 'recruiter') return recruiterMessages(out, profile, link)
  if (profile.preset === 'hiring') return hiringMessages(out, profile, link)
  const company = out.company
  const role = out.job?.title
  const me = profile.sender.name
  const first = me.split(' ')[0]!
  const candidate = profile.preset === 'candidate'
  const rawQuote = out.highlights?.quote.text ? clean(out.highlights.quote.text) : ''
  const quote = quotable(rawQuote) ? rawQuote : ''
  const fromPost = /post$/.test(out.highlights?.quote.source ?? '')
  const proof = (out.highlights?.proof ?? [])
    .slice(0, 2)
    .map((p) => clean(`${p.value} ${p.label}${p.where ? ` at ${p.where}` : ''}`))
    .filter(quotable)
  const ask = clean(profile.cta.line).replace(/\?*$/, '?')
  // "for your Operations Analyst role at Parcelpine", or just "for Parcelpine"
  const forWhat = role ? `for your ${role} role at ${company}` : `for ${company}`

  // the film's headline, unless it only restates the role or the opening ("Why I fit your … role")
  const headline = out.script?.pitch.headline ? clean(out.script.pitch.headline) : ''
  const pitch =
    headline && !/^(why i fit|what i would bring)\b|\brole$/i.test(headline) && quotable(headline)
      ? `${headline.replace(/[!?]$/, '')}.`
      : ''

  const detail = more.detail ? clean(more.detail) : ''
  // lead with the best number only when there is one
  const lead: Opener = more.opener === 'proof' && proof.length ? 'proof' : 'film'
  const whyNow = freshRound(more.raised)
  const best = proof[0] ? `${proof[0][0]!.toUpperCase()}${proof[0].slice(1)}` : ''
  const rest = lead === 'proof' ? proof.slice(1) : proof

  /* ------------------------------------------------------------ the warm email */

  // (1) the opening: the role they posted, or the promise their homepage leads with
  const promise = promiseIn(out.script?.noticed)
  const siteQuote = !fromPost && quote ? quote : ''
  const opening = role
    ? `I saw the ${role} role at ${company}.`
    : promise && quotable(promise)
      ? `I saw that ${company} leads with "${clean(promise)}".`
      : siteQuote
        ? `I saw that ${company}'s site says "${siteQuote}".`
        : `I've been following what ${company} is building.`
  // the film's own first line: its quote, unless the opening already said it
  const filmLine = (withQuote: boolean) =>
    quote && withQuote && !opening.includes(quote)
      ? fromPost
        ? `It answers one line from the post: "${quote}".`
        : `It starts from your own site: "${quote}".`
      : `It's in your brand and starts from your homepage.`
  // (3) one line on something they published lately, only when there is one
  const research = more.research?.line ? clean(more.research.line) : ''
  const read = research
    ? `I read ${more.research?.title ? `"${clean(more.research.title)}"` : 'your recent post'}, and ${lower(research)}.`
    : ''
  // (4) why I fit: the proof the film shows
  const whyIFit = (all: boolean) => {
    const shown = all ? rest : rest.slice(0, 1)
    if (shown.length)
      return `${lead === 'proof' ? "More of what I've done" : "What I'd bring"}: ${shown.join('; ')}.`
    if (lead === 'proof') return ''
    return candidate ? 'Everything about me in it comes from my résumé.' : ''
  }
  const emailBody = (o: { quote: boolean; pitch: boolean; related: boolean; all: boolean }) =>
    [
      'Hi [First name],',
      '',
      ...(whyNow ? ['Congratulations on the new funding round.', ''] : []),
      // part 1, with the best number when this film leads with it
      lead === 'proof' ? `${opening} ${best}.` : opening,
      // a detail in their own voice ("I read your post…") stands as it is
      ...(detail
        ? [
            /^I\b/.test(detail)
              ? `${detail.replace(/[.!]$/, '')}.`
              : `I've been using ${company}, and ${lower(detail)}.`,
          ]
        : []),
      '',
      // part 2: the film
      lead === 'proof'
        ? `I made a 30-second film ${forWhat} on what I'd bring:`
        : `${detail ? 'So I' : 'I'} made a 30-second film ${forWhat}:`,
      link,
      filmLine(o.quote),
      // part 3: what they published
      ...(read ? ['', read] : []),
      // part 4: why I fit
      ...(() => {
        const lines = [whyIFit(o.all), o.pitch ? pitch : ''].filter(Boolean)
        return lines.length ? ['', lines.join(' ')] : []
      })(),
      // real work they can open in one click, when one of the sender's projects is close
      ...(o.related && out.related
        ? [
            '',
            `Something I built that's close to what you do: ${out.related.name}, ${out.related.url}`,
          ]
        : []),
      '',
      // part 5: one small ask
      ask,
      '',
      me,
      profile.cta.contact,
    ].join('\n')
  // shorten step by step: the headline, then related work, then the quote, then a proof item
  const bodies = [
    { quote: true, pitch: true, related: true, all: true },
    { quote: true, pitch: false, related: true, all: true },
    { quote: true, pitch: false, related: false, all: true },
    { quote: false, pitch: false, related: false, all: true },
    { quote: false, pitch: false, related: false, all: false },
  ].map(emailBody)
  const email = {
    subject:
      lead === 'proof'
        ? `${company}: ${proof[0]}`
        : role
          ? `A 30-second film for ${company}'s ${role} team`
          : `A 30-second film for ${company}`,
    body: firstFit(bodies, (b) => emailWords(b) <= MESSAGE_LIMITS.emailWords),
  }

  /* ------------------------------------------------------------ LinkedIn */

  // the connection note: who you are to them, and that you made something. No link and no
  // question: the film goes in the message once they accept. Shortened step by step, never cut.
  const hello = 'Hi [First name],'
  const sign = `Would like to connect. – ${first}`
  const about = (withRole: boolean) =>
    candidate
      ? withRole && role
        ? `I'm applying for the ${role} role at ${company} and made something for the team.`
        : `I'd like to work with the ${company} team and made something for you.`
      : withRole && role
        ? `I made something for the ${company} team about the ${role} role.`
        : `I made something for the ${company} team.`
  const notes = [
    ...(lead === 'proof' ? [true, false].map((r) => `${hello} ${best}. ${about(r)} ${sign}`) : []),
    `${hello} ${about(true)} ${sign}`,
    `${hello} ${about(false)} ${sign}`,
    `${hello} I made something for the ${company} team. – ${first}`,
    `${hello} I made something for ${company}.`,
  ]
  const linkedin = firstFit(notes, (n) => n.length <= MESSAGE_LIMITS.note)

  // once they accept: thanks, the film, what it shows, one ask
  const accepts = [true, false].map((withProof) =>
    [
      `${hello} thanks for connecting.`,
      '',
      lead === 'proof'
        ? `${best}. I made a 30-second film ${forWhat} on what I'd bring: ${link}`
        : `I made a 30-second film ${forWhat}: ${link}`,
      ...(withProof && rest.length ? ['', `${whyIFit(true)}`] : []),
      '',
      ask,
      '',
      first,
    ].join('\n'),
  )
  const afterAccept = firstFit(accepts, (a) => a.length <= MESSAGE_LIMITS.afterAccept)

  // InMail: the email's job in LinkedIn's shorter room
  const inmailSubjects = [
    ...(lead === 'proof' ? [`${company}: ${proof[0]}`] : []),
    ...(role ? [`A 30-second film for ${company}'s ${role} team`] : []),
    `A 30-second film for ${company}`,
    `A film for ${company}`,
    company,
  ]
  const inmailBodies = [true, false].map((withProof) =>
    [
      hello,
      '',
      lead === 'proof' ? `${opening} ${best}.` : opening,
      '',
      `I made a 30-second film ${forWhat}: ${link}`,
      ...(withProof && rest.length ? ['', whyIFit(false)] : []),
      '',
      ask,
      '',
      first,
    ].join('\n'),
  )
  const inmail = {
    subject: firstFit(inmailSubjects, (t) => t.length <= MESSAGE_LIMITS.inmailSubject),
    body: firstFit(inmailBodies, (b) => b.length <= MESSAGE_LIMITS.inmailBody),
  }

  /* ------------------------------------------------------------ follow-ups */

  const fresh = more.fresh && quotable(clean(more.fresh)) ? clean(more.fresh) : ''
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

  // easy to answer either way, and asking nothing more of them
  const lastNote = [
    'Hi [First name],',
    '',
    `One last note on the film I made ${forWhat}: ${link}`,
    '',
    `If the timing isn't right, no problem at all. Thanks for taking a look.`,
    '',
    first,
  ].join('\n')

  const fu = `Hi [First name], following up on the film I made for ${company}: ${link} ${ask} – ${first}`
  const linkedinFollowUp =
    fu.length <= MESSAGE_LIMITS.afterAccept
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
    afterAccept,
    inmail,
    followUp,
    lastNote,
    linkedinFollowUp,
    intro: intro.replace('[forward]', forward),
    forward,
    checks: checkEmail(email, company, detail || null),
    opener: lead,
    whyNow,
    writer: allTemplate(true),
    flags: {},
  }
}

/** Every draft written by these templates (step 5's model replaces some of them) */
const allTemplate = (inmail: boolean): Messages['writer'] => ({
  note: 'template',
  afterAccept: 'template',
  ...(inmail ? { inmail: 'template' as const } : {}),
  email: 'template',
  followUp: 'template',
  lastNote: 'template',
  linkedinFollowUp: 'template',
})

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
    ...(m.afterAccept ? { afterAccept: fill(m.afterAccept) } : {}),
    ...(m.inmail ? { inmail: { subject: m.inmail.subject, body: fill(m.inmail.body) } } : {}),
    followUp: fill(m.followUp),
    lastNote: fill(m.lastNote),
    linkedinFollowUp: fill(m.linkedinFollowUp),
  }
}

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
  // InMail (or the message once they accept): short ones get more replies (under 400: +22%)
  const full = `Hi [First name], I made you a 30-second film about ${what}. It starts from your own work${at}: ${link} ${ask} – ${first}`
  const plain = `Hi [First name], I made you a 30-second film about ${what}: ${link} ${ask} – ${first}`
  const message = firstFit([full, plain], (t) => t.length <= MESSAGE_LIMITS.inmailBody)
  const inmail = {
    subject: firstFit(
      [
        ...(role ? [`${company}'s ${role} role, made for you`] : []),
        `A role at ${company}, made for you`,
        `A role at ${company}`,
      ],
      (t) => t.length <= MESSAGE_LIMITS.inmailSubject,
    ),
    body: message,
  }
  // the connection note: no link and no question, so it reads as a person, not a pitch
  const who = profile.sender.role
    ? `${profile.sender.role.toLowerCase()} at ${company}`
    : `hiring at ${company}`
  const linkedin = firstFit(
    [
      `Hi [First name], I'm ${first}, ${who}. I made you a 30-second film about ${what}. Would like to connect. – ${first}`,
      `Hi [First name], I'm ${first}, hiring at ${company}. I made you a short film about a role. Would like to connect.`,
      `Hi [First name], I'm ${first} at ${company}. Would like to connect.`,
    ],
    (t) => t.length <= MESSAGE_LIMITS.note,
  )
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
    afterAccept: to(message),
    inmail: { subject: inmail.subject, body: to(inmail.body) },
    followUp: to(followUp),
    lastNote: to(lastNote),
    linkedinFollowUp: to(linkedinFollowUp),
    intro,
    checks: checkEmail(email, company, null),
    whyNow: false,
    writer: allTemplate(true),
    flags: {},
  }
}

/**
 * Messages for a hiring film: the LinkedIn post itself, a short note to someone you'd like to
 * apply, and an email asking your network who they'd recommend. The role's lines are the post's
 * own words, and the numbers are the company's.
 */
function hiringMessages(
  out: Pick<FilmResult, 'company' | 'job' | 'highlights' | 'script'>,
  profile: Profile,
  link: string,
): Messages {
  const company = profile.sender.company ?? out.company
  const role = out.job?.title ?? 'an open role'
  const me = profile.sender.name
  const first = me.split(' ')[0]!
  const lines = (out.script?.pitch.points ?? profile.points).slice(0, 3).map(clean)
  const stat = out.highlights?.quote.text ? clean(out.highlights.quote.text) : ''
  const apply = profile.cta.book ?? link
  const post = [
    `We're hiring: ${role} at ${company}.`,
    '',
    ...(lines.length ? ['What you would do:', ...lines.map((l) => `→ ${l}`), ''] : []),
    ...(stat && /\d/.test(stat) ? [`${stat[0]!.toUpperCase()}${stat.slice(1)}.`, ''] : []),
    `Watch the 30-second film: ${link}`,
    `Apply: ${apply}`,
    '',
    'Know someone who would be great at this? Tag them or send this their way.',
  ].join('\n')
  const email = {
    subject: `Know someone for our ${role} role?`,
    body: [
      'Hi [First name],',
      '',
      `We're hiring a ${role} at ${company}, and I made a 30-second film about the role: ${link}`,
      '',
      `Who's the best person you know for it? The post is here: ${apply}`,
      '',
      'Thank you!',
      me,
    ].join('\n'),
  }
  // the connection note goes without the link; the film follows once they accept
  const linkedin = firstFit(
    [
      `Hi [First name], we're hiring a ${role} at ${company} and I thought of you. Would like to connect. – ${first}`,
      `Hi [First name], we're hiring at ${company} and I thought of you. Would like to connect. – ${first}`,
      `Hi [First name], we're hiring at ${company}. Would like to connect.`,
    ],
    (t) => t.length <= MESSAGE_LIMITS.note,
  )
  const afterAccept = `Hi [First name], thanks for connecting. We're hiring a ${role} at ${company} and I thought of you. A 30-second film about it: ${link} – ${first}`
  const followUp = [
    'Hi [First name],',
    '',
    `Bumping this: we're still hiring for the ${role} role, and the film is here, ${link}`,
    '',
    first,
  ].join('\n')
  return {
    email,
    linkedin,
    afterAccept,
    followUp,
    lastNote: followUp,
    linkedinFollowUp: `Hi [First name], one more nudge on our ${role} role: ${link} – ${first}`,
    intro: email.body,
    post,
    checks: checkEmail(email, company, null),
    whyNow: false,
    writer: allTemplate(false),
    flags: {},
  }
}
