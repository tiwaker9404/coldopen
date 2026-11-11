import { type Homework, type HomeworkItem, pickResearch } from '../brand/homework.ts'
import type { FilmResult } from '../film.ts'
import { BANNED } from '../script/taste.ts'
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
  voiceFor,
} from './checks.ts'
import {
  detailLine,
  homeworkLine,
  lower,
  lowerStart,
  OFFER,
  researchSentence,
  type SenderHomework,
  SIGN_OFF,
  wholeClause,
} from './voice.ts'

export type { SenderHomework } from './voice.ts'
export { detailLine, researchSentence, wholeClause } from './voice.ts'

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
  /** the checks a draft failed, by draft: only real failures, the reason it fell back to the template */
  flags: Record<string, Check[]>
  /**
   * what code changed in a draft, in plain sentences ("Left out the funding line to stay under
   * 125 words"). A note isn't a failure: a kept model draft can have notes and no flags.
   */
  notes?: Partial<Record<DraftName, string[]>>
  /**
   * a job seeker's film whose stored model drafts no longer pass today's checks, or were written
   * before the homework they saved: the templates stand in, and POST
   * /v1/films/:id/messages/rewrite has the model write them again. Stored drafts are never
   * rewritten without being asked.
   */
  rewrite?: boolean
}

/** A draft, named by the kind of message it is (the connection note is the `linkedin` field). */
export type DraftName = MessageKind

/**
 * Two ways to open, so you learn which gets replies. A job seeker's email leads with their
 * homework (what they used, read or built) or with their question for them; a seller's with
 * the film ("I made a 30-second film for…") or with their best number. Each film gets one, by a
 * hash of its id, so about half of what you send leads each way. A film keeps the opener it was
 * marked sent with (Outreach.opener); one sent before that was kept opened with the film or the
 * number.
 */
export type Opener = 'homework' | 'question' | 'film' | 'proof'

export function openerFor(id: string, preset?: Profile['preset']): Opener {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  if (preset === 'candidate') return h % 2 === 0 ? 'homework' : 'question'
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

export interface DraftOptions {
  /** what the sender saved for this film: their detail, question and small build */
  homework?: SenderHomework | null
  /** a newer post than the one the email reads, for a job seeker's follow-up to bring */
  newer?: { title: string; line: string } | null
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
}

export function draftMessages(
  out: Pick<FilmResult, 'company' | 'job' | 'highlights' | 'script' | 'related'>,
  profile: Profile,
  link: string,
  more: DraftOptions = {},
): Messages {
  if (profile.preset === 'recruiter') return recruiterMessages(out, profile, link)
  if (profile.preset === 'hiring') return hiringMessages(out, profile, link)
  if (profile.preset === 'candidate') return candidateMessages(out, profile, link, more)
  const company = out.company
  const role = out.job?.title
  const me = profile.sender.name
  const first = me.split(' ')[0]!
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

  const detail = more.homework?.detail ? clean(more.homework.detail) : ''
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
  const research = more.research?.line ? wholeClause(clean(more.research.line)) : ''
  const title = more.research?.title ? clean(more.research.title) : ''
  const read = research ? researchSentence(title, research) : ''
  // (4) why I fit: the proof the film shows
  const whyIFit = (all: boolean) => {
    const shown = all ? rest : rest.slice(0, 1)
    if (shown.length)
      return `${lead === 'proof' ? "More of what I've done" : "What I'd bring"}: ${shown.join('; ')}.`
    return ''
  }
  const emailBody = (o: { quote: boolean; pitch: boolean; related: boolean; all: boolean }) =>
    [
      'Hi [First name],',
      '',
      ...(whyNow ? ['Congratulations on the new funding round.', ''] : []),
      // part 1, with the best number when this film leads with it
      lead === 'proof' ? `${opening} ${best}.` : opening,
      // a detail in their own voice ("I read your post…") stands as it is
      ...(detail ? [detailLine(company, detail)] : []),
      '',
      // part 2: the film
      lead === 'proof'
        ? `I made a ${FILM_LENGTH} film ${forWhat} on what I'd bring:`
        : `${detail ? 'So I' : 'I'} made a ${FILM_LENGTH} film ${forWhat}:`,
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
          ? `A ${FILM_LENGTH} film for ${company}'s ${role} team`
          : `A ${FILM_LENGTH} film for ${company}`,
    body: firstFit(bodies, (b) => emailWords(b) <= MESSAGE_LIMITS.emailWords),
  }

  /* ------------------------------------------------------------ LinkedIn */

  // the connection note: who you are to them, and that you made something. No link and no
  // question: the film goes in the message once they accept. Shortened step by step, never cut.
  const hello = 'Hi [First name],'
  const sign = `Would like to connect. – ${first}`
  const about = (withRole: boolean) =>
    withRole && role
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
        ? `${best}. I made a ${FILM_LENGTH} film ${forWhat} on what I'd bring: ${link}`
        : `I made a ${FILM_LENGTH} film ${forWhat}: ${link}`,
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
    ...(role ? [`A ${FILM_LENGTH} film for ${company}'s ${role} team`] : []),
    `A ${FILM_LENGTH} film for ${company}`,
    `A film for ${company}`,
    company,
  ]
  const inmailBodies = [true, false].map((withProof) =>
    [
      hello,
      '',
      lead === 'proof' ? `${opening} ${best}.` : opening,
      '',
      `I made a ${FILM_LENGTH} film ${forWhat}: ${link}`,
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
      ? `Hope you're doing well! I'm applying for the ${role} role at ${company}, and I made a ${FILM_LENGTH} film for the team: ${link}`
      : `Hope you're doing well! I'd love to work with the team at ${company}, and I made a ${FILM_LENGTH} film for them: ${link}`,
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
      ? `${me} is interested in our ${role} role and made a ${FILM_LENGTH} film for the team: ${link}`
      : `${me} would love to work with us and made a ${FILM_LENGTH} film for the team: ${link}`,
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

/* ------------------------------------------------------------ a job seeker's messages */

/**
 * A job seeker's messages, in the voice (voice.ts). The email: their work first (the sender's
 * homework, or what their homepage leads with), the film as a tease about their work, what the
 * sender built, one real question (their saved one when there is one), the 15-minute offer as a
 * statement, and thanks. No job words and no numbers: the film shows the proof. Each draft is
 * the first, from fullest to plainest, that passes every check, so a saved line or a quote that
 * would break a rule is left out (never edited), and the plainest draft always passes.
 */
function candidateMessages(
  out: Pick<FilmResult, 'company' | 'job' | 'highlights' | 'script' | 'related'>,
  profile: Profile,
  link: string,
  more: DraftOptions,
): Messages {
  const company = out.company
  const me = profile.sender.name
  const first = me.split(' ')[0]!
  const hw = more.homework ?? null
  const lead: Opener = more.opener === 'question' ? 'question' : 'homework'
  const fundingNews = freshRound(more.raised)

  // their own words: the homepage's promise, or its quoted line (never a line from a job post)
  const rawQuote = out.highlights?.quote.text ? clean(out.highlights.quote.text) : ''
  const fromPost = /post$/.test(out.highlights?.quote.source ?? '')
  const siteQuote = !fromPost && quotable(rawQuote) ? rawQuote : ''
  const rawPromise = promiseIn(out.script?.noticed)
  const promise = rawPromise && quotable(rawPromise) ? clean(rawPromise) : ''
  // what they published lately: the title only when it can be quoted
  const rawTitle = more.research?.title ? clean(more.research.title) : ''
  const title = quotable(rawTitle) ? rawTitle : ''
  const post = more.research?.line ? { title, line: clean(more.research.line) } : null

  /* the parts, each fullest first */
  const opening = promise
    ? `${company}'s homepage leads with "${promise}".`
    : siteQuote
      ? `${company}'s site says "${siteQuote}".`
      : `I've been reading about what ${company} is building.`
  // the opening, with what it's about: a line about their post names the post once
  const mine = homeworkLine(company, hw, post)
  const theirPost = homeworkLine(company, null, post)
  const leads = [
    ...(mine ? [{ line: mine.line, post: mine.kind === 'post' }] : []),
    ...(theirPost && theirPost.line !== mine?.line ? [{ line: theirPost.line, post: true }] : []),
    { line: opening, post: false },
  ]
  const teasesFor = (l: { post: boolean }) => [
    ...(title && !l.post
      ? [`I put what I'd try next after "${title}" into a ${FILM_LENGTH} film:`]
      : []),
    ...(!title && promise
      ? [`I put what I'd build on "${promise}" into a ${FILM_LENGTH} film:`]
      : []),
    `I put what I'd try next with ${company} into a ${FILM_LENGTH} film:`,
  ]
  const c = profile.creator
  const creators = [
    ...(c
      ? [
          `I built the tool that made it, ${c.name}: ${lowerStart(clean(c.line))}.`,
          `I built the tool that made it, ${c.name}.`,
        ]
      : out.related
        ? [`Something I built that's close to what you do: ${out.related.name}, ${out.related.url}`]
        : []),
    '',
  ]
  const saved = hw?.question ? hw.question.replace(/\s+/g, ' ').trim() : ''
  const asked = saved && !saved.endsWith('?') ? `${saved.replace(/[.!]$/, '')}?` : saved
  const questionsFor = (l: { post: boolean }) =>
    unique([
      asked,
      title && !l.post ? `What have customers said since "${title}" went out?` : '',
      hw?.built || hw?.detail ? `How do most ${company} customers use it?` : '',
      promise ? `What made you lead the homepage with "${promise}"?` : '',
      `What's the hardest part of what ${company} is building right now?`,
    ])
  const subjects = unique([
    title
      ? title.toLowerCase().includes(company.toLowerCase())
        ? title
        : `${company}'s ${lower(title)}`
      : '',
    hw?.built ? `Something I built with ${company}` : '',
    hw?.detail ? `Notes from using ${company}` : '',
    promise ? `${company}'s "${promise}"` : '',
    `A question about ${company}`,
  ])

  /* checked as they'll be checked again: the voice, the film's facts and the sender's homework */
  const ctx: CheckContext = {
    ...contextFor(out, profile, link, hw),
    research: more.research ? { line: more.research.line, source: more.research.source } : null,
  }
  // what they published lately, and the posts a follow-up may bring, are theirs too
  const theirs = [more.research?.title, more.research?.source, more.newer?.title, more.newer?.line]
  ctx.known = [ctx.known, ...theirs, more.fresh].filter(Boolean).join('\n')
  ctx.theirs = [ctx.theirs, ...theirs].filter(Boolean).join('\n')
  // a quote said twice (the opening, then the tease, then the question) reads as a mail merge
  const ok = (kind: MessageKind, t: string | { subject: string; body: string }) =>
    !quotesTwice(typeof t === 'string' ? t : t.body) && passed(checkMessage(kind, t, ctx))

  /* ------------------------------------------------------------ the email */

  const emailBody = (o: { now: boolean; lead: string; tease: string; built: string; q: string }) =>
    [
      'Hi [First name],',
      '',
      ...(o.now ? ['Congratulations on the new funding round.', ''] : []),
      // the question opener asks first, then shows the homework
      ...(lead === 'question'
        ? [`I've had one question about ${company} in mind: ${midSentence(o.q)}`, '']
        : []),
      o.lead,
      '',
      o.tease,
      link,
      ...(o.built ? ['', o.built] : []),
      '',
      lead === 'question' ? OFFER : `One thing I wondered: ${midSentence(o.q)} ${OFFER}`,
      '',
      SIGN_OFF,
      me,
      profile.cta.contact,
    ].join('\n')
  // what goes first, when something must: the tease's detail, then the built line, then the
  // question, then the homework; the funding line before all of them
  let email: { subject: string; body: string } | null = null
  let whyNow = false
  search: for (const now of fundingNews ? [true, false] : [false])
    for (const l of leads)
      for (const q of questionsFor(l))
        for (const built of creators)
          for (const tease of teasesFor(l)) {
            const body = emailBody({ now, lead: l.line, tease, built, q })
            const subject = subjects.find((t) => ok('email', { subject: t, body }))
            if (subject) {
              email = { subject, body }
              whyNow = now
              break search
            }
          }
  email ??= {
    subject: subjects.at(-1)!,
    body: emailBody({
      now: false,
      lead: opening,
      tease: teasesFor({ post: false }).at(-1)!,
      built: '',
      q: questionsFor({ post: false }).at(-1)!,
    }),
  }

  /* ------------------------------------------------------------ LinkedIn */

  // the connection note: their work and one curious line, no link and no ask
  const tail = `Curious how most ${company} customers use it.`
  const noteBuilt = hw?.built
    ? `I built something small with ${company}: ${lowerStart(clean(hw.built.line))}.`
    : ''
  const noteDetail = hw?.detail ? detailLine(company, clean(hw.detail)) : ''
  const linkedin = firstFit(
    unique([
      noteBuilt && `${noteBuilt} ${tail}`,
      noteBuilt,
      noteDetail && `${noteDetail} ${tail}`,
      noteDetail,
      asked && `I've been looking at ${company} and wondered: ${asked}`,
      title && `I read ${company}'s post "${title}". Curious what customers make of it.`,
      promise && `${company}'s homepage leads with "${promise}". Curious how you landed on it.`,
      `I've been reading about what ${company} is building and would like to connect.`,
      `Curious about what ${company} is building.`,
    ]).map((x) => `Hi [First name], ${x} – ${first}`),
    (n) => ok('note', n),
  )

  // once they accept, and InMail: the homework, the tease with the film, the question, thanks
  const dm = (hello: string[], o: { lead: string; tease: string; q: string }) =>
    [
      ...hello,
      o.lead,
      '',
      `${o.tease} ${link}`,
      '',
      o.q,
      '',
      'Thank you for your time,',
      first,
    ].join('\n')
  const dms = (hello: string[]) =>
    leads.flatMap((l) =>
      questionsFor(l).flatMap((q) =>
        teasesFor(l).map((tease) => dm(hello, { lead: l.line, tease, q })),
      ),
    )
  const afterAccept = firstFit(dms(['Hi [First name], thanks for connecting.', '']), (a) =>
    ok('afterAccept', a),
  )
  const inmailBodies = dms(['Hi [First name],', ''])
  const inmailSubjects = [...subjects, company]
  let inmail: { subject: string; body: string } | null = null
  for (const body of inmailBodies) {
    const subject = inmailSubjects.find((t) => ok('inmail', { subject: t, body }))
    if (subject) {
      inmail = { subject, body }
      break
    }
  }
  inmail ??= { subject: company, body: inmailBodies.at(-1)! }

  /* ------------------------------------------------------------ the one follow-up */

  // a week on, one note that brings something new, then let it go
  const fresh = more.fresh && quotable(clean(more.fresh)) ? clean(more.fresh) : ''
  const newer = more.newer?.title ? clean(more.newer.title) : ''
  const news = unique([
    fresh && `One more thing I noticed since I wrote: ${company}'s site says "${fresh}".`,
    newer && quotable(newer) ? `I just read your newer post, "${newer}".` : '',
    // the email led with the build, so the detail is new here
    hw?.built && hw.detail
      ? `Since I wrote, I've kept using ${company}, and ${lowerStart(clean(hw.detail))}.`
      : '',
  ])
  const followUp = firstFit(
    [...news, ''].map((n) =>
      [
        'Hi [First name],',
        '',
        ...(n
          ? [n, '', `The film is here if it helps: ${link}`]
          : [`Writing once more in case this got buried. The film is here: ${link}`]),
        '',
        'Thanks either way,',
        first,
      ].join('\n'),
    ),
    (f) => ok('followUp', f),
  )
  const lastNote = [
    'Hi [First name],',
    '',
    `One last note on the film I made for ${company}: ${link}`,
    '',
    `If the timing isn't right, no problem at all. Thanks for taking a look.`,
    '',
    first,
  ].join('\n')
  const linkedinFollowUp = firstFit(
    [
      ...news.map((n) => `Hi [First name], ${n} The film is here if it helps: ${link} – ${first}`),
      `Hi [First name], writing once more about the film I made for ${company}: ${link} – ${first}`,
    ],
    (t) => ok('linkedinFollowUp', t),
  )

  // to someone you know there: would they pass the film on (no job words: it's about their work)
  const forward = [
    `${me} has been digging into what we're building and made a ${FILM_LENGTH} film for the team: ${link}`,
    `Reach ${first} at ${profile.cta.contact}.`,
  ].join('\n')
  const intro = [
    'Hi [First name],',
    '',
    `Hope you're doing well. I've been curious about what ${company} is building, and I put what I'd try next with it into a ${FILM_LENGTH} film: ${link}`,
    '',
    `Would you be open to passing it to whoever leads that work, or pointing me to the right person? Here's a short note you can forward as is:`,
    '',
    forward,
    '',
    'Thank you,',
    first,
  ].join('\n')

  const saidHomework = hw?.built ? clean(hw.built.line) : hw?.detail ? clean(hw.detail) : null
  return {
    email,
    linkedin,
    afterAccept,
    inmail,
    followUp,
    lastNote,
    linkedinFollowUp,
    intro,
    forward,
    checks: checkEmail(email, company, saidHomework),
    opener: lead,
    whyNow,
    writer: allTemplate(true),
    flags: {},
  }
}

/** A question after a colon ("One thing I wondered: are most…"), its words otherwise its own */
export const midSentence = (q: string) =>
  /^(Are|Is|Do|Does|Did|How|What|What's|Why|When|Where|Which|Who|Would|Could|Can|Have|Has)\b/.test(
    q,
  )
    ? q[0]!.toLowerCase() + q.slice(1)
    : q

/** Whether a draft quotes the same words twice */
const quotesTwice = (body: string) => {
  const quoted = (body.match(/"[^"\n]+"/g) ?? []).map((q) => q.toLowerCase())
  return new Set(quoted).size < quoted.length
}

/** Each option once, in order, without the empty ones */
const unique = (xs: (string | null | undefined | false)[]): string[] => [
  ...new Set(xs.filter((x): x is string => !!x)),
]

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
      `I'm ${first}, ${profile.sender.role ? `a ${profile.sender.role.toLowerCase()}` : 'hiring'} at ${company}. Instead of a long message about ${what}, I made you a ${FILM_LENGTH} film:`,
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
  // this message goes on its own (after they accept, or as an InMail), so it names the company
  const whatAt = role ? `our ${role} role at ${company}` : what
  const full = `Hi [First name], I made you a ${FILM_LENGTH} film about ${whatAt}. It starts from your own work${at}: ${link} ${ask} – ${first}`
  const plain = `Hi [First name], I made you a ${FILM_LENGTH} film about ${whatAt}: ${link} ${ask} – ${first}`
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
      `Hi [First name], I'm ${first}, ${who}. I made you a ${FILM_LENGTH} film about ${what}. Would like to connect. – ${first}`,
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
    `If the timing isn't right, no problem at all. Thanks for taking a look.`,
    '',
    first,
  ].join('\n')
  const linkedinFollowUp = `Hi [First name], following up on the film I made you: ${link} ${ask} – ${first}`
  const intro = [
    'Hi [First name],',
    '',
    `We're hiring for ${what}, and I made a ${FILM_LENGTH} film for a candidate you may know: ${link}`,
    '',
    'Would you be open to introducing us?',
    '',
    'Thank you.',
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
  // "a Forward Deployed Engineer", "an Operations Analyst", or "for an open role" with no post
  const hiringFor = out.job?.title
    ? `${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role}`
    : `for ${role}`
  const post = [
    `We're hiring: ${role} at ${company}.`,
    '',
    ...(lines.length ? ['What you would do:', ...lines.map((l) => `→ ${l}`), ''] : []),
    ...(stat && /\d/.test(stat) ? [`${stat[0]!.toUpperCase()}${stat.slice(1)}.`, ''] : []),
    `Watch the ${FILM_LENGTH} film: ${link}`,
    `Apply: ${apply}`,
    '',
    'Know someone who would be great at this? Tag them or send this their way.',
  ].join('\n')
  const email = {
    subject: `Know someone for our ${role} role?`,
    body: [
      'Hi [First name],',
      '',
      `We're hiring ${hiringFor} at ${company}, and I made a ${FILM_LENGTH} film about the role: ${link}`,
      '',
      `Who's the best person you know for it? The post is here: ${apply}`,
      '',
      'Thank you.',
      me,
    ].join('\n'),
  }
  // the connection note goes without the link; the film follows once they accept
  const linkedin = firstFit(
    [
      `Hi [First name], we're hiring ${hiringFor} at ${company} and I thought of you. Would like to connect. – ${first}`,
      `Hi [First name], we're hiring at ${company} and I thought of you. Would like to connect. – ${first}`,
      `Hi [First name], we're hiring at ${company}. Would like to connect.`,
    ],
    (t) => t.length <= MESSAGE_LIMITS.note,
  )
  // once they accept, one easy question: the film is the whole pitch
  const afterAccept = `Hi [First name], thanks for connecting. We're hiring ${hiringFor} at ${company} and I thought of you. A ${FILM_LENGTH} film about it: ${link} Would you take a look? – ${first}`
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

/* ------------------------------------------------------------ the model's drafts, served */

/** Where the film's link sits in a stored model draft (writer.ts FILM) */
const FILM_SLOT = '[film]'
const MODEL_DRAFTS = ['note', 'afterAccept', 'inmail', 'email'] as const

/** The post text a research line must stay close to (writer.ts researchSource) */
const postText = (i: HomeworkItem) => (i.summary ?? i.title).replace(/\s*…$/, '')

/**
 * What a film's drafts are checked against: the film's facts and the sender's profile, their
 * posts, and the sender's own homework (whose words, and numbers, are theirs to say). A job
 * seeker's drafts are checked in the voice too (voiceFor). The research line, when an email
 * carries one, is added by the caller.
 */
export function contextFor(
  out: Pick<FilmResult, 'company' | 'job' | 'highlights' | 'script' | 'related'> &
    Partial<Pick<FilmResult, 'homework'>>,
  profile: Profile,
  link: string,
  homework?: SenderHomework | null,
): CheckContext {
  const known = [
    knownFor(out, profile, out.homework),
    homework?.detail ?? '',
    homework?.question ?? '',
    homework?.built?.line ?? '',
  ]
    .filter(Boolean)
    .join('\n')
  return {
    company: out.company,
    known,
    link,
    ...(profile.preset === 'candidate' ? voiceFor(out, profile, out.homework, homework) : {}),
  }
}

/**
 * A post newer than the one the email read, for a job seeker's one follow-up to bring something
 * new: the newest dated item after it (or the newest, when the email read none), up to `now`.
 */
export function newerPost(
  homework: Homework | null | undefined,
  read: HomeworkItem | null,
  now = Date.now(),
): HomeworkItem | null {
  const after = read?.date ? Date.parse(read.date) : Number.NEGATIVE_INFINITY
  const dated = (homework?.items ?? [])
    .filter((i) => i.url !== read?.url && i.date)
    .map((i) => ({ i, t: Date.parse(i.date!) }))
    .filter(({ t }) => Number.isFinite(t) && t > after && t <= now + 86_400_000)
    .sort((a, b) => b.t - a.t)
  return dated[0]?.i ?? null
}

/**
 * The messages a film is served with: the templates, with the model's drafts swapped in where
 * the model wrote them (step 5 stores them with a [film] slot), then the parts code owns for
 * every email: the detail the sender saved after the film and the funding line. Each swapped
 * draft is checked again with the real link and those lines; whatever no longer passes falls
 * back to its template, and flags say why in plain words. Pure: `now` comes from the film.
 */
export function messagesFor(
  out: Pick<FilmResult, 'company' | 'job' | 'highlights' | 'script' | 'related'> &
    Partial<Pick<FilmResult, 'homework' | 'messages'>>,
  profile: Profile,
  link: string,
  {
    homework,
    ...more
  }: {
    /** what the sender saved for this film: their detail, question and small build */
    homework?: SenderHomework
    fresh?: string | null
    opener?: Opener
    raised?: { date: string } | null
    /** when the film was made: the research pick is the one it had then */
    now?: number
  } = {},
): Messages {
  const seeker = profile.preset === 'candidate' || profile.preset === 'sales'
  const candidate = profile.preset === 'candidate'
  // the post the email reads: the model's, when it wrote one, so template and model agree
  const stored = out.messages?.research
  const item = !seeker
    ? null
    : stored
      ? (out.homework?.items.find((i) => i.url === stored.itemUrl) ?? null)
      : out.homework
        ? pickResearch(
            out.homework,
            {
              ...(out.job?.title ? { role: out.job.title } : {}),
              points: profile.points,
            },
            more.now,
          )
        : null
  const newer = candidate ? newerPost(out.homework, item, more.now) : null
  const t = draftMessages(out, profile, link, {
    ...more,
    ...(homework ? { homework } : {}),
    ...(newer ? { newer: { title: newer.title, line: postText(newer) } } : {}),
    research: item ? { line: postText(item), source: postText(item), title: item.title } : null,
  })
  const m = out.messages
  if (!m || !seeker) return { ...t, notes: {} }
  // a job seeker's drafts were written from the homework they had then: new homework means the
  // templates (which always use it) stand in until the model writes them again
  const newHomework = candidate && !sameHomework(m.sender, homework)
  let rewrite = false

  const company = out.company
  const detail = homework?.detail ? clean(homework.detail) : ''
  // a job seeker's drafts are checked in the voice, so a stored draft from before it falls back
  const ctx = contextFor(out, profile, link, homework)
  const fill = (s: string) => s.replaceAll(FILM_SLOT, link)
  const writer = { ...t.writer }
  const flags: Record<string, Check[]> = {}
  const notes: NonNullable<Messages['notes']> = {}
  // drafts that fell back in the film keep the reasons they did
  for (const [d, why] of Object.entries(m.flags ?? {})) if (why?.length) flags[d] = why
  const result: Messages = { ...t, writer, flags, notes }

  for (const d of MODEL_DRAFTS) {
    if (m.writer[d] !== 'model') continue
    if (d === 'email') continue
    const draft = m.drafts[d]
    const text = typeof draft === 'string' ? fill(draft) : { ...draft, body: fill(draft.body) }
    const checks = checkMessage(d, text, ctx)
    if (!passed(checks)) {
      flags[d] = checks.filter((c) => !c.ok)
      rewrite ||= candidate
      continue
    }
    if (newHomework) {
      notes[d] = [NEW_HOMEWORK]
      rewrite = true
      continue
    }
    writer[d] = 'model'
    if (d === 'note') result.linkedin = text as string
    else if (d === 'afterAccept') result.afterAccept = text as string
    else result.inmail = text as { subject: string; body: string }
  }

  if (m.writer.email === 'model') {
    const email = modelEmail(m.drafts.email, {
      company,
      // a job seeker's model email opens from the homework itself, so code doesn't add it again
      detail: candidate ? '' : detail,
      whyNow: t.whyNow,
      fill,
      research: m.research && item ? { line: m.research.line, source: postText(item) } : null,
      ctx,
    })
    if (email.ok && newHomework) {
      notes.email = [NEW_HOMEWORK]
      rewrite = true
    } else if (email.ok) {
      writer.email = 'model'
      result.email = email.email
      result.whyNow = email.whyNow
      const changed = [...email.notes]
      // the proof opener puts the best number in the subject, so /v1/me/openers compares like with like
      const best = out.highlights?.proof[0]?.value
      if (t.opener === 'proof' && best && !result.email.subject.includes(best)) {
        result.email = { ...result.email, subject: t.email.subject }
        changed.push(
          `Used the subject with your best number (${best}), as every film that leads with it does`,
        )
      }
      if (changed.length) notes.email = changed
      result.checks = checkEmail(result.email, company, detail || null)
    } else {
      // the template stands in: flags say what the model's email failed, notes what code did about it
      flags.email = email.flags
      if (email.notes.length) notes.email = email.notes
      rewrite ||= candidate
    }
  }
  return candidate ? { ...result, rewrite } : result
}

/** Why a job seeker's model draft gave way to the template after they saved homework */
const NEW_HOMEWORK =
  'You saved homework after the model wrote this, so this is the template version, which uses it. Write it again to have the model use it too'

/**
 * Whether the drafts were written from the homework saved now. Drafts stored before step 3 don't
 * say what they were given: they count as written with none.
 */
function sameHomework(
  given: SenderHomework | null | undefined,
  now: SenderHomework | null | undefined,
): boolean {
  const key = (h: SenderHomework | null | undefined) =>
    JSON.stringify([
      h?.detail?.trim() || null,
      h?.question?.trim() || null,
      h?.built ? [h.built.url, h.built.line.trim()] : null,
    ])
  return key(given) === key(now)
}

/**
 * The model's email with the lines code adds after the opening: the funding line before it and
 * the saved detail after it, as the templates have them. When that breaks a check, the funding
 * line goes first. The detail never goes (the sender saved it on purpose): when the model's
 * email can't carry it, the template email, which always has it, is used instead. `flags` are
 * the checks the model's email failed; `notes` say, in plain sentences, what code changed.
 */
function modelEmail(
  draft: { subject: string; body: string },
  o: {
    company: string
    detail: string
    whyNow: boolean
    fill: (s: string) => string
    research: { line: string; source: string } | null
    ctx: CheckContext
  },
):
  | { ok: true; email: { subject: string; body: string }; whyNow: boolean; notes: string[] }
  | { ok: false; flags: Check[]; notes: string[] } {
  const body = o.fill(draft.body)
  const build = (withNow: boolean, withDetail: boolean) => {
    const lines = body.split('\n')
    // the greeting and a blank line, then the opening: the detail joins the opening's paragraph
    return [
      ...lines.slice(0, 2),
      ...(withNow ? ['Congratulations on the new funding round.', ''] : []),
      lines[2] ?? '',
      ...(withDetail ? [detailLine(o.company, o.detail)] : []),
      ...lines.slice(3),
    ].join('\n')
  }
  const failed = (b: string) =>
    checkMessage(
      'email',
      { subject: draft.subject, body: b },
      { ...o.ctx, research: o.research },
    ).filter((c) => !c.ok)
  const said = (f: Check | undefined) =>
    f?.rule === 'length'
      ? 'to stay under 125 words'
      : `because it ${f?.why ? lowerFirst(f.why) : 'broke a check'}`

  const full = failed(build(o.whyNow, !!o.detail))
  if (!full.length)
    return {
      ok: true,
      email: { subject: draft.subject, body: build(o.whyNow, !!o.detail) },
      whyNow: o.whyNow,
      notes: [],
    }
  if (o.whyNow) {
    const without = failed(build(false, !!o.detail))
    if (!without.length)
      return {
        ok: true,
        email: { subject: draft.subject, body: build(false, !!o.detail) },
        whyNow: false,
        notes: [`Left out the funding line ${said(full[0])}`],
      }
  }
  // the model's own email, with nothing added: did it fail on its own, or only with the detail?
  const plain = failed(build(false, false))
  if (o.detail && !plain.length) {
    const withDetail = failed(build(false, true))
    const f = withDetail[0]
    return {
      ok: false,
      flags: withDetail,
      notes: [
        f?.rule === 'length'
          ? `With your saved detail the model's email ran to ${f.why?.replace(/ of .*/, '')} of 125 words, so this is the template version, which keeps the detail`
          : `With your saved detail the model's email ${f?.why ? lowerFirst(f.why) : 'broke a check'}, so this is the template version, which keeps the detail`,
      ],
    }
  }
  return { ok: false, flags: plain, notes: [] }
}

const lowerFirst = (s: string) => s[0]!.toLowerCase() + s.slice(1)
