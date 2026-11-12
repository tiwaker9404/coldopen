/**
 * Warm leads: what to do after someone replies, and when. A reply is the start of a
 * relationship, not the end of the outreach. The sender thanks them the same day, naming one
 * thing they said and what they'll do with it, and asks who else to talk to (one contact becomes
 * several). When they said they'd build something from the conversation, a short note with it
 * follows 5 days later: proof of work built around a problem the person mentioned is what
 * stands out. Then a short update every 6 weeks keeps the line warm. When a role that fits opens
 * at their company, the sender asks them to pass their name to the hiring manager, with a way
 * out and a blurb they can forward, and bumps it once a week later. A referral reaches the
 * hiring manager personally, and referrals hire at about 30% against 7% from other sources.
 *
 * Pure: no network, no clock (every function takes `now`). The drafts are templates, written
 * here so the web app can show the thank-you as the sender types; checks.ts checks them.
 */
import { proofPhrase, rankProof, startsWithVerb } from '../profile/proof.ts'
import type { Profile } from '../script/types.ts'
import { companyKey, sameCompany } from './people.ts'
import { lowerStart } from './voice.ts'

export const TOUCH_KINDS = [
  'thankYou',
  'proofOfWork',
  'stayInTouch',
  'referralAsk',
  'referralBump',
] as const
export type TouchKind = (typeof TOUCH_KINDS)[number]
/** the kinds that ask for a referral, and so may name the role and the hiring manager */
export const REFERRAL_KINDS: readonly TouchKind[] = ['referralAsk', 'referralBump']

const DAY = 86_400_000
/** days after the thank-you before the note with what they built */
export const PROOF_DAYS = 5
/** days between stay-in-touch notes: often enough to be remembered, rare enough to be welcome */
export const STAY_DAYS = 42
/** the referral ask is due the day after the role appears */
export const REFERRAL_DAYS = 1
/** days after the referral ask, with no reply, before its one bump */
export const BUMP_DAYS = 7

/** One touch the sender marked done (or "Stop reminders", kind 'stop'), as the touches table keeps it */
export interface Touch {
  kind: TouchKind | 'stop'
  /** the role a referral ask or bump was about */
  roleId: string | null
  /** "One thing they said", saved with the thank-you */
  said: string | null
  /** "Something I'll build from what you said", saved with the thank-you */
  buildNote: string | null
  /** the link to what they built, saved with the proof-of-work note */
  buildLink: string | null
  doneAt: string
}

/** What nextTouch needs to know about a film */
export interface WarmFilm {
  preset: Profile['preset'] | undefined
  /** its outreach status: only 'replied' and 'interview' are warm */
  status: string | null | undefined
  /** when it was first marked replied (or interview) */
  repliedAt: string | null | undefined
  company: string | null | undefined
  host: string | null | undefined
}

/** A role from the Jobs cache, with how well the sender fits it */
export interface WarmJob {
  id: string
  title: string
  url: string
  company: string
  site?: string | undefined
  posted?: string | undefined
  fit: 'strong' | 'good' | 'stretch' | null
  /** the line of their record that answers the role best (Fit check's best answer) */
  why?: string | null
}

export interface NextTouch {
  kind: TouchKind
  dueAt: string
  due: boolean
  /** the role, for a referral ask or bump */
  role?: { id: string; title: string; url: string; why?: string | null }
}

/** A warm film: a job seeker's film that got a reply */
export const isWarm = (f: Pick<WarmFilm, 'preset' | 'status'>) =>
  f.preset === 'candidate' && (f.status === 'replied' || f.status === 'interview')

const hostOf = (s: string | null | undefined) => {
  if (!s) return ''
  try {
    return new URL(/^https?:/.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Is this role at the film's company: the same name, or the same website */
export function atCompany(film: Pick<WarmFilm, 'company' | 'host'>, job: WarmJob): boolean {
  const host = hostOf(film.host)
  if (host && hostOf(job.site) === host) return true
  const key = companyKey(film.company ?? '') || companyKey(host)
  return !!key && sameCompany(key, job.company)
}

/** Roles worth a referral ask: at their company, posted on or after the day of the reply, strong or good */
export function rolesFor(film: WarmFilm, jobs: WarmJob[]): WarmJob[] {
  const replied = Date.parse(film.repliedAt ?? '')
  if (Number.isNaN(replied)) return []
  // posted dates are often a day with no time: count the whole day of the reply
  const from = replied - (replied % DAY)
  return jobs
    .filter((j) => (j.fit === 'strong' || j.fit === 'good') && atCompany(film, j))
    .filter((j) => {
      const at = Date.parse(j.posted ?? '')
      return !Number.isNaN(at) && at >= from
    })
    .sort((a, b) => Date.parse(a.posted!) - Date.parse(b.posted!) || a.id.localeCompare(b.id))
}

/** The order due touches come in when more than one is: thanks first, a fresh role next */
const PRIORITY: TouchKind[] = [
  'thankYou',
  'referralAsk',
  'referralBump',
  'proofOfWork',
  'stayInTouch',
]

/**
 * What to do next for a warm film, and when: at most one touch, the due one first (in PRIORITY
 * order), else the soonest coming up. Null for a film that isn't warm, or once the sender
 * pressed "Stop reminders".
 */
export function nextTouch(
  film: WarmFilm,
  touches: Touch[],
  jobs: WarmJob[],
  now: number,
): NextTouch | null {
  if (!isWarm(film)) return null
  if (touches.some((t) => t.kind === 'stop')) return null
  const replied = Date.parse(film.repliedAt ?? '')
  if (Number.isNaN(replied)) return null
  const at = (t: number) => new Date(t).toISOString()
  const of = (k: TouchKind) => touches.filter((t) => t.kind === k)

  const thanks = of('thankYou')[0]
  // nothing else until they've been thanked
  if (!thanks) return { kind: 'thankYou', dueAt: at(replied), due: now >= replied }

  const options: NextTouch[] = []
  const add = (kind: TouchKind, t: number, role?: NextTouch['role']) =>
    options.push({ kind, dueAt: at(t), due: now >= t, ...(role ? { role } : {}) })

  // one ask per role, the earliest posted first
  const asked = new Set(of('referralAsk').map((t) => t.roleId))
  const role = rolesFor(film, jobs).find((j) => !asked.has(j.id))
  if (role)
    add('referralAsk', Date.parse(role.posted!) + REFERRAL_DAYS * DAY, {
      id: role.id,
      title: role.title,
      url: role.url,
      why: role.why ?? null,
    })

  // one bump per ask, then nothing more for that role
  const bumped = new Set(of('referralBump').map((t) => t.roleId))
  for (const ask of of('referralAsk')) {
    if (!ask.roleId || bumped.has(ask.roleId)) continue
    const job = jobs.find((j) => j.id === ask.roleId)
    add('referralBump', Date.parse(ask.doneAt) + BUMP_DAYS * DAY, {
      id: ask.roleId,
      title: job?.title ?? 'the role',
      url: job?.url ?? '',
      why: job?.why ?? null,
    })
  }

  if (thanks.buildNote?.trim() && !of('proofOfWork').length)
    add('proofOfWork', Date.parse(thanks.doneAt) + PROOF_DAYS * DAY)

  const last = Math.max(
    ...touches.filter((t) => t.kind !== 'stop').map((t) => Date.parse(t.doneAt)),
  )
  add('stayInTouch', last + STAY_DAYS * DAY)

  const due = options
    .filter((o) => o.due)
    .sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))
  if (due.length) return due[0]!
  return options.sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0] ?? null
}

/** The sender's saved words from the thank-you: what later touches build on */
export const saidOf = (touches: Touch[]) => touches.find((t) => t.kind === 'thankYou') ?? null

/* ------------------------------------------------------------ this month */

const MONTH_ZONE = 'America/Los_Angeles'
/** minutes the zone is ahead of UTC at a moment */
function zoneOffset(t: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t))
  const n = (k: string) => Number(parts.find((p) => p.type === k)!.value)
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  return Math.round((local - (t - (t % 1000))) / 60_000)
}

/** The start of the calendar month now is in, Pacific time */
export function monthStart(now: number, zone = MONTH_ZONE): Date {
  const local = new Date(now + zoneOffset(now, zone) * 60_000)
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1)
  let t = midnight - zoneOffset(midnight, zone) * 60_000
  t = midnight - zoneOffset(t, zone) * 60_000
  return new Date(t)
}

/** "<n> conversations this month": films first marked replied or interview since the 1st */
export function conversationsThisMonth(
  films: { repliedAt: string | null | undefined }[],
  now: number,
): number {
  const from = monthStart(now).getTime()
  return films.filter((f) => {
    const t = Date.parse(f.repliedAt ?? '')
    return t >= from && t <= now
  }).length
}

/* ------------------------------------------------------------ the drafts */

export interface TouchInput {
  kind: TouchKind
  company: string
  profile: Pick<Profile, 'sender' | 'points' | 'proof' | 'creator' | 'projects'>
  /** one thing they said (saved with the thank-you, or typed in its box) */
  said: string | null
  /** something the sender will build from it */
  buildNote?: string | null | undefined
  /** the link to what they built */
  buildLink?: string | null | undefined
  /** the role, for the referral kinds */
  role?: { title: string; url: string; why?: string | null | undefined } | null | undefined
  /** the film's share link, for the blurb */
  share?: string | null | undefined
  /** a fresh post of theirs, for a stay-in-touch with nothing new built */
  post?: { title: string; url?: string | undefined } | null | undefined
}

export interface TouchDraft {
  subject: string
  body: string
  /** the referral ask's forwardable blurb, third person */
  blurb?: string
}

/** In the drafts until the sender fills it in */
export const SAID_SLOT = '[one thing they said]'
export const LINK_SLOT = '[link to what you built]'

const tidy = (s: string | null | undefined) =>
  (s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?]+$/, '')
const quoted = (s: string) => `"${s.replace(/["“”]/g, "'")}"`
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

/** what they said, in quotes: their words, kept as they said them */
const saidText = (said: string | null) => {
  const s = tidy(said)
  return s ? quoted(s) : SAID_SLOT
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  )
const overlapWith = (a: string, b: string) => {
  const x = words(a)
  return [...words(b)].filter((w) => x.has(w)).length
}

/**
 * A line said mid-sentence, with names and titles kept as written: "Forward Deployed Engineer"
 * and "HubSpot records" stay cased, "Forward deployed engineer" becomes "forward deployed
 * engineer". Only a plain capital on an ordinary first word comes down.
 */
export function asSaid(s: string): string {
  const [first, second] = s.trim().split(/\s+/)
  if (!first || !/^[A-Z][a-z'’-]+$/.test(first)) return s.trim()
  // "Forward Deployed Engineer": a title in title case is a name
  if (second && /^[A-Z][a-z]/.test(second)) return s.trim()
  return `${first[0]!.toLowerCase()}${s.trim().slice(1)}`
}

/**
 * The one result that fits a role: the proof most relevant to it (the role and why the sender
 * fits it, ranked as the film ranks proof for a company), with what they did, the change and
 * where, said once, with no repeated number.
 */
export function resultFor(
  profile: Pick<Profile, 'proof' | 'points'>,
  title: string,
  about = '',
): string | null {
  const order = rankProof(profile.proof, `${title}\n${about}`)
  const best = order.length ? profile.proof[order[0]!] : undefined
  if (best) {
    // the number once: "40,000 tracking events a day", or a change card's label alone
    // ("report time, from 6 hours to 20 minutes"), which already says both numbers
    const label = /\d/.test(best.value) ? proofPhrase(best) : best.label
    const what = best.did ? `${tidy(best.did)} (${asSaid(tidy(label))})` : tidy(label)
    return best.where ? `${what} at ${best.where.trim()}` : what
  }
  const point = profile.points[0]
  return point ? tidy(point) : null
}

/** The profile line that says why the sender fits a role: Fit check's best answer, else the closest point */
export function whyFits(profile: Pick<Profile, 'points'>, title: string, why?: string | null) {
  if (why?.trim()) return tidy(why)
  const best = [...profile.points].sort((a, b) => overlapWith(b, title) - overlapWith(a, title))[0]
  return best ? tidy(best) : null
}

/**
 * A résumé point in the sender's own voice: "Ships production agents" -> "I ship production
 * agents". Anything that doesn't open on a verb like that ("6 projects shipped") is kept as it is.
 */
export function inFirstPerson(point: string): string {
  const m = point.match(/^([A-Z][a-z]+)(\s.*)$/)
  if (!m || /^I\s/.test(point) || /^(Is|Has|Was|Does|This|Its|Plus|Across)$/.test(m[1]!))
    return asSaid(point)
  const w = m[1]!.toLowerCase()
  // "Deployed a custom analytics engine" -> "I deployed a custom analytics engine"
  if (startsWithVerb(m[1]!)) return `I ${w}${m[2]}`
  const verb = /(ch|sh|ss|x|z)es$/.test(w)
    ? w.slice(0, -2)
    : /[^aeiou]ies$/.test(w)
      ? `${w.slice(0, -3)}y`
      : /[^s]s$/.test(w)
        ? w.slice(0, -1)
        : null
  return verb ? `I ${verb}${m[2]}` : asSaid(point)
}

/** What the sender built or shipped lately: their creator line, else their first project */
const newest = (profile: TouchInput['profile']) => {
  if (profile.creator)
    return { name: profile.creator.name, line: profile.creator.line, url: profile.creator.url }
  const p = profile.projects?.[0]
  return p ? { name: p.name, line: p.line, url: p.url } : null
}

/**
 * The draft for a touch: the email subject, the body (greeting to signature) and, for a
 * referral ask, the blurb they can forward. Templates only: every one passes checkMessage on
 * every fixture (test/unit/messages.test.ts).
 */
export function draftTouch(t: TouchInput): TouchDraft {
  const me = firstName(t.profile.sender.name)
  const hi = 'Hi [First name],'
  const sign = (thanks: string) => `${thanks}\n${me}`
  const said = saidText(t.said)
  const company = t.company.trim()
  const paras = (...ps: (string | false | null | undefined)[]) =>
    ps.filter((p): p is string => !!p).join('\n\n')

  switch (t.kind) {
    case 'thankYou': {
      const build = tidy(t.buildNote)
      return {
        subject: 'Thank you for the time',
        body: paras(
          hi,
          `Thank you for making the time to talk. I keep coming back to what you said about ${said}.`,
          build
            ? `I'm going to try something with it: ${lowerStart(build)}. I'll send it over when it's done.`
            : "I'm going to dig into it this week.",
          'Is there anyone else you think I should talk to?',
          sign('Thank you,'),
        ),
      }
    }
    case 'proofOfWork': {
      const build = tidy(t.buildNote)
      const link = t.buildLink?.trim() || LINK_SLOT
      return {
        subject: 'Something I built after we talked',
        body: paras(
          hi,
          `After we talked about ${said}, I built ${build ? lowerStart(build) : 'a small version of it'}: ${link}`,
          "It's small, but working through it taught me a lot about the problem you described.",
          sign('Thank you,'),
        ),
      }
    }
    case 'stayInTouch': {
      const made = newest(t.profile)
      const post = t.post?.title ? tidy(t.post.title) : ''
      const update = made
        ? `A quick update since we talked: I've been working on ${made.name}. ${tidy(made.line)}. (${made.url})`
        : post
          ? `I read ${quoted(post)} on ${company}'s blog and thought of what you said about ${said}.`
          : `I've been thinking about what you said about ${said} since we talked.`
      return {
        subject: 'A quick update',
        body: paras(hi, update, `Hope things are going well at ${company}.`, sign('Thank you,')),
      }
    }
    case 'referralAsk': {
      const title = tidy(t.role?.title) || 'a new role'
      const url = t.role?.url?.trim() ?? ''
      const fits = whyFits(t.profile, title, t.role?.why)
      const s = tidy(t.said)
      return {
        subject: `${title} at ${company}`,
        body: paras(
          hi,
          `When we talked about ${s ? quoted(s) : SAID_SLOT}, I came away wanting to work on exactly that. ${company} just posted the ${title} role${url ? `: ${url}` : '.'}`,
          fits && `It's close to what I do now: ${inFirstPerson(fits)}.`,
          "Would you be open to passing my name to the hiring manager? I'm happy to send whatever would help, and there's a short blurb below you can forward.",
          // the way out, on its own and meant: a no should cost them nothing
          WAY_OUT,
          sign('Thank you,'),
        ),
        blurb: blurbFor(t, title),
      }
    }
    case 'referralBump': {
      const title = tidy(t.role?.title) || 'the role'
      const url = t.role?.url?.trim()
      return {
        subject: `Re: ${title} at ${company}`,
        body: paras(
          hi,
          `A short bump on the ${title} role at ${company}${url ? ` (${url})` : ''}, in case my note got buried. No problem at all if the timing isn't right.`,
          sign('Thank you,'),
        ),
      }
    }
  }
}

/** How the referral ask lets them say no, as its own sentence */
export const WAY_OUT =
  "If the timing's wrong or it isn't a fit, no worries at all, and thank you for the conversation either way."

/** The blurb's most words: short enough to forward without editing */
export const BLURB_WORDS = 70

/**
 * The forwardable blurb, third person: who the sender is, the one result that fits, why now,
 * and the film. Parts drop off from the end of the result inward until it fits in 70 words.
 */
function blurbFor(t: TouchInput, title: string): string {
  const name = t.profile.sender.name.trim()
  const first = firstName(name)
  const role = t.profile.sender.role?.trim()
  // "a Forward Deployed Engineer" keeps its title case; "a forward deployed engineer" its own
  const r0 = role ? asSaid(tidy(role)) : ''
  const who = r0 ? `${name}, ${/^[aeiou]/i.test(r0) ? 'an' : 'a'} ${r0},` : name
  const result = resultFor(t.profile, title, `${t.role?.why ?? ''} ${t.company}`)
  const film = t.share ? `${first} made a 30-second film for ${t.company}: ${t.share}` : null
  const parts = (r: string | null) =>
    [
      `${who} is interested in the ${title} role at ${t.company}.`,
      r && `One result that fits: ${r}${r.endsWith('.') ? '' : '.'}`,
      `We talked recently, and ${first} reached out as soon as the role opened.`,
      film,
    ]
      .filter(Boolean)
      .join(' ')
  const n = (s: string) => s.split(/\s+/).filter((w) => !/^https?:\/\//.test(w)).length
  let out = parts(result)
  // a long proof drops its scope first, then the result itself
  if (n(out) > BLURB_WORDS && result) out = parts(result.replace(/ \([^)]*\)/, ''))
  if (n(out) > BLURB_WORDS) out = parts(null)
  return out
}
