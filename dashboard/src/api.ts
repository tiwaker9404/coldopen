export type Status = 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
export type Format = 'square' | 'landscape' | 'portrait'

export interface Film {
  id: string
  status: Status
  url: string
  format: Format
  batch: string | null
  sender: string
  /** Pitch a role: a recruiter's film made for one candidate */
  pitch?: { candidate: string } | null
  progress: { stage?: string; label?: string; percent?: number; scene?: number } | null
  attempts: number
  error: string | null
  errorCode: string | null
  createdAt: string
  completedAt: string | null
  company: string | null
  host: string | null
  durationSec: number | null
  files: { film: string; poster: string; gif: string; sheet: string } | null
  share: string | null
  job: { title: string | null; url: string | null } | null
  views: ViewSummary | null
  outreach: {
    status: OutreachStatus
    at: string
    sentAt: string
    followUps?: number
    followedUpAt?: string
    /** what to do next while it waits for a reply */
    next: NextStep | null
  } | null
  /** the first film, when this one re-renders it with edited lines */
  editOf: string | null
  /** who it's going to, when you saved it */
  recipient: Recipient | null
  /** your one detail from using their product */
  detail?: string | null
  /** synced to your HubSpot */
  crm?: { syncedAt: string; error: string | null; noted: string[] } | null
}

export interface Recipient {
  name: string
  email?: string
  url?: string
}

/** an address for someone at the film's company: found by Hunter, or a common pattern */
export interface EmailFound {
  email: string
  source: 'hunter' | 'guess'
  score?: number
  status?: string
}
export interface FoundEmails {
  domain: string
  found: EmailFound | null
  guesses: EmailFound[]
  /** whether you saved a Hunter key */
  hunter: boolean
  note: string | null
}

/** lines that can be rewritten before re-rendering */
export interface ScriptEdit {
  hook?: string
  noticed?: string
  why?: string
  headline?: string
  points?: string[]
  cta?: string
}

/** on-screen word limits: the same ones the renderer enforces */
export { LIMITS } from '../../src/script/taste.ts'

/** the hosted app's funnel, for its owner */
export interface Stats {
  days: number
  visitors: number
  signups: number
  makers: number
  films: number
  succeeded: number
  failed: number
  edits: number
  sent: number
  watched: number
  replied: number
  interviews: number
  failures: { error: string; n: number }[]
}

export type OutreachStatus = 'sent' | 'replied' | 'interview' | 'no_reply'
export const OUTREACH_LABEL: Record<OutreachStatus, string> = {
  sent: 'Sent',
  replied: 'Replied',
  interview: 'Interview',
  no_reply: 'No reply',
}

/** who to send a film to */
export interface People {
  company: string
  searches: { label: string; hint: string; url: string }[]
  known: {
    name: string
    url: string | null
    company: string
    position: string | null
    connectedOn: string | null
  }[]
  /** how many connections you uploaded; 0 means none yet */
  connections: number
}

/** films sent and how many got a reply */
export interface OutreachSummary {
  sent: number
  replied: number
  interviews: number
  noReply: number
  waiting: number
  replyRate: number | null
}

/** what people did on a film's share page (bots and link scanners not counted) */
export interface ViewSummary {
  opens: number
  viewers: number
  plays: number
  finishes: number
  /** pressed the button under the film (book a call, or reply) */
  clicks: number
  bestSeconds: number
  firstPlayAt: string | null
  lastSeen: string | null
}

export interface ViewSession {
  session: string
  firstSeen: string
  lastSeen: string
  played: boolean
  seconds: number
  finished: boolean
  device: 'mobile' | 'desktop'
  referrer: string | null
  country: string | null
}

export interface Messages {
  email: { subject: string; body: string }
  linkedin: string
  followUp: string
  lastNote: string
  linkedinFollowUp: string
  /** to someone you know there, asking them to pass it on */
  intro: string
  /** the note they forward, about you in the third person */
  forward?: string
  /** how the email measures up: short, about them, your detail, one ask */
  checks: { words: number; short: boolean; aboutThem: boolean; detail: boolean; oneAsk: boolean }
  /** which way this film's drafts open: half your films lead with the film, half with your best number */
  opener?: 'film' | 'proof'
  /** opens on their recent funding round */
  whyNow?: boolean
}

/** how each opener is doing: films you marked sent, watched and replied */
export interface Openers {
  film: { sent: number; watched: number; replied: number }
  proof: { sent: number; watched: number; replied: number }
  leader: 'film' | 'proof' | null
}

/** "3 min ago", "yesterday", "Oct 12" */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 172800) return 'yesterday'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export interface FilmDetail extends Film {
  script: {
    hook: string
    noticed: string
    insight: { factId: string; why: string }
    pitch: { headline: string; points: string[] }
    proof: number[]
    cta: string
  } | null
  scriptMeta: {
    model: string
    rounds: number
    violations: string[][]
    usedFallback: boolean
  } | null
  highlights: {
    quote: { text: string; source: string }
    proof: { value: string; label: string; where?: string }[]
  } | null
  qa: { issues: { kind: string; text?: string }[]; fonts: string[] } | null
  render: { frames: number; ms: number } | null
  steps: {
    key: string
    kind: string
    status: string
    durationMs: number | null
    replays: number
    attempts: number
    error: string | null
  }[]
  timeline: { id: string; at: string; kind: string; message: string }[]
  embed: string | null
}

export interface ProfileData {
  preset: 'sales' | 'candidate' | 'recruiter'
  sender: { name: string; company?: string; role?: string }
  /** recruiter films: the candidate it's made for */
  recipient?: { name: string; role?: string }
  offer: string
  points: string[]
  proof: { value: string; label: string; where?: string }[]
  cta: { line: string; contact: string; book?: string }
  /** skills and tools, counted by Fit check */
  skills?: string[]
  /** schools, for alumni at the companies you film */
  schools?: string[]
  color?: string
}

export interface Profile {
  id: string
  name: string
  data: ProfileData
  updatedAt: string
}

/** The hosted app's account state (on a private install, hosted is false and the rest null). */
export interface Me {
  hosted: boolean
  signIn: boolean
  user: { login: string; name: string | null; avatar: string | null } | null
  films: { used: number; limit: number } | null
  keepsDays: number | null
  /** the owner: can see the app-wide funnel */
  stats?: boolean
  /** where feedback goes */
  contact?: string
  /** ways to sign in, the most common first */
  providers?: ('google' | 'github')[]
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const KEY = 'coldopen.apiKey'
export function apiKey(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}
export function setApiKey(v: string) {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    /* storage blocked: key lasts for this page */
  }
}

/**
 * Finished films are public: at /f/:id on this server (that's the share page), or on the
 * share worker when the hosted app published them there. Either way media needs no key.
 */
export function media(
  film: Film,
  name: 'poster.jpg' | 'preview.gif' | 'contact-sheet.jpg' | 'film',
): string {
  const filmFile = film.files?.film.split('/').pop() ?? ''
  const file = name === 'film' ? filmFile : name
  if (film.files && /^https?:/.test(film.files.film))
    return `${film.files.film.slice(0, film.files.film.lastIndexOf('/'))}/${file}`
  return `/f/${film.id}/${file}`
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const k = apiKey()
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(k ? { authorization: `Bearer ${k}` } : {}),
      ...init.headers,
    },
  })
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
  if (!res.ok) throw new ApiError(res.status, body.error?.message ?? `HTTP ${res.status}`)
  return body as T
}

export const send = <T>(method: string, path: string, body?: unknown) =>
  api<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

export interface ProfileDraft {
  profile: ProfileData
  meta: { model: string; rounds: number; dropped: string[] }
}

/** Upload a résumé; the server drafts a profile (nothing is saved until you save it). */
export async function draftFromResume(
  file: File,
  role: string,
  exclude: string[],
): Promise<ProfileDraft> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return send<ProfileDraft>('POST', '/v1/profiles/draft', {
    filename: file.name,
    data: btoa(bin),
    role,
    exclude,
  })
}

/** "Linear - Product Engineer - Alex Rivera": what a downloaded film is saved as */
export function fileName(film: Film): string {
  const company = film.company ?? film.host ?? 'coldopen film'
  return [company, film.job?.title, film.sender].filter(Boolean).join(' - ')
}

/** a link that saves the film or GIF under the company's name instead of playing it */
export function downloadUrl(film: Film, name: 'film' | 'preview.gif'): string {
  const ext = name === 'film' ? '.mp4' : '.gif'
  return `${media(film, name)}?download=${encodeURIComponent(fileName(film) + ext)}`
}

/** what kind of link was pasted, so the page can say what the film will be about */
export function linkKind(text: string): 'job' | 'site' | null {
  const t = text.trim()
  if (!t) return null
  if (
    /(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|myworkdayjobs\.com|smartrecruiters\.com|jobvite\.com|bamboohr\.com|rippling\.com|wellfound\.com|ycombinator\.com\/companies\/[^/]+\/jobs|linkedin\.com\/jobs)/i.test(
      t,
    ) ||
    /\/(jobs?|careers?|positions?|openings?|roles?)\/[^/\s]+/i.test(t)
  )
    return 'job'
  return /\.[a-z]{2,}/i.test(t) ? 'site' : null
}

/** a role from a company's public job board that fits what they're looking for */
export interface JobSuggestion {
  id: string
  company: string
  site?: string
  title: string
  url: string
  location: string
  remote: boolean
  team?: string
  posted?: string
  /** why it was picked: the role it fits, the place, "New this week" */
  why: string[]
  /** the company's YC batch, "W24", when it's a YC company */
  yc?: string
  /** its page on ycombinator.com: the founders, and roles it posts on Work at a Startup */
  ycPage?: string
  /** the company's open roles, and how many went up in the last 30 days */
  hiring?: { open: number; recent: number }
  /** H-1B petitions the company had approved in the latest fiscal year */
  visa?: { approvals: number; year: number }
  /** the company's latest SEC Form D (a private round) in the last year */
  /** a Form D in the last 3 months; amount is dollars sold, when the filing states it */
  raised?: { date: string; filer: string; amount?: number }
  /** full time, part time, contract or internship, when the board says */
  type?: 'full_time' | 'part_time' | 'contract' | 'intern'
  /** remote, hybrid or on site, when the board says */
  workplace?: 'remote' | 'hybrid' | 'onsite'
  /** the fewest years of experience its requirements ask for */
  years?: number
  /** yearly base pay the post lists */
  pay?: { min: number; max: number; currency: string }
  /** people you know there, from your LinkedIn connections */
  known?: { count: number; people: { name: string; position: string | null; url: string | null }[] }
  /** the film already made for it */
  filmId?: string
  /** how well your profile answers the post's requirements; absent when it lists none we read */
  fit?: {
    level: 'strong' | 'good' | 'stretch'
    answered: number
    of: number
    best: { requirement: string; with: string } | null
  }
}

export interface JobSearch {
  roles: string[]
  locations: string[]
  remote: boolean
  skipSenior: boolean
  /** only YC companies */
  ycOnly: boolean
  /** best fit first, or the companies hiring fastest first */
  sort: 'best' | 'fastest'
  /** only companies with H-1B approvals last year */
  visaOnly: boolean
  /** only companies that raised a private round in the last 3 months */
  raisedOnly: boolean
  /** with raisedOnly: the round's size */
  raisedSize?: RaisedSize
  /** US only (default) or anywhere */
  country: 'us' | 'any'
  /** how senior, from the title; empty: any */
  levels: ('intern' | 'entry' | 'mid' | 'senior' | 'lead' | 'director')[]
  /** people managers, individual contributors, or both */
  roleType: 'any' | 'ic' | 'manager'
  /** words that rule a title out */
  excludeTitles: string[]
  /** skills the requirements must name, any of them */
  skills: string[]
  /** skills that rule a post out */
  excludeSkills: string[]
  noClearance: boolean
  noCitizenOnly: boolean
  /** empty: any */
  types: ('full_time' | 'part_time' | 'contract' | 'intern')[]
  /** empty: any */
  workplaces: ('remote' | 'hybrid' | 'onsite')[]
  /** leave out posts asking for more years than this */
  maxYears: number | null
  /** only roles posted in the last week or month */
  within: 'any' | 'day' | '3days' | 'week' | 'month'
  /** companies to leave out */
  exclude: string[]
  /** hide roles whose listed pay tops out below this, yearly in dollars */
  minPay: number | null
  boards: { ats: 'greenhouse' | 'lever' | 'ashby'; token: string; name: string }[]
  /** nothing saved yet: the roles came from the profile */
  suggested: boolean
}

/** a skill your best matches keep asking for that your profile doesn't show */
export interface FitGap {
  term: string
  label: string
  jobs: number
  example: string
}

export interface JobSuggestions {
  data: JobSuggestion[]
  /** what's new since their last look at Jobs */
  alerts: { since: string | null; newMatches: number; filmed: JobSuggestion[] }
  gaps: FitGap[]
  companies: number
  /** how many of them are YC companies */
  ycCompanies: number
  /** how many have a recent funding round on file */
  raisedCompanies?: number
  failed: string[]
  updatedAt: string | null
  search: JobSearch
}

/** a follow-up (1 or 2), or "close": time to mark it no reply */
export interface NextStep {
  kind: 'follow_up' | 'close'
  step: 1 | 2 | null
  dueAt: string
  due: boolean
  /** brought forward: they watched it since you last wrote */
  watched?: { at: string; finished: boolean }
}

export interface FollowUps {
  data: {
    film: Film
    next: NextStep
    message: { subject: string; body: string; linkedin: string; to: string | null } | null
  }[]
  /** sent films not due yet */
  waiting: number
  nextDueAt: string | null
}

/** round sizes, from the dollars a Form D says were sold (it never names the round) */
export type RaisedSize = 'any' | 'seed' | 'a' | 'b' | 'c'
export const RAISED_SIZES: {
  id: Exclude<RaisedSize, 'any'>
  label: string
  hint: string
  max: number
}[] = [
  { id: 'seed', label: 'Under $3M', hint: 'usually pre-seed or seed', max: 3e6 },
  { id: 'a', label: '$3M to $20M', hint: 'usually Series A', max: 2e7 },
  { id: 'b', label: '$20M to $80M', hint: 'usually Series B', max: 8e7 },
  {
    id: 'c',
    label: '$80M and up',
    hint: 'usually Series C or later',
    max: Number.POSITIVE_INFINITY,
  },
]

/** "$45M", "$2.5M", "$800K" */
export function dollars(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(/\.0$/, '')}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`
  return `$${Math.round(n / 1e3)}K`
}

/** a brief for the call once they reply, from the film's own research */
export interface Brief {
  company: string
  what: string | null
  facts: string[]
  role: {
    title: string
    matches: { asks: string; you: string }[]
    prepare: string[]
  } | null
  pitch: string
  questions: string[]
  /** what they'll likely ask you, with your answer from your record (null: prepare one) */
  expect?: { q: string; a: string | null }[]
}
