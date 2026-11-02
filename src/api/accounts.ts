import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Config } from '../config.ts'
import type { Sql } from '../db/index.ts'

/**
 * Who is asking, on the hosted app. No passwords and no sessions table: a signed cookie
 * carries the GitHub user, and visitors trying it out get a signed random id instead, so
 * their first film and profile are theirs until they sign in and keep them.
 *
 *   'team'      a private install, or a request with an API key
 *   'u:gh:123'  a signed-in GitHub user
 *   'u:go:456'  a signed-in Google user
 *   'a:k3j…'    a visitor without an account
 */
export type Owner = string

declare module 'fastify' {
  interface FastifyRequest {
    /** whose films and profiles this request sees (set by the auth hook) */
    owner: Owner
  }
}

const SESSION = 'co_session'
const VISITOR = 'co_visitor'
const STATE = 'co_oauth'
const DAY = 86_400

export interface Session {
  sub: string
  login: string
  name: string | null
  avatar: string | null
  exp: number
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url')

export function sign(secret: string, value: string): string {
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`
}

export function unsign(secret: string, signed: string | undefined): string | null {
  if (!signed) return null
  const i = signed.lastIndexOf('.')
  if (i < 1) return null
  const value = signed.slice(0, i)
  const want = Buffer.from(sign(secret, value).slice(i + 1))
  const got = Buffer.from(signed.slice(i + 1))
  return want.length === got.length && timingSafeEqual(want, got) ? value : null
}

export function cookies(req: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

function setCookie(
  reply: FastifyReply,
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
) {
  const attrs = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
    ...(secure ? ['Secure'] : []),
  ]
  const prev = reply.getHeader('set-cookie')
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : []
  reply.header('set-cookie', [...list, attrs.join('; ')])
}

export function readSession(cfg: Config, req: FastifyRequest): Session | null {
  const raw = unsign(cfg.SESSION_SECRET!, cookies(req)[SESSION])
  if (!raw) return null
  try {
    const s = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Session
    return s.exp > Date.now() / 1000 ? s : null
  } catch {
    return null
  }
}

/** The owner for a hosted request; gives a new visitor their id on the way. */
export function hostedOwner(cfg: Config, req: FastifyRequest, reply: FastifyReply): Owner {
  const s = readSession(cfg, req)
  if (s) return `u:${s.sub}`
  const secure = cfg.PUBLIC_URL.startsWith('https://')
  let id = unsign(cfg.SESSION_SECRET!, cookies(req)[VISITOR])
  if (!id) {
    id = randomBytes(12).toString('base64url')
    setCookie(reply, VISITOR, sign(cfg.SESSION_SECRET!, id), 30 * DAY, secure)
  }
  return `a:${id}`
}

/** A one-way, salted fingerprint of the network a request came from, for per-network limits. */
export function networkKey(cfg: Config, ip: string): string {
  return createHash('sha256').update(`${cfg.SESSION_SECRET}|${ip}`).digest('base64url').slice(0, 16)
}

/* -------------------------------------------------------------------- limits */

/**
 * Counts one use of something today and says whether it's still within the limit. Atomic, so
 * two films started at once can't both squeeze under it.
 */
export async function consume(sql: Sql, key: string, limit: number): Promise<boolean> {
  const [row] = await sql<{ n: number }[]>`
    insert into usage (key, day, n) values (${key}, current_date, 1)
    on conflict (key, day) do update set n = usage.n + 1
    returning n`
  return (row?.n ?? 0) <= limit
}

/** Gives a use back when the thing it was counted for didn't happen. */
export async function refund(sql: Sql, key: string): Promise<void> {
  await sql`update usage set n = greatest(n - 1, 0) where key = ${key} and day = current_date`
}

export async function used(sql: Sql, key: string): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select n from usage where key = ${key} and day = current_date`
  return row?.n ?? 0
}

export const filmLimit = (cfg: Config, owner: Owner) =>
  owner.startsWith('u:') ? cfg.USER_DAILY_FILMS : cfg.ANON_DAILY_FILMS

/* ------------------------------------------------------------ GitHub sign-in */

export function githubStart(cfg: Config, reply: FastifyReply) {
  const state = randomBytes(16).toString('base64url')
  setCookie(reply, STATE, state, 600, cfg.PUBLIC_URL.startsWith('https://'))
  const u = new URL('https://github.com/login/oauth/authorize')
  u.searchParams.set('client_id', cfg.GITHUB_CLIENT_ID!)
  u.searchParams.set('redirect_uri', `${cfg.PUBLIC_URL.replace(/\/$/, '')}/auth/github/callback`)
  u.searchParams.set('scope', 'read:user')
  u.searchParams.set('state', state)
  u.searchParams.set('allow_signup', 'true')
  return reply.redirect(u.toString())
}

/**
 * Finishes GitHub sign-in: checks the state, swaps the code for the person's public profile,
 * and moves anything they made as a visitor onto their account.
 */
export async function githubCallback(
  cfg: Config,
  sql: Sql,
  req: FastifyRequest<{ Querystring: { code?: string; state?: string } }>,
  reply: FastifyReply,
  fetchImpl: typeof fetch = fetch,
): Promise<Session> {
  const { code, state } = req.query
  const expected = cookies(req)[STATE]
  if (!code || !state || !expected || state !== expected)
    throw Object.assign(new Error('sign-in expired or was started elsewhere; try again'), {
      statusCode: 400,
    })
  const tokenRes = await fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: cfg.GITHUB_CLIENT_ID,
      client_secret: cfg.GITHUB_CLIENT_SECRET,
      code,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const token = ((await tokenRes.json()) as { access_token?: string }).access_token
  if (!token)
    throw Object.assign(new Error('GitHub did not confirm the sign-in'), { statusCode: 502 })
  const userRes = await fetchImpl('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${token}`,
      'user-agent': 'coldopen',
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(10_000),
  })
  const gh = (await userRes.json()) as {
    id?: number
    login?: string
    name?: string
    avatar_url?: string
  }
  if (!gh.id || !gh.login)
    throw Object.assign(new Error('GitHub sign-in failed'), { statusCode: 502 })
  return finishSignIn(cfg, sql, req, reply, {
    sub: `gh:${gh.id}`,
    login: gh.login,
    name: gh.name ?? null,
    avatar: gh.avatar_url ?? null,
  })
}

/**
 * The end of any sign-in: the user row, what they made as a visitor moved onto the account,
 * and the session cookie.
 */
async function finishSignIn(
  cfg: Config,
  sql: Sql,
  req: FastifyRequest,
  reply: FastifyReply,
  who: Omit<Session, 'exp'>,
): Promise<Session> {
  await sql`
    insert into users (id, login, name, avatar) values (${who.sub}, ${who.login}, ${who.name}, ${who.avatar})
    on conflict (id) do update set login = excluded.login, name = excluded.name, avatar = excluded.avatar, seen_at = now()`

  // what they made before signing in is theirs now
  const visitor = unsign(cfg.SESSION_SECRET!, cookies(req)[VISITOR])
  if (visitor) await claim(sql, `a:${visitor}`, `u:${who.sub}`)

  const session: Session = { ...who, exp: Math.floor(Date.now() / 1000) + 30 * DAY }
  const secure = cfg.PUBLIC_URL.startsWith('https://')
  setCookie(
    reply,
    SESSION,
    sign(cfg.SESSION_SECRET!, b64(JSON.stringify(session))),
    30 * DAY,
    secure,
  )
  setCookie(reply, STATE, '', 0, secure)
  return session
}

export async function claim(sql: Sql, from: Owner, to: Owner) {
  await sql.begin(async (tx) => {
    await tx`update runs set owner = ${to} where owner = ${from}`
    // a profile with the same name on the account wins; the visitor's copy goes
    await tx`
      update profiles p set owner = ${to}
      where p.owner = ${from}
        and not exists (select 1 from profiles q where q.owner = ${to} and q.id = p.id)`
    await tx`delete from profiles where owner = ${from}`
    // a newer connections upload replaces the account's
    const [moved] = await tx`select 1 from connections where owner = ${from} limit 1`
    if (moved) {
      await tx`delete from connections where owner = ${to}`
      await tx`update connections set owner = ${to} where owner = ${from}`
    }
    // the job search and saved keys come along unless the account already has its own
    await tx`
      update job_searches set owner = ${to}
      where owner = ${from} and not exists (select 1 from job_searches where owner = ${to})`
    await tx`delete from job_searches where owner = ${from}`
    await tx`
      update owner_keys k set owner = ${to}
      where k.owner = ${from}
        and not exists (select 1 from owner_keys o where o.owner = ${to} and o.name = k.name)`
    await tx`delete from owner_keys where owner = ${from}`
  })
}

/* ------------------------------------------------------------ Google sign-in */

const googleRedirect = (cfg: Config) => `${cfg.PUBLIC_URL.replace(/\/$/, '')}/auth/google/callback`

export function googleStart(cfg: Config, reply: FastifyReply) {
  const state = randomBytes(16).toString('base64url')
  setCookie(reply, STATE, state, 600, cfg.PUBLIC_URL.startsWith('https://'))
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.searchParams.set('client_id', cfg.GOOGLE_CLIENT_ID!)
  u.searchParams.set('redirect_uri', googleRedirect(cfg))
  u.searchParams.set('response_type', 'code')
  // name, email and picture; nothing else from the Google account
  u.searchParams.set('scope', 'openid email profile')
  u.searchParams.set('state', state)
  u.searchParams.set('prompt', 'select_account')
  return reply.redirect(u.toString())
}

/** Finishes Google sign-in the same way as GitHub's: state, code for profile, then the session. */
export async function googleCallback(
  cfg: Config,
  sql: Sql,
  req: FastifyRequest<{ Querystring: { code?: string; state?: string } }>,
  reply: FastifyReply,
  fetchImpl: typeof fetch = fetch,
): Promise<Session> {
  const { code, state } = req.query
  const expected = cookies(req)[STATE]
  if (!code || !state || !expected || state !== expected)
    throw Object.assign(new Error('sign-in expired or was started elsewhere; try again'), {
      statusCode: 400,
    })
  const tokenRes = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      code,
      client_id: cfg.GOOGLE_CLIENT_ID!,
      client_secret: cfg.GOOGLE_CLIENT_SECRET!,
      redirect_uri: googleRedirect(cfg),
      grant_type: 'authorization_code',
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  })
  const token = ((await tokenRes.json()) as { access_token?: string }).access_token
  if (!token)
    throw Object.assign(new Error('Google did not confirm the sign-in'), { statusCode: 502 })
  const infoRes = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  })
  const g = (await infoRes.json()) as {
    sub?: string
    email?: string
    email_verified?: boolean
    name?: string
    picture?: string
  }
  if (!g.sub || !g.email || g.email_verified === false)
    throw Object.assign(new Error('Google sign-in failed'), { statusCode: 502 })
  return finishSignIn(cfg, sql, req, reply, {
    sub: `go:${g.sub}`,
    // the email is the login: what UNLIMITED_GITHUB_USERS can list for a Google account
    login: g.email.toLowerCase(),
    name: g.name ?? null,
    avatar: g.picture ?? null,
  })
}

export function signOut(cfg: Config, reply: FastifyReply) {
  const secure = cfg.PUBLIC_URL.startsWith('https://')
  setCookie(reply, SESSION, '', 0, secure)
  // a fresh visitor id, so the next person on this browser starts clean
  setCookie(reply, VISITOR, '', 0, secure)
}

/* ----------------------------------------------------------------- retention */

/** How long the hosted app keeps what people make: visitors 7 days, accounts 30. */
export const KEEP_DAYS = { visitor: 7, account: 30 } as const

/**
 * Deletes what the hosted app promised not to keep: a visitor's films, profiles and uploaded
 * connections after 7 days, an account's after 30, counted from when each was made (a profile
 * from its last edit). Accounts in UNLIMITED_GITHUB_USERS keep theirs until they delete it.
 * Films still being made are left alone. Share links expire on their own at the same age.
 */
export async function purgeExpired(sql: Sql, cfg: Config) {
  const keepers = cfg.UNLIMITED_GITHUB_USERS.length
    ? (
        await sql<{ owner: string }[]>`
          select 'u:' || id as owner from users where lower(login) = any(${cfg.UNLIMITED_GITHUB_USERS})`
      ).map((r) => r.owner)
    : []
  const rule = (col: string) => sql`(
      (owner like 'a:%' and ${sql(col)} < now() - make_interval(days => ${KEEP_DAYS.visitor}))
   or (owner like 'u:%' and ${sql(col)} < now() - make_interval(days => ${KEEP_DAYS.account})
       and not (owner = any(${keepers}))))`
  const runs = await sql`
    delete from runs where ${rule('created_at')} and status not in ('queued', 'running', 'waiting')`
  const profiles = await sql`delete from profiles where ${rule('updated_at')}`
  const connections = await sql`delete from connections where ${rule('added_at')}`
  // daily counters only matter for today's limits and the 90-day funnel
  await sql`delete from usage where day < current_date - 90`
  return { runs: runs.count, profiles: profiles.count, connections: connections.count }
}
