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
  outreach: { status: OutreachStatus; at: string; sentAt: string } | null
}

export type OutreachStatus = 'sent' | 'replied' | 'interview' | 'no_reply'
export const OUTREACH_LABEL: Record<OutreachStatus, string> = {
  sent: 'Sent',
  replied: 'Replied',
  interview: 'Interview',
  no_reply: 'No reply',
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
  cta: { line: string; contact: string }
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
