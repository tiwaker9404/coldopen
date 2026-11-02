export type Status = 'queued' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
export type Format = 'square' | 'landscape' | 'portrait'

export interface Film {
  id: string
  status: Status
  url: string
  format: Format
  batch: string | null
  sender: string
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
  preset: 'sales' | 'candidate'
  sender: { name: string; company?: string; role?: string }
  offer: string
  points: string[]
  proof: { value: string; label: string; where?: string }[]
  cta: { line: string; contact: string; book?: string }
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
  /** the company's open roles, and how many went up in the last 30 days */
  hiring?: { open: number; recent: number }
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
  boards: { ats: 'greenhouse' | 'lever' | 'ashby'; token: string; name: string }[]
  /** nothing saved yet: the roles came from the profile */
  suggested: boolean
}

export interface JobSuggestions {
  data: JobSuggestion[]
  companies: number
  /** how many of them are YC companies */
  ycCompanies: number
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
