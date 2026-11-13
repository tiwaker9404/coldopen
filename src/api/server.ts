import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import fastifyStatic from '@fastify/static'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import Fastify, { type FastifyReply, type FastifyRequest, LogController } from 'fastify'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { z } from 'zod'
import { dayOf, isOn, pickToday } from '../autopilot/pick.ts'
import { runAutopilotOnce } from '../autopilot/run.ts'
import { AutopilotSchema, type AutopilotSettings, DEFAULT_SETTINGS } from '../autopilot/settings.ts'
import type { Config } from '../config.ts'
import type { Sql } from '../db/index.ts'
import { FilmInputSchema, type FilmResult } from '../film.ts'
import { newId } from '../ids.ts'
import { fitOf } from '../job/fit.ts'
import { semanticNow } from '../job/semantic.ts'
import { pastedTextProblem } from '../job/walled.ts'
import { type BoardSchema, type FetchFn, parseBoardLink } from '../jobs/boards.ts'
import { RAISED_COUNT, raisedByHost, raisedBySite, YC_BOARDS, ycOf } from '../jobs/companies.ts'
import { SearchSchema } from '../jobs/rank.ts'
import {
  boardsFor,
  cachedJobs,
  getSearch,
  hideJob,
  ignoreGap,
  MAX_OWN_BOARDS,
  markSeen,
  requirementsFor,
  saveSearch,
  suggestions,
  warmBoards,
} from '../jobs/service.ts'
import { allStartups, searchStartups, startupOf } from '../jobs/startups.ts'
import {
  reachedThisWeek,
  reuseTargets,
  type SavedTargets,
  type Target,
  hostOf as targetHost,
  targetRoles,
  targetsInSlices,
  WEEK_ZONE,
  WEEKLY_TARGET,
  weekStart,
} from '../jobs/targets.ts'
import type { LlmProvider } from '../llm/types.ts'
import type { Logger } from '../logger.ts'
import { registerQueueGauges, registry, watchEventLoop } from '../metrics.ts'
import { briefOf } from '../outreach/brief.ts'
import { checkMessage, touchContext } from '../outreach/checks.ts'
import {
  checkHunterKey,
  domainOf,
  type EmailFound,
  guesses,
  HunterError,
  hunterFind,
  hunterLeaders,
} from '../outreach/email.ts'
import {
  followedUp,
  nextStep,
  OUTREACH,
  type Outreach,
  type OutreachStatus,
  waitDaysFor,
  watchedFrom,
} from '../outreach/followup.ts'
import { type CrmState, checkHubSpot, HubSpotError, syncFilm } from '../outreach/hubspot.ts'
import {
  addressed,
  messagesFor,
  type Opener,
  openerFor,
  type SenderHomework,
} from '../outreach/messages.ts'
import {
  type Connection,
  companyKey,
  flatSearches,
  knownAt,
  parseConnections,
  peopleSearches,
} from '../outreach/people.ts'
import {
  conversationsThisMonth,
  draftTouch,
  isWarm,
  nextTouch,
  rolesFor,
  saidOf,
  TOUCH_KINDS,
  type Touch,
  type TouchKind,
  type WarmJob,
} from '../outreach/warm.ts'
import { type ModelMessages, messagesSchemaFor, writeMessages } from '../outreach/writer.ts'
import { draftProfile } from '../profile/draft.ts'
import { forSender, makerClaims, NOT_THE_MAKER } from '../profile/maker.ts'
import { parseResume } from '../profile/parse.ts'
import { hiringProfile, PitchError, recruiterProfile } from '../profile/pitch.ts'
import { resumeText } from '../profile/read.ts'
import { callModel } from '../runtime/context.ts'
import {
  cancelRun,
  createRun,
  getLog,
  getRun,
  getSteps,
  type Run,
  retryRun,
} from '../runtime/store.ts'
import { applyEdit, precheckEdit } from '../script/checks.ts'
import { type Review, reviewFilm } from '../script/review.ts'
import { ProfileSchema } from '../script/types.ts'
import { oneFilmViews, shareViews, unshare } from '../share/client.ts'
import { attachment } from '../share/download.ts'
import { gifEmbed } from '../share/embed.ts'
import { sharePage, viewFromRun } from '../share/page.ts'
import { filmViews, NO_VIEWS, pgViewStore, viewSummaries } from '../share/pg.ts'
import { recordBeacon, type ViewSummary } from '../share/views.ts'
import { type SlackClient, urlFromMention, verifySlackSignature } from '../slack.ts'
import { registerHttpTracing } from '../tracing.ts'
import {
  consume,
  filmLimit,
  githubCallback,
  githubStart,
  googleCallback,
  googleStart,
  hostedOwner,
  networkKey,
  type Owner,
  purgeExpired,
  readSession,
  refund,
  signOut,
  used,
} from './accounts.ts'
import { renderDispatcher } from './dispatch.ts'
import { humanize } from './errors.ts'
import { deleteKey, listKeys, readKey, saveKey } from './keys.ts'
import { registerMcp } from './mcp.ts'
import { privacyPage } from './privacy.ts'
import { registerSecurity } from './security.ts'
import { deleteToken, listTokens, makeToken, TOKEN_PREFIX, tokenOwner } from './tokens.ts'

const FILE_NAMES =
  /^(film-(square|landscape|portrait)\.mp4|poster\.jpg|preview\.gif|contact-sheet\.jpg|site\.jpg|kit\.json|storyboard\.json|scene-[0-5]\.jpg)$/
// scene stills are frames of a film anyone with the link can already watch
const PUBLIC_FILES =
  /^(film-(square|landscape|portrait)\.mp4|poster\.jpg|preview\.gif|contact-sheet\.jpg|scene-[0-5]\.jpg)$/
const RunId = z.string().regex(/^run_[0-9A-Z]{26}$/, 'not a film id')

export { OUTREACH, type OutreachStatus } from '../outreach/followup.ts'

/** who a film went to, as the sender saved it */
const RecipientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200).optional(),
  /** their LinkedIn profile */
  url: z.string().url().max(400).optional(),
})
type Recipient = z.infer<typeof RecipientSchema>

/** something small the sender built with the company's product: a link and one line on it */
const BuiltSchema = z.object({
  url: z
    .string()
    .trim()
    .regex(/^https:\/\/\S{4,300}$/, 'the link to what you built with it starts with https://'),
  line: z.string().trim().min(3).max(120),
})
type Built = z.infer<typeof BuiltSchema>

/** a film's homework, as the sender saved it: what the messages are drafted from */
const homeworkOf = (r: FilmRow): SenderHomework => ({
  detail: r.detail ?? null,
  question: r.question ?? null,
  built: r.built ?? null,
})

/** who made the film: a job seeker, a seller, a recruiter or a hiring team */
const presetOf = (r: FilmRow) => (r.output?.profile ?? r.input.profile).preset
/** a job seeker's film gets one follow-up, a seller's two */
const waitsOf = (r: FilmRow) => waitDaysFor(presetOf(r))

interface FilmRow extends Run {
  /** what's been synced to the sender's HubSpot */
  crm?: CrmState | null
  /** the sender's one detail from using the company's product, in their words */
  detail?: string | null
  /** the sender's own question for the company's people */
  question?: string | null
  /** something small the sender built with their product */
  built?: Built | null
  input: z.infer<typeof FilmInputSchema>
  output: FilmResult | null
  outreach?: Outreach | null
  recipient?: Recipient | null
}

function filmDto(r: FilmRow, publicUrl: string, views?: ViewSummary, viewsLoaded = true) {
  const out = r.output
  // on the hosted app, finished films live on the share worker and outlive restarts
  const base = out?.shared ? out.shared.link : `/v1/films/${r.id}/files`
  return {
    id: r.id,
    status: r.status,
    url: r.input.url,
    format: r.input.format,
    batch: r.input.batch ?? null,
    ref: r.input.ref ?? null,
    sender: r.input.profile.sender.name,
    /** Pitch a role: a recruiter's film for one candidate */
    pitch:
      r.input.profile.preset === 'recruiter' && r.input.profile.recipient
        ? { candidate: r.input.profile.recipient.name }
        : r.input.profile.preset === 'hiring'
          ? { hiring: true }
          : null,
    progress: r.status === 'running' || r.status === 'queued' ? r.progress : null,
    attempts: r.attempts,
    error: r.error,
    errorCode: r.errorCode,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    company: out?.company ?? null,
    host: out?.host ?? null,
    durationSec: out?.durationSec ?? null,
    files: out
      ? {
          film: `${base}/${out.files.film.split('/').pop()}`,
          poster: `${base}/poster.jpg`,
          gif: `${base}/preview.gif`,
          sheet: `${base}/contact-sheet.jpg`,
        }
      : null,
    share: out ? (out.shared?.link ?? `${publicUrl.replace(/\/$/, '')}/f/${r.id}`) : null,
    /** the job post this film answers */
    job:
      out?.job ??
      (r.input.job ? { title: r.input.job.title ?? null, url: r.input.job.url ?? null } : null),
    /** what people did on the share page; null until the film is finished */
    views: out ? (views ?? NO_VIEWS) : null,
    /** false when the share worker didn't answer in time: the counts above are blanks */
    viewsLoaded: !out || viewsLoaded,
    /** what happened after it was sent, as the sender marked it, and what to do next */
    outreach: r.outreach
      ? {
          ...r.outreach,
          next: nextStep(r.outreach, Date.now(), watchedFrom(views), waitsOf(r)),
        }
      : null,
    /** who it's going to (or went to), when the sender said */
    recipient: r.recipient ?? null,
    /** the sender's one detail from using their product */
    detail: r.detail ?? null,
    /** the sender's own question for them */
    question: r.question ?? null,
    /** something small the sender built with their product */
    built: r.built ?? null,
    /** synced to the sender's HubSpot: when, and the error if the last try failed */
    crm: r.crm
      ? { syncedAt: r.crm.syncedAt, error: r.crm.error ?? null, noted: r.crm.noted }
      : null,
    /** the first film, when this one re-renders it with an edited script */
    editOf: r.input.editOf ?? null,
  }
}

/** a film's scene stills: where its media lives, and this server's copy to fall back on */
function stillsOf(r: FilmRow): { scenes: string[] | null; scenesOnDisk: string[] | null } {
  const names = r.output?.files.scenes?.map((f) => f.split('/').pop()!)
  if (!names) return { scenes: null, scenesOnDisk: null }
  const disk = names.map((n) => `/f/${r.id}/${n}`)
  const shared = r.output?.shared?.link
  return { scenes: shared ? names.map((n) => `${shared}/${n}`) : disk, scenesOnDisk: disk }
}

function digest(s: string) {
  return createHash('sha256').update(s).digest()
}

export interface ApiDeps {
  sql: Sql
  cfg: Config
  log: Logger
  slack: SlackClient | null
  /** writes résumé-based profile drafts; null uses the deterministic drafter */
  llm?: LlmProvider | null
  /** for tests: how job boards are fetched (default: the real public APIs) */
  jobsFetch?: FetchFn
  /** for tests: how Hunter is called (default: its real API) */
  hunterFetch?: FetchFn
  /** for tests: how sign-in providers are called (default: their real APIs) */
  authFetch?: typeof fetch
  /** for tests: how HubSpot is called (default: its real API) */
  crmFetch?: FetchFn
}

export async function buildApi({
  sql,
  cfg,
  log,
  slack,
  llm = null,
  jobsFetch,
  hunterFetch = fetch,
  authFetch,
  crmFetch = fetch,
}: ApiDeps) {
  const filmsDir = resolve(cfg.FILMS_DIR)
  /** a film's file, or null if the id or name would point outside the films folder */
  const filmFile = (id: string, name: string): string | null => {
    const path = resolve(filmsDir, id, name)
    return path.startsWith(filmsDir + sep) ? path : null
  }
  const publicUrl = cfg.PUBLIC_URL
  const share =
    cfg.SHARE_URL && cfg.SHARE_TOKEN
      ? { url: cfg.SHARE_URL.replace(/\/$/, ''), token: cfg.SHARE_TOKEN }
      : null
  const kick = renderDispatcher(cfg, log, async () => {
    const [r] = await sql<{ n: number }[]>`
      select count(*)::int as n from runs
      where agent = 'film' and status in ('queued', 'running')`
    return r?.n ?? 1
  })
  const app = Fastify({
    loggerInstance: log,
    logController: new LogController({
      disableRequestLogging: (req) =>
        !['debug', 'trace'].includes(cfg.LOG_LEVEL) || req.url.startsWith('/healthz'),
    }),
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>()
  // first, and from memory: Render restarts the app when this takes over 5 seconds, so it
  // never waits on the database or another service (/readyz checks the database)
  app.get('/healthz', { schema: { hide: true } }, async () => ({ ok: true }))
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  // before any route, so every handler runs inside its request's span
  registerHttpTracing(app as never)
  // headers, the cross-site check and rate limits, also before any route
  await registerSecurity(app as never, {
    publicUrl: cfg.PUBLIC_URL,
    perMinute: Number(process.env.RATE_LIMIT_PER_MINUTE ?? 600),
  })

  // keep the raw body for Slack signature verification
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    ;(req as unknown as { rawBody: string }).rawBody = body as string
    try {
      done(null, body ? JSON.parse(body as string) : {})
    } catch (err) {
      ;(err as { statusCode?: number }).statusCode = 400
      done(err as Error, undefined)
    }
  })

  app.setErrorHandler(
    (
      err: Error & { statusCode?: number; validation?: unknown; validationContext?: string },
      _req,
      reply,
    ) => {
      const status = err.statusCode ?? 500
      if (status >= 500) app.log.error({ err }, 'request failed')
      // validation: plain sentences plus one per field, never Zod's own wording
      if (err.validation) {
        const { message, fields } = humanize(err.validation, err.validationContext)
        return reply.status(400).send({ error: { code: 'invalid_request', message, fields } })
      }
      reply.status(status).send({
        error: {
          code: status === 429 ? 'rate_limited' : status >= 500 ? 'internal' : 'bad_request',
          message:
            status >= 500
              ? 'internal error'
              : err instanceof SyntaxError
                ? "That request wasn't valid JSON."
                : err.message,
        },
      })
    },
  )

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'coldopen',
        version: '1.0.0',
        description: 'Turn a company website into a personalized, on-brand 30-second film.',
      },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  })
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' })
  await app.register(fastifyStatic, { root: filmsDir, serve: false })
  registerQueueGauges(sql)

  /* ------------------------------------------------------------------- ops */
  // what's in flight, so a blocked event loop is logged with the route that held it
  const inFlight = new Map<string, { route: string; at: number }>()
  app.addHook('onRequest', async (req) => {
    if (req.url !== '/healthz')
      inFlight.set(req.id, {
        route: `${req.method} ${req.routeOptions.url ?? req.url}`,
        at: Date.now(),
      })
  })
  app.addHook('onResponse', async (req) => {
    inFlight.delete(req.id)
  })
  const stopWatch = watchEventLoop({
    log: app.log,
    inFlight: () => {
      const now = Date.now()
      for (const [id, r] of inFlight) if (now - r.at > 10 * 60_000) inFlight.delete(id)
      return [...new Set([...inFlight.values()].map((r) => r.route))]
    },
  })
  app.addHook('onClose', async () => stopWatch())
  // the web app's bundled Archivo, so /privacy matches the app (its name carries a build hash)
  const appFont = (() => {
    try {
      const dir = join(import.meta.dirname, '../../dashboard/dist/assets')
      const f = readdirSync(dir).find((n) => /^archivo-latin-wdth-normal-.*\.woff2$/.test(n))
      return f ? `/assets/${f}` : null
    } catch {
      return null
    }
  })()
  app.get('/privacy', { schema: { hide: true } }, async (_req, reply) =>
    reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'public, max-age=3600')
      .send(
        privacyPage({
          ...(appFont ? { font: appFont } : {}),
          ...(cfg.CONTACT_EMAIL ? { contact: cfg.CONTACT_EMAIL } : {}),
          repo: 'https://github.com/tiwaker9404/coldopen',
          updated: 'November 1, 2026',
        }),
      ),
  )
  app.get('/readyz', { schema: { hide: true } }, async (_r, reply) => {
    try {
      await sql`select 1`
      return { ok: true }
    } catch {
      return reply.status(503).send({ ok: false })
    }
  })
  app.get('/metrics', { schema: { hide: true } }, async (req, reply) => {
    // on the hosted app, only for an API key holder (a scraper): the queue isn't public
    if (cfg.HOSTED) {
      const h = req.headers.authorization ?? ''
      const t = h.startsWith('Bearer ') ? h.slice(7) : ''
      if (!t || !cfg.API_KEYS.map(digest).some((k) => timingSafeEqual(k, digest(t))))
        return reply
          .status(401)
          .send({ error: { code: 'unauthorized', message: 'API key needed' } })
    }
    reply.header('content-type', registry.contentType)
    return registry.metrics()
  })

  /* ------------------------------------------------------------------ auth */
  // A private install: API keys (or nothing, locally), one owner. The hosted app: an API key is
  // the operator; everyone else is a signed-in GitHub user or a visitor trying it out.
  const keys = cfg.API_KEYS.map(digest)
  if (keys.length === 0 && !cfg.HOSTED)
    app.log.warn('API_KEYS is empty: the API is UNAUTHENTICATED (local mode)')
  app.decorateRequest('owner', 'team')
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/v1/')) return
    // the hosted app's totals are public: the landing page's counter reads them, signed out
    if (cfg.HOSTED && req.method === 'GET' && req.url.split('?')[0] === '/v1/stats') return
    const h = req.headers.authorization ?? ''
    const token = h.startsWith('Bearer ') ? h.slice(7) : ''
    const keyOk = !!token && keys.some((k) => timingSafeEqual(k, digest(token)))
    if (keyOk) {
      req.owner = 'team'
      return
    }
    // a personal access token acts as the person who made it
    if (token.startsWith(TOKEN_PREFIX)) {
      const owner = await tokenOwner(sql, token)
      if (!owner)
        return reply.status(401).send({
          error: { code: 'unauthorized', message: 'that access token was deleted or is wrong' },
        })
      req.owner = owner as Owner
      return
    }
    if (cfg.HOSTED) {
      req.owner = hostedOwner(cfg, req, reply)
      return
    }
    if (keys.length === 0) return
    return reply
      .status(401)
      .send({ error: { code: 'unauthorized', message: 'missing or invalid API key' } })
  })
  // coldopen as an MCP server, for Claude, Cursor and other MCP clients
  registerMcp(app as never, sql, (t) => !!t && keys.some((k) => timingSafeEqual(k, digest(t))))
  const notFound = (reply: FastifyReply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'film not found' } })
  /** a film the asker owns, or undefined */
  const ownFilm = async (id: string, owner: Owner) => {
    const run = (await getRun(sql, id)) as FilmRow | undefined
    return run?.agent === 'film' && (run.owner ?? 'team') === owner ? run : undefined
  }
  const limited = (reply: FastifyReply, message: string) =>
    reply.status(429).send({ error: { code: 'daily_limit', message } })

  /**
   * A finished film's review: every scene with what a founder would find odd and its fix.
   * Reads the sender's 10 films before it, to spot built-in lines they all share.
   */
  const reviewOf = async (run: FilmRow): Promise<Review | null> => {
    const o = run.output
    if (run.status !== 'succeeded' || !o?.script) return null
    const recent = await sql<
      {
        company: string | null
        script: FilmResult['script'] | null
        scriptMeta: FilmResult['scriptMeta'] | null
      }[]
    >`
      select output->>'company' as company, output->'script' as script,
        output->'scriptMeta' as script_meta
      from runs
      where agent = 'film' and coalesce(owner, 'team') = ${run.owner ?? 'team'}
        and status = 'succeeded'
        and id < ${run.id} and output ? 'script'
      order by id desc limit 10`
    return reviewFilm(
      {
        company: o.company,
        profile: o.profile ?? run.input.profile,
        script: o.script,
        scriptMeta: o.scriptMeta,
        qa: o.qa,
        highlights: o.highlights ?? null,
        ...(run.input.proof ? { proof: run.input.proof } : {}),
        brand: o.brand ?? null,
        facts: o.facts ?? null,
        ...(run.input.wordmark ? { wordmark: true } : {}),
      },
      recent
        .filter((r) => r.script && r.company)
        .map((r) => ({ company: r.company!, script: r.script!, scriptMeta: r.scriptMeta })),
    )
  }

  /**
   * Takes n films from today's allowances: the person's, their network's (so clearing cookies
   * doesn't reset it) and the whole app's (which keeps the free model tier from running dry).
   * Returns why not, or null; nothing is taken when the answer is no.
   */
  /** no daily limits: a private install, an API key, or a GitHub user listed in UNLIMITED_GITHUB_USERS */
  const unlimited = (req: FastifyRequest) => {
    if (!cfg.HOSTED || req.owner === 'team') return true
    const login = readSession(cfg, req)?.login.toLowerCase()
    return !!login && cfg.UNLIMITED_GITHUB_USERS.includes(login)
  }

  /**
   * coldopen's maker: whoever runs this install (a private install or its API key) or, on the
   * hosted app, an account in UNLIMITED_GITHUB_USERS. Only they can say on a film that they
   * built coldopen.
   */
  const maker = unlimited

  async function takeFilms(req: FastifyRequest, n: number): Promise<string | null> {
    const checks: [string, number, string][] = [
      [
        `films:${req.owner}`,
        filmLimit(cfg, req.owner),
        req.owner.startsWith('u:')
          ? `That's your ${cfg.USER_DAILY_FILMS} films for today. Come back tomorrow for more.`
          : `That's your free film for today. Sign in with GitHub to make ${cfg.USER_DAILY_FILMS} a day.`,
      ],
      [
        `net:${networkKey(cfg, req.ip)}`,
        cfg.IP_DAILY_FILMS,
        'This network has made a lot of films today. Try again tomorrow.',
      ],
      [
        'global',
        cfg.GLOBAL_DAILY_FILMS,
        'coldopen has made all the films it can today. Try again tomorrow, or run it yourself for free (it is open source).',
      ],
    ]
    const taken: string[] = []
    for (const [key, limit, why] of checks) {
      let ok = true
      for (let i = 0; i < n; i++) {
        taken.push(key)
        if (!(await consume(sql, key, limit))) ok = false
      }
      if (!ok) {
        for (const k of taken) await refund(sql, k)
        return why
      }
    }
    return null
  }

  // after the share worker fails to answer, pages stop asking it for half a minute, so each
  // one shows views as not loaded at once instead of waiting out the timeout again
  const SHARE_QUIET_MS = 30_000
  let shareQuietUntil = 0
  /**
   * View counts: from the share worker when films are published there, else from Postgres.
   * `unloaded` holds the films whose views the share worker didn't give in time (a few
   * seconds): the page shows those as not loaded rather than waiting or failing.
   */
  async function viewsFor(
    runs: FilmRow[],
  ): Promise<{ views: Map<string, ViewSummary>; unloaded: Set<string> }> {
    const shared = runs.filter((r) => r.output?.shared)
    const local = runs.filter((r) => !r.output?.shared).map((r) => r.id)
    const views = await viewSummaries(sql, local)
    const unloaded = new Set<string>()
    if (shared.length && share && Date.now() < shareQuietUntil) {
      for (const r of shared) unloaded.add(r.id)
    } else if (shared.length && share) {
      try {
        const remote = await shareViews(
          share,
          shared.map((r) => r.output!.shared!.id),
        )
        for (const r of shared) {
          const v = remote.get(r.output!.shared!.id)
          if (v) views.set(r.id, v)
        }
      } catch (err) {
        app.log.warn({ err }, 'could not read views from the share worker')
        shareQuietUntil = Date.now() + SHARE_QUIET_MS
        for (const r of shared) unloaded.add(r.id)
      }
    }
    return { views, unloaded }
  }
  const summariesFor = async (runs: FilmRow[]) => (await viewsFor(runs)).views
  /** on the hosted app, a visitor's share links last 7 days and an account's 30 */
  // visitors' films are kept 7 days and accounts' 30; unlimited users' until they delete them
  const keep = (req: FastifyRequest) =>
    unlimited(req) ? {} : { keepDays: req.owner.startsWith('u:') ? 30 : 7 }
  const unshareFilm = (id: string) => (share ? unshare(share, id) : Promise.resolve())

  /* --------------------------------------------------------------- accounts */
  if (cfg.HOSTED) {
    app.get('/auth/github', { schema: { hide: true } }, async (_req, reply) => {
      if (!cfg.GITHUB_CLIENT_ID)
        return reply
          .status(404)
          .send({ error: { code: 'not_configured', message: 'sign-in is off' } })
      return githubStart(cfg, reply)
    })
    app.get(
      '/auth/github/callback',
      {
        schema: {
          hide: true,
          querystring: z.object({ code: z.string().optional(), state: z.string().optional() }),
        },
      },
      async (req, reply) => {
        try {
          await githubCallback(cfg, sql, req, reply, authFetch)
          return reply.redirect('/')
        } catch (err) {
          app.log.warn({ err }, 'github sign-in failed')
          return reply.redirect(`/?signin=${encodeURIComponent((err as Error).message)}`)
        }
      },
    )
    app.get('/auth/google', { schema: { hide: true } }, async (_req, reply) => {
      if (!cfg.GOOGLE_CLIENT_ID || !cfg.GOOGLE_CLIENT_SECRET)
        return reply
          .status(404)
          .send({ error: { code: 'not_configured', message: 'Google sign-in is off' } })
      return googleStart(cfg, reply)
    })
    app.get(
      '/auth/google/callback',
      {
        schema: {
          hide: true,
          querystring: z.object({
            code: z.string().optional(),
            state: z.string().optional(),
            error: z.string().optional(),
          }),
        },
      },
      async (req, reply) => {
        // they pressed Cancel on Google's page
        if (req.query.error) return reply.redirect('/')
        try {
          await googleCallback(cfg, sql, req, reply, authFetch)
          return reply.redirect('/')
        } catch (err) {
          app.log.warn({ err }, 'google sign-in failed')
          return reply.redirect(`/?signin=${encodeURIComponent((err as Error).message)}`)
        }
      },
    )
    app.post('/auth/logout', { schema: { hide: true } }, async (_req, reply) => {
      signOut(cfg, reply)
      return reply.status(204).send()
    })
  }

  app.get(
    '/v1/me',
    { schema: { tags: ['account'], summary: 'Who you are, and what you have left today' } },
    async (req) => {
      const s = cfg.HOSTED ? readSession(cfg, req) : null
      const free = unlimited(req)
      const limit = free ? null : filmLimit(cfg, req.owner)
      // one row per visitor per day, for the owner's funnel (ids are random, nothing personal)
      if (cfg.HOSTED && !free) await consume(sql, `visit:${req.owner}`, Number.MAX_SAFE_INTEGER)
      return {
        hosted: cfg.HOSTED,
        signIn: cfg.HOSTED && (!!cfg.GITHUB_CLIENT_ID || !!cfg.GOOGLE_CLIENT_ID),
        /** the ways to sign in, Google first: most people have a Google account */
        providers: cfg.HOSTED
          ? [
              ...(cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_SECRET ? ['google'] : []),
              ...(cfg.GITHUB_CLIENT_ID ? ['github'] : []),
            ]
          : [],
        user: s ? { login: s.login, name: s.name, avatar: s.avatar } : null,
        films: limit === null ? null : { used: await used(sql, `films:${req.owner}`), limit },
        // a visitor's work is kept 7 days; an account's, 30; an unlimited user's, until deleted
        keepsDays: free ? null : s ? 30 : 7,
        /** can see the app-wide funnel at GET /v1/funnel */
        stats: cfg.HOSTED && free,
        /** coldopen's maker: the only one the profile editor asks about building it */
        maker: maker(req),
        /** where feedback goes: the app's contact address, when it has one */
        ...(cfg.CONTACT_EMAIL ? { contact: cfg.CONTACT_EMAIL } : {}),
      }
    },
  )

  app.get(
    '/v1/funnel',
    {
      schema: {
        tags: ['account'],
        summary: "The hosted app's funnel: visitors, sign-ups, films, sent, watched, replied",
        description: 'For the owner (an API key or an UNLIMITED_GITHUB_USERS login).',
        querystring: z.object({ days: z.coerce.number().int().min(1).max(90).default(7) }),
      },
    },
    async (req, reply) => {
      if (!unlimited(req))
        return reply
          .status(403)
          .send({ error: { code: 'forbidden', message: 'only the owner can see stats' } })
      const days = req.query.days
      const since = sql`now() - make_interval(days => ${days})`
      const [[v], [u], [f], fails, sentRows] = await Promise.all([
        sql<{ n: number }[]>`
          select count(distinct key)::int as n from usage
          where key like 'visit:%' and day > current_date - ${days}::int`,
        sql<{ n: number }[]>`select count(*)::int as n from users where created_at > ${since}`,
        sql<{ makers: number; films: number; ok: number; failed: number; edits: number }[]>`
          select count(distinct owner)::int as makers, count(*)::int as films,
            count(*) filter (where status = 'succeeded')::int as ok,
            count(*) filter (where status = 'failed')::int as failed,
            count(*) filter (where input ? 'editOf')::int as edits
          from runs where agent = 'film' and created_at > ${since}`,
        sql<{ error: string; n: number }[]>`
          select left(coalesce(error, 'unknown'), 140) as error, count(*)::int as n from runs
          where agent = 'film' and status = 'failed' and created_at > ${since}
          group by 1 order by 2 desc limit 5`,
        sql<FilmRow[]>`
          select * from runs where agent = 'film' and outreach is not null
            and created_at > ${since} order by id desc limit 300`,
      ])
      const views = await summariesFor(sentRows)
      const st = (r: FilmRow) => r.outreach?.status
      return {
        days,
        visitors: v?.n ?? 0,
        signups: u?.n ?? 0,
        makers: f?.makers ?? 0,
        films: f?.films ?? 0,
        succeeded: f?.ok ?? 0,
        failed: f?.failed ?? 0,
        edits: f?.edits ?? 0,
        sent: sentRows.length,
        watched: sentRows.filter((r) => (views.get(r.id)?.plays ?? 0) > 0).length,
        replied: sentRows.filter((r) => st(r) === 'replied' || st(r) === 'interview').length,
        interviews: sentRows.filter((r) => st(r) === 'interview').length,
        failures: fails,
      }
    },
  )

  app.delete(
    '/v1/me',
    {
      schema: {
        tags: ['account'],
        summary: 'Delete everything you made: profiles, films, share links and their views',
      },
    },
    async (req, reply) => {
      if (req.owner === 'team')
        return reply
          .status(400)
          .send({ error: { code: 'bad_request', message: 'not on a private install' } })
      const films = await sql<{ id: string; output: FilmResult | null }[]>`
        select id, output from runs where owner = ${req.owner} and agent = 'film'`
      await Promise.all(
        films
          .filter((f) => f.output?.shared)
          .map((f) => unshareFilm(f.output!.shared!.id).catch(() => {})),
      )
      await sql`delete from runs where owner = ${req.owner}`
      await sql`delete from profiles where owner = ${req.owner}`
      await sql`delete from connections where owner = ${req.owner}`
      await sql`delete from job_searches where owner = ${req.owner}`
      await sql`delete from autopilot where owner = ${req.owner}`
      await sql`delete from autopilot_runs where owner = ${req.owner}`
      await sql`delete from owner_keys where owner = ${req.owner}`
      if (req.owner.startsWith('u:')) await sql`delete from users where id = ${req.owner.slice(2)}`
      signOut(cfg, reply)
      return { deleted: { films: films.length } }
    },
  )

  /* -------------------------------------------------------------- profiles */
  app.get(
    '/v1/profiles',
    { schema: { tags: ['profiles'], summary: 'List sender profiles' } },
    async (req) => {
      const rows = await sql<{ id: string; name: string; data: unknown; updatedAt: Date }[]>`
      select id, name, data, updated_at from profiles where owner = ${req.owner} order by updated_at desc`
      return { data: rows }
    },
  )

  app.put(
    '/v1/profiles/:id',
    {
      schema: {
        tags: ['profiles'],
        summary: 'Create or replace a sender profile',
        params: z.object({ id: z.string().regex(/^[a-z0-9-_]{1,40}$/) }),
        body: z.object({ name: z.string().min(1).max(80), data: ProfileSchema }),
      },
    },
    async (req, reply) => {
      // only coldopen's maker can save a profile that says he built it
      const claims = maker(req) ? [] : makerClaims(req.body.data)
      if (claims.length)
        return reply.status(422).send({
          error: {
            code: 'not_the_maker',
            message: NOT_THE_MAKER,
            fields: claims.map((path) => ({ path, message: NOT_THE_MAKER })),
          },
        })
      const [row] = await sql`
        insert into profiles (owner, id, name, data) values (${req.owner}, ${req.params.id}, ${req.body.name}, ${sql.json(req.body.data as never)})
        on conflict (owner, id) do update set name = excluded.name, data = excluded.data, updated_at = now()
        returning id, name, data, updated_at`
      // Autopilot films only from a job seeker's profile
      if (req.body.data.preset !== 'candidate')
        await sql`update autopilot set "on" = false, updated_at = now()
          where owner = ${req.owner} and profile_id = ${req.params.id}`
      return row
    },
  )

  app.delete(
    '/v1/profiles/:id',
    { schema: { tags: ['profiles'], params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      const rows =
        await sql`delete from profiles where owner = ${req.owner} and id = ${req.params.id} returning id`
      // Autopilot can't film from a profile that's gone: it stays off until they pick another
      if (rows.length)
        await sql`update autopilot set "on" = false, updated_at = now()
          where owner = ${req.owner} and profile_id = ${req.params.id}`
      return rows.length
        ? { deleted: true }
        : reply.status(404).send({ error: { code: 'not_found', message: 'no such profile' } })
    },
  )

  app.post(
    '/v1/profiles/draft',
    {
      bodyLimit: 12 * 1024 * 1024,
      schema: {
        tags: ['profiles'],
        summary: 'Draft a candidate profile from a résumé (not saved)',
        description:
          'Send the résumé as base64. Every proof number in the draft is checked against the résumé; anything the model cannot ground is dropped.',
        body: z.object({
          filename: z.string().min(1).max(200),
          data: z.string().min(10).describe('the résumé file, base64'),
          role: z.string().min(2).max(80),
          exclude: z.array(z.string().max(80)).max(10).default([]),
          contact: z.string().max(80).optional(),
        }),
      },
    },
    async (req, reply) => {
      if (!unlimited(req) && !(await consume(sql, `drafts:${req.owner}`, cfg.DAILY_DRAFTS)))
        return limited(
          reply,
          `That's ${cfg.DAILY_DRAFTS} résumé drafts today. Edit the profile by hand, or come back tomorrow.`,
        )
      try {
        const text = await resumeText(
          new Uint8Array(Buffer.from(req.body.data, 'base64')),
          req.body.filename,
        )
        const resume = parseResume(text, req.body.exclude)
        if (resume.unmatchedExcludes.length)
          throw new Error(
            `"${resume.unmatchedExcludes.join('", "')}" doesn't appear in your résumé, so nothing would be left out. Use the name exactly as the résumé writes it`,
          )
        const draft = await draftProfile({
          resume,
          role: req.body.role,
          exclude: req.body.exclude,
          llm,
          ...(req.body.contact ? { contact: req.body.contact } : {}),
        })
        // a draft never says they built coldopen unless they did
        return { ...draft, profile: forSender(draft.profile, maker(req)) }
      } catch (err) {
        return reply
          .status(422)
          .send({ error: { code: 'unreadable_resume', message: (err as Error).message } })
      }
    },
  )

  app.post(
    '/v1/pitch/profile',
    {
      schema: {
        tags: ['profiles'],
        summary:
          "Pitch a role: draft a recruiter's film profile from a candidate's profile text (not saved)",
        description:
          "Paste the candidate's LinkedIn profile or résumé as text. The film's proof is their own numbers, read from that text; nothing is invented. Send the returned profile with POST /v1/films and the job link as `url` (or the company website as `url` and the post as `job`).",
        body: z.object({
          /** leave out for a hiring film: the role announced to everyone, for a LinkedIn post */
          candidateText: z.string().min(80).max(30_000).optional(),
          candidateName: z.string().trim().max(80).optional(),
          role: z.string().trim().min(2).max(80).optional(),
          recruiter: z.object({
            name: z.string().trim().min(1).max(80),
            company: z.string().trim().max(80).optional(),
            contact: z.string().trim().min(3).max(80),
            book: z
              .string()
              .regex(/^https:\/\/\S{4,300}$/, 'a booking link starts with https://')
              .optional(),
          }),
        }),
      },
    },
    async (req, reply) => {
      try {
        const { candidateText, ...rest } = req.body
        return candidateText
          ? recruiterProfile({ ...rest, candidateText })
          : hiringProfile({ recruiter: rest.recruiter, ...(rest.role ? { role: rest.role } : {}) })
      } catch (err) {
        if (!(err instanceof PitchError)) throw err
        return reply
          .status(422)
          .send({ error: { code: 'unreadable_profile', message: err.message } })
      }
    },
  )

  /**
   * The profile a film is made with. Anyone but coldopen's maker gets it without a claim to
   * coldopen, so no film, share page or message of theirs says they built it.
   */
  async function resolveProfile(
    body: { profile?: unknown; profileId?: string | undefined },
    owner: Owner,
    isMaker: boolean,
  ) {
    return forSender(await savedProfile(body, owner), isMaker)
  }

  async function savedProfile(
    body: { profile?: unknown; profileId?: string | undefined },
    owner: Owner,
  ) {
    if (body.profile) return ProfileSchema.parse(body.profile)
    if (body.profileId) {
      const [p] = await sql<
        { data: unknown }[]
      >`select data from profiles where owner = ${owner} and id = ${body.profileId}`
      if (!p) throw Object.assign(new Error(`no profile "${body.profileId}"`), { statusCode: 404 })
      return ProfileSchema.parse(p.data)
    }
    const [first] = await sql<
      { data: unknown }[]
    >`select data from profiles where owner = ${owner} order by updated_at desc limit 1`
    if (!first)
      throw Object.assign(new Error('create a profile first (PUT /v1/profiles/:id)'), {
        statusCode: 422,
      })
    return ProfileSchema.parse(first.data)
  }

  const normalizeUrl = (u: string) =>
    /^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`

  /* --------------------------------------------------------- suggested jobs */
  /** their newest profile: its role starts a job search, and its record is what fits a job */
  const newestProfile = async (owner: Owner) => {
    const [p] = await sql<{ data: unknown }[]>`
      select data from profiles where owner = ${owner} order by updated_at desc limit 1`
    const parsed = p ? ProfileSchema.safeParse(p.data) : null
    return parsed?.success ? parsed.data : undefined
  }
  const profileRole = async (owner: Owner) => (await newestProfile(owner))?.sender.role
  const boardDto = (b: z.infer<typeof BoardSchema>) => ({
    ats: b.ats,
    token: b.token,
    name: b.name,
  })

  app.get(
    '/v1/jobs/search',
    { schema: { tags: ['jobs'], summary: 'What you are looking for, and the boards you added' } },
    async (req) => {
      const s = await getSearch(sql, req.owner, await profileRole(req.owner))
      return { ...s.search, boards: s.boards.map(boardDto), suggested: s.suggested }
    },
  )

  app.put(
    '/v1/jobs/search',
    {
      schema: {
        tags: ['jobs'],
        summary: 'Set the roles and places to suggest jobs for',
        description:
          'Boards are links to any Greenhouse, Lever or Ashby careers board (or one of its jobs), searched alongside the built-in companies.',
        body: SearchSchema.extend({
          boards: z.array(z.string().max(300)).max(MAX_OWN_BOARDS).default([]),
        }),
      },
    },
    async (req, reply) => {
      const { boards: links, ...search } = req.body
      const boards: z.infer<typeof BoardSchema>[] = []
      for (const link of links) {
        const b = parseBoardLink(link)
        if (!b)
          return reply.status(422).send({
            error: {
              code: 'bad_board',
              message: `"${link.slice(0, 80)}" isn't a Greenhouse, Lever or Ashby careers link`,
            },
          })
        if (!boards.some((x) => x.ats === b.ats && x.token.toLowerCase() === b.token.toLowerCase()))
          boards.push(b)
      }
      // keep the names they had for boards they already added
      const before = await getSearch(sql, req.owner, undefined)
      const named = boards.map(
        (b) =>
          before.boards.find(
            (o) => o.ats === b.ats && o.token.toLowerCase() === b.token.toLowerCase(),
          ) ?? b,
      )
      const s = SearchSchema.parse(search)
      await saveSearch(sql, req.owner, s, named)
      return { ...s, boards: named.map(boardDto), suggested: false }
    },
  )

  app.get(
    '/v1/jobs/suggested',
    {
      schema: {
        tags: ['jobs'],
        summary: 'Open roles that fit your search, best first',
        description:
          'Reads the public job boards of the built-in companies and any you added (cached for a few hours), and ranks their open roles against your roles and places. Each comes with the reasons it was picked, and the film you already made for it, if any.',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(60).default(24) }),
      },
    },
    async (req) => {
      const r = await suggestions(sql, req.owner, await newestProfile(req.owner), {
        limit: req.query.limit,
        ...(jobsFetch ? { fetch: jobsFetch } : {}),
        warm: () => warmScores(req.owner),
      })
      return {
        data: r.data.map(({ score: _s, board: _b, ...j }) => j),
        alerts: {
          ...r.alerts,
          filmed: r.alerts.filmed.map(({ score: _s, board: _b, ...j }) => j),
        },
        gaps: r.gaps,
        companies: r.companies,
        ycCompanies: YC_BOARDS.length,
        raisedCompanies: RAISED_COUNT,
        failed: r.failed,
        updatedAt: r.updatedAt,
        search: {
          ...r.search.search,
          boards: r.search.boards.map(boardDto),
          suggested: r.search.suggested,
        },
      }
    },
  )

  app.get(
    '/v1/startups',
    {
      schema: {
        tags: ['jobs'],
        summary: 'YC startups to reach out to, hiring or not',
        description:
          "Every active YC startup from YC's directory, newest batch first, for reaching founders before a role is posted. Each says whether it's hiring on YC and whether its open roles are in Jobs for you, and links its YC page (which names the founders).",
        querystring: z.object({
          q: z.string().trim().max(80).optional(),
          industry: z.string().trim().max(60).optional(),
          since: z.coerce.number().int().min(2005).max(2100).optional(),
          maxTeam: z.coerce.number().int().min(1).max(100_000).optional(),
          hiring: z.enum(['any', 'hiring', 'yc-only', 'quiet']).default('any'),
          us: z
            .enum(['true', 'false'])
            .default('true')
            .transform((v) => v === 'true'),
          limit: z.coerce.number().int().min(1).max(60).default(30),
          offset: z.coerce.number().int().min(0).max(10_000).default(0),
          /** newest batch first, or worth a warm message first (Network this week's score) */
          sort: z.enum(['newest', 'warm']).default('newest'),
        }),
      },
    },
    async (req) => {
      const { sort, ...query } = req.query
      const warm = sort === 'warm' ? await warmScores(req.owner) : null
      const r = searchStartups({ ...query, ...(warm ? { warm } : {}) })
      // the ones they already made a film for
      const hosts = r.data.flatMap((s) => {
        try {
          return s.website ? [new URL(s.website).hostname.replace(/^www\./, '')] : []
        } catch {
          return []
        }
      })
      const made = hosts.length
        ? await sql<{ id: string; host: string }[]>`
            select distinct on (output->>'host') id, output->>'host' as host from runs
            where agent = 'film' and owner = ${req.owner} and status = 'succeeded'
              and replace(output->>'host', 'www.', '') = any(${hosts})
            order by output->>'host', id desc`
        : []
      const film = new Map(made.map((m) => [m.host.replace(/^www\./, ''), m.id]))
      return {
        ...r,
        data: r.data.map((s) => {
          let id: string | undefined
          try {
            id = s.website ? film.get(new URL(s.website).hostname.replace(/^www\./, '')) : undefined
          } catch {}
          const why = warm?.reasons.get(targetHost(s.website))
          return { ...s, ...(id ? { filmId: id } : {}), ...(why ? { reasons: why } : {}) }
        }),
      }
    },
  )

  /* ------------------------------------------------------ network this week */
  /**
   * Each person's scored companies, kept for the day and recomputed as soon as anything they
   * depend on changes: their search, profile, connections, films (made, edited or marked sent)
   * or hidden companies. The fingerprint is read from the database, so every API process agrees.
   */
  const TARGETS = new Map<string, SavedTargets<Target[]>>()
  /** one of their profiles by id, when it's still there and still valid */
  const profileById = async (owner: Owner, id: string) => {
    const [p] = await sql<{ data: unknown }[]>`
      select data from profiles where owner = ${owner} and id = ${id}`
    const parsed = p ? ProfileSchema.safeParse(p.data) : null
    return parsed?.success ? parsed.data : undefined
  }
  /**
   * `profileId` scores from that profile (Autopilot's own) instead of the newest one, which
   * Network this week uses; each is cached apart.
   */
  const targetsFor = async (
    owner: Owner,
    profileId?: string,
  ): Promise<{ list: Target[]; roles: string[] }> => {
    const [f] = await sql<
      { films: string; conns: string; search: string; prof: string; hides: string }[]
    >`
      select
        (select count(*) || ':' || coalesce(max(updated_at)::text, '') || ':' || count(outreach)
           || ':' || coalesce(max(outreach->>'at'), '')
           from runs where agent = 'film' and owner = ${owner}) as films,
        (select count(*) || ':' || coalesce(max(added_at)::text, '')
           from connections where owner = ${owner}) as conns,
        (select coalesce(max(updated_at)::text, '') from job_searches where owner = ${owner}) as search,
        (select coalesce(max(updated_at)::text, '') from profiles where owner = ${owner}) as prof,
        (select count(*) || ':' || coalesce(max(created_at)::text, '')
           from target_hides where owner = ${owner}) as hides`
    const profile = profileId ? await profileById(owner, profileId) : await newestProfile(owner)
    const state = await getSearch(sql, owner, profile?.sender.role)
    const roles = targetRoles(state.search, profile)
    const startups = allStartups()
    // fit by meaning, when it's on: from what's embedded so far, never waiting on the model
    const sem = profile ? semanticNow() : null
    const meaning =
      sem && profile
        ? sem.known(profile, [...new Set(startups.flatMap((x) => (x.o ? [x.o] : [])))])
        : undefined
    const day = new Date().toISOString().slice(0, 10)
    const key = JSON.stringify([day, f, profileId ?? null])
    const known = meaning?.size ?? -1
    const slot = profileId ? `${owner}\u0000${profileId}` : owner
    const hit = TARGETS.get(slot)
    if (reuseTargets(hit, key, known, Date.now())) return { list: hit.list, roles }

    const [jobs, films, connections, hidden] = await Promise.all([
      cachedJobs(sql, boardsFor(state.boards)),
      sql<{ host: string | null; company: string | null; at: Date; sentAt: string | null }[]>`
        select coalesce(output->>'host', input->>'url') as host, output->>'company' as company,
          created_at as at, outreach->>'sentAt' as sent_at
        from runs where agent = 'film' and owner = ${owner} and status not in ('failed', 'cancelled')
          and (created_at > now() - interval '120 days' or outreach is not null)`,
      sql<{ name: string; company: string }[]>`
        select name, company from connections where owner = ${owner} limit 30000`,
      sql<{ host: string }[]>`select host from target_hides where owner = ${owner}`,
    ])
    const list = await targetsInSlices(
      {
        profile,
        search: state.search,
        jobs,
        startups,
        raised: raisedByHost(),
        connections,
        films: films.map((x) => ({ ...x, at: x.at.toISOString() })),
        hidden: hidden.map((h) => h.host),
        meaning,
      },
      Date.now(),
      500,
    )
    TARGETS.set(slot, { key, meaning: known, at: Date.now(), list })
    if (TARGETS.size > 500) TARGETS.delete(TARGETS.keys().next().value!)
    return { list, roles }
  }
  /** the same score, by website host, for the "Worth a warm message" sorts on Jobs and Startups */
  const warmScores = async (owner: Owner) => {
    const [{ list }, hidden] = await Promise.all([
      targetsFor(owner),
      sql<{ host: string }[]>`select host from target_hides where owner = ${owner}`,
    ])
    return {
      score: new Map(list.map((t) => [targetHost(t.site), t.score])),
      reasons: new Map(list.map((t) => [targetHost(t.site), t.reasons])),
      hidden: new Set(hidden.map((h) => h.host)),
    }
  }

  app.get(
    '/v1/targets',
    {
      schema: {
        tags: ['jobs'],
        summary: 'Network this week: the companies most worth a film and a warm message now',
        description:
          'Companies, not jobs, for the roles you want (your saved job search, then your profile role), whether or not they have an opening today. Scored on fit (what they do and the roles they post, against your skills and points), how reachable they are (small teams, people you know there) and timing (a round in the last 90 days, a matching role in the last 14, hiring fast). Each comes with its reasons, in plain words. Companies you filmed or messaged in the last 60 days, ones you hid and your current employer are left out. `week.made` counts the companies you reached this week, by a film made or a message marked sent, each company once, against the 10-a-week target. The week starts Monday 00:00 Pacific time.',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10) }),
      },
    },
    async (req) => {
      const { list, roles } = await targetsFor(req.owner)
      const now = Date.now()
      const from = weekStart(now)
      const week = await sql<
        { host: string | null; company: string | null; at: Date; sentAt: string | null }[]
      >`
        select coalesce(output->>'host', input->>'url') as host, output->>'company' as company,
          created_at as at, outreach->>'sentAt' as sent_at
        from runs where agent = 'film' and owner = ${req.owner}
          and status not in ('failed', 'cancelled')
          and (created_at >= ${from} or (outreach->>'sentAt')::timestamptz >= ${from})`
      const n = reachedThisWeek(
        week.map((f) => ({ ...f, at: f.at.toISOString() })),
        now,
      )
      return {
        data: list.slice(0, req.query.limit),
        week: { made: n, target: WEEKLY_TARGET },
        roles,
      }
    },
  )

  const SiteBody = z.object({ site: z.string().trim().min(3).max(300) })
  const siteHost = (site: string) => {
    const h = targetHost(site)
    return h.includes('.') ? h : ''
  }
  const badSite = (reply: FastifyReply) =>
    reply.status(422).send({
      error: { code: 'bad_site', message: "that doesn't look like a company website" },
    })

  app.post(
    '/v1/targets/hide',
    {
      schema: {
        tags: ['jobs'],
        summary: '"Not for me": keep a company off Network this week and the warm sorts',
        body: SiteBody,
      },
    },
    async (req, reply) => {
      const host = siteHost(req.body.site)
      if (!host) return badSite(reply)
      await sql`
        insert into target_hides (owner, host) values (${req.owner}, ${host})
        on conflict (owner, host) do nothing`
      return { hidden: host }
    },
  )

  app.post(
    '/v1/targets/unhide',
    {
      schema: { tags: ['jobs'], summary: 'Undo "Not for me" for a company', body: SiteBody },
    },
    async (req, reply) => {
      const host = siteHost(req.body.site)
      if (!host) return badSite(reply)
      await sql`delete from target_hides where owner = ${req.owner} and host = ${host}`
      return { shown: host }
    },
  )

  app.post(
    '/v1/jobs/preview',
    {
      schema: {
        tags: ['jobs'],
        summary: 'Open roles for a search, without saving it',
        description:
          'Takes the same fields as PUT /v1/jobs/search (all optional; what you leave out comes from your saved search) and returns ranked roles like /v1/jobs/suggested.',
        body: SearchSchema.partial(),
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(60).default(10) }),
      },
    },
    async (req) => {
      const profile = await newestProfile(req.owner)
      const saved = await getSearch(sql, req.owner, profile?.sender.role)
      const search = SearchSchema.parse({ ...saved.search, ...req.body })
      const r = await suggestions(sql, req.owner, profile, {
        limit: req.query.limit,
        search,
        ...(jobsFetch ? { fetch: jobsFetch } : {}),
      })
      return {
        data: r.data.map(({ score: _s, board: _b, ...j }) => j),
        companies: r.companies,
        search,
      }
    },
  )

  app.post(
    '/v1/jobs/seen',
    {
      schema: {
        tags: ['jobs'],
        summary: 'Mark your matches as seen: what is new is counted from now',
      },
    },
    async (req) => {
      await markSeen(sql, req.owner)
      return { seen: true }
    },
  )

  app.post(
    '/v1/jobs/gaps',
    {
      schema: {
        tags: ['jobs'],
        summary: 'Answer a fit gap: add the skill to your profile, or stop suggesting it',
        body: z.object({
          skill: z.string().trim().min(1).max(40),
          action: z.enum(['have', 'ignore']),
        }),
      },
    },
    async (req, reply) => {
      if (req.body.action === 'ignore') {
        await ignoreGap(sql, req.owner, req.body.skill)
        return { ignored: true }
      }
      const [p] = await sql<{ id: string; data: unknown }[]>`
        select id, data from profiles where owner = ${req.owner} order by updated_at desc limit 1`
      const parsed = p ? ProfileSchema.safeParse(p.data) : null
      if (!p || !parsed?.success)
        return reply
          .status(409)
          .send({ error: { code: 'no_profile', message: 'make a profile first' } })
      const have = parsed.data.skills ?? []
      if (!have.some((k) => k.toLowerCase() === req.body.skill.toLowerCase()))
        have.push(req.body.skill)
      const data = { ...parsed.data, skills: have.slice(-40) }
      await sql`update profiles set data = ${sql.json(data as never)}, updated_at = now()
        where owner = ${req.owner} and id = ${p.id}`
      return { profile: p.id, skills: data.skills }
    },
  )

  app.post(
    '/v1/jobs/:id/hide',
    {
      schema: {
        tags: ['jobs'],
        summary: 'Stop suggesting this job',
        params: z.object({ id: z.string().min(3).max(200) }),
      },
    },
    async (req) => {
      await hideJob(sql, req.owner, req.params.id)
      return { hidden: true }
    },
  )

  /* ----------------------------------------------------------------- films */
  const FilmBody = z.object({
    url: z.string().min(3),
    profileId: z.string().optional(),
    profile: ProfileSchema.optional(),
    format: z.enum(['square', 'landscape', 'portrait']).default('square'),
    ref: z.string().max(200).optional(),
    /** which proof items to show (indices into the profile's proof list) */
    proof: z.array(z.number().int().min(0)).min(1).max(3).optional(),
    /** answer a job post: its page URL, or its pasted text */
    job: z
      .object({
        url: z.string().url().optional(),
        text: z.string().min(40).max(30_000).optional(),
        title: z.string().max(120).optional(),
      })
      .refine((j) => j.url || j.text, 'job needs a url or the pasted text')
      .optional(),
  })

  app.post(
    '/v1/films',
    {
      schema: {
        tags: ['films'],
        summary: 'Make a film for one company',
        description:
          "Queues research, script, render and encode. Poll GET /v1/films/:id for progress. Send an Idempotency-Key header to make retries safe. Add `job` (a job post URL or its pasted text) and the film quotes one of its requirements and answers it with the sender's proof. LinkedIn, Indeed and Glassdoor posts need a login: send the company's website as `url` and the post as `job: { url, text }`, or the film is refused with 422 `job_needs_text` or `job_needs_site`.",
        body: FilmBody,
      },
    },
    async (req, reply) => {
      // a LinkedIn (or other login-walled) post would only fail in the worker: ask now
      const walled = pastedTextProblem(req.body)
      if (walled) return reply.status(422).send({ error: walled })
      const profile = await resolveProfile(req.body, req.owner, maker(req))
      const input = FilmInputSchema.parse({
        ...req.body,
        url: normalizeUrl(req.body.url),
        profile,
        ...keep(req),
      })
      const key = req.headers['idempotency-key']
      const quota = unlimited(req) ? null : await takeFilms(req, 1)
      if (quota) return limited(reply, quota)
      const r = await createRun(sql, {
        agent: 'film',
        input,
        idempotencyKey: typeof key === 'string' ? key : undefined,
        owner: req.owner,
      })
      if (r.kind === 'created') kick()
      if (r.kind === 'conflict') {
        return reply.status(409).send({
          error: {
            code: 'idempotency_conflict',
            message: 'that Idempotency-Key was used for a different film',
          },
        })
      }
      return reply
        .status(r.kind === 'created' ? 202 : 200)
        .send(filmDto(r.run as FilmRow, publicUrl))
    },
  )

  app.post(
    '/v1/batches',
    {
      schema: {
        tags: ['films'],
        summary: 'Make one film per prospect, or per job post',
        description:
          'Send `urls` (company websites) for one film each, or `jobs` (job post links, each with the company website when you know it) for one film per job post, each answering that post. LinkedIn, Indeed and Glassdoor posts need a login, so send their `text` and `site` too, or the batch is refused with 422 `job_needs_text` or `job_needs_site`.',
        body: z
          .object({
            urls: z.array(z.string().min(3)).min(1).max(1000).optional(),
            jobs: z
              .array(
                z.object({
                  /** the job post */
                  url: z.string().url(),
                  /** the company's own website; without it, the post's link to it is used */
                  site: z.string().url().optional(),
                  /** the post's pasted text, for links that need a login (LinkedIn) */
                  text: z.string().min(40).max(30_000).optional(),
                }),
              )
              .min(1)
              .max(25)
              .optional(),
            profileId: z.string().optional(),
            profile: ProfileSchema.optional(),
            format: z.enum(['square', 'landscape', 'portrait']).default('square'),
            proof: z.array(z.number().int().min(0)).min(1).max(3).optional(),
          })
          .refine((b) => !!b.urls !== !!b.jobs, 'send urls or jobs, not both'),
      },
    },
    async (req, reply) => {
      // check every link before queueing any, so a batch never half-starts
      for (const p of [
        ...(req.body.urls ?? []).map((url) => ({ url })),
        ...(req.body.jobs ?? []).map((j) => ({
          url: j.site ?? j.url,
          job: { url: j.url, ...(j.text ? { text: j.text } : {}) },
        })),
      ]) {
        const walled = pastedTextProblem(p)
        if (walled) return reply.status(422).send({ error: walled })
      }
      const profile = await resolveProfile(req.body, req.owner, maker(req))
      const batch = newId('bat')
      // one film per company website, or per job post (a job without a known site is filmed from
      // its link, which names the company)
      const items: { url: string; job?: { url: string; text?: string } }[] = req.body.jobs
        ? [...new Map(req.body.jobs.map((j) => [j.url, j])).values()].map((j) => ({
            url: j.site ?? j.url,
            ...(j.site ? { job: { url: j.url, ...(j.text ? { text: j.text } : {}) } } : {}),
          }))
        : [...new Set(req.body.urls!.map(normalizeUrl))].map((url) => ({ url }))
      if (!unlimited(req)) {
        if (!req.owner.startsWith('u:'))
          return reply
            .status(403)
            .send({ error: { code: 'sign_in', message: 'Sign in to make several films at once' } })
        const quota = await takeFilms(req, items.length)
        if (quota) return limited(reply, quota)
      }
      const created = await sql.begin(async (tx) => {
        const out = []
        for (const [i, item] of items.entries()) {
          const input = FilmInputSchema.parse({
            ...item,
            profile,
            format: req.body.format,
            ...(req.body.proof ? { proof: req.body.proof } : {}),
            batch,
            ref: String(i + 1),
            ...keep(req),
          })
          out.push(
            (await createRun(tx as unknown as Sql, { agent: 'film', input, owner: req.owner })).run,
          )
        }
        return out
      })
      kick()
      return reply
        .status(202)
        .send({ batch, films: created.length, results: `/v1/batches/${batch}/results.csv` })
    },
  )

  app.get(
    '/v1/films',
    {
      schema: {
        tags: ['films'],
        summary: 'List films, newest first',
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(200).default(60),
          before: z.string().optional(),
          batch: z.string().optional(),
        }),
      },
    },
    async (req) => {
      const rows = await sql<FilmRow[]>`
        select * from runs where agent = 'film' and owner = ${req.owner}
          ${req.query.before ? sql`and id < ${req.query.before}` : sql``}
          ${req.query.batch ? sql`and input->>'batch' = ${req.query.batch}` : sql``}
        order by id desc limit ${req.query.limit}`
      const { views, unloaded } = await viewsFor(rows.filter((r) => r.status === 'succeeded'))
      return {
        data: rows.map((r) => filmDto(r, publicUrl, views.get(r.id), !unloaded.has(r.id))),
        nextCursor: rows.length === req.query.limit ? rows.at(-1)!.id : null,
      }
    },
  )

  app.get(
    '/v1/films/:id',
    {
      schema: {
        tags: ['films'],
        summary: 'A film: status, script, journal and timeline',
        params: z.object({ id: RunId }),
      },
    },
    async (req, reply) => {
      const run = await ownFilm(req.params.id, req.owner)
      if (!run) return notFound(reply)
      const [steps, timeline, { views, unloaded }, review] = await Promise.all([
        getSteps(sql, run.id),
        getLog(sql, run.id),
        viewsFor([run]),
        reviewOf(run),
      ])
      return {
        ...filmDto(run, publicUrl, views.get(run.id), !unloaded.has(run.id)),
        script: run.output?.script ?? null,
        scriptMeta: run.output?.scriptMeta ?? null,
        /** the line quoted from their site or job post, and the proof shown */
        highlights: run.output?.highlights ?? null,
        homework: run.output?.homework ?? null,
        qa: run.output?.qa ?? null,
        /** each scene with what a founder would find odd and its fix; null until it's finished */
        review,
        /**
         * one still per scene, for the review's filmstrip (films made since the review): from
         * wherever the film's media lives (the share worker, on the hosted app), with this
         * server's disk as the fallback for films published before stills went with them
         */
        ...stillsOf(run),
        render: run.output?.render ?? null,
        steps: steps.map((s) => ({
          key: s.key,
          kind: s.kind,
          status: s.status,
          durationMs: s.durationMs,
          replays: s.replays,
          attempts: s.attempts,
          error: s.error,
        })),
        timeline,
        // the GIF wrapped in a link to the share page, copied as rich text for an email
        embed: run.output
          ? gifEmbed(
              run.output.shared?.link ?? `${publicUrl.replace(/\/$/, '')}/f/${run.id}`,
              run.output.company,
            )
          : null,
      }
    },
  )

  app.get(
    '/v1/films/:id/files/:name',
    {
      schema: {
        tags: ['films'],
        summary: 'Download a film file',
        params: z.object({ id: RunId, name: z.string() }),
      },
    },
    async (req, reply) => {
      if (!FILE_NAMES.test(req.params.name))
        return reply.status(404).send({ error: { code: 'not_found', message: 'unknown file' } })
      if (!(await ownFilm(req.params.id, req.owner))) return notFound(reply)
      if (!existsSync(filmFile(req.params.id, req.params.name) ?? '\0')) {
        return reply
          .status(404)
          .send({ error: { code: 'not_ready', message: 'file not rendered yet' } })
      }
      return reply.sendFile(`${req.params.id}/${req.params.name}`)
    },
  )

  app.get(
    '/v1/films/:id/review',
    {
      schema: {
        tags: ['films'],
        summary: 'Review a finished film scene by scene before sending it',
        description:
          'Each of the six scenes, with plain flags for anything a founder would find odd and the fix for each: `fact_out_of_context` (the quote leans on something not on screen; fix: another fact), `proof_unclear` (a result that doesn’t say what you did, what changed or where; fix: another proof), `no_logo` (fix: their name as the logo), `font_fallback`, `headline_cut`, `low_contrast`, `templated_line` (a built-in line 2 or more of your last 10 films share) and `job_words`. `ready` is true when nothing is flagged. Apply a fix with POST /v1/films/:id/edit.',
        params: z.object({ id: RunId }),
      },
    },
    async (req, reply) => {
      const run = await ownFilm(req.params.id, req.owner)
      if (!run) return notFound(reply)
      const review = await reviewOf(run)
      if (!review)
        return reply.status(409).send({
          error: { code: 'not_finished', message: 'only a finished film can be reviewed' },
        })
      return review
    },
  )

  app.post(
    '/v1/films/:id/retry',
    {
      schema: {
        tags: ['films'],
        summary: 'Resume a failed film from the step that failed',
        params: z.object({ id: RunId }),
      },
    },
    async (req, reply) => {
      if (!(await ownFilm(req.params.id, req.owner))) return notFound(reply)
      const r = await retryRun(sql, req.params.id)
      if (r) kick()
      return r
        ? filmDto(r as FilmRow, publicUrl)
        : reply.status(409).send({
            error: {
              code: 'not_retryable',
              message: 'only failed or cancelled films can be retried',
            },
          })
    },
  )

  app.post(
    '/v1/films/:id/edit',
    {
      schema: {
        tags: ['films'],
        summary: 'Re-render a film with lines you rewrote',
        description:
          "Makes a new film from the same company and profile with your wording. Lines you leave out stay as they were. Every number must still come from your profile or the company, and each line must fit on screen. The review's fixes come here too: `factId` quotes another of the film's facts (from GET /v1/films/:id/review), `proof` shows these results (indices into your profile's proof), and `wordmark` shows their name as the logo. Doesn't count against the daily limit; up to 5 edits per film.",
        params: z.object({ id: RunId }),
        body: z
          .object({
            hook: z.string().max(200),
            noticed: z.string().max(200),
            why: z.string().max(200),
            headline: z.string().max(200),
            points: z.array(z.string().max(200)).max(3),
            cta: z.string().max(200),
            factId: z.string().min(1).max(40),
            proof: z.array(z.number().int().min(0)).min(1).max(3),
            wordmark: z.literal(true),
          })
          .partial(),
      },
    },
    async (req, reply) => {
      const run = await ownFilm(req.params.id, req.owner)
      if (!run) return notFound(reply)
      if (run.status !== 'succeeded' || !run.output?.script)
        return reply
          .status(409)
          .send({ error: { code: 'not_finished', message: 'only a finished film can be edited' } })
      const o = run.output
      const { factId, proof, wordmark, ...lines } = req.body
      const fact = factId ? o.facts?.find((f) => f.id === factId) : undefined
      if (factId && !fact)
        return reply.status(422).send({
          error: { code: 'fact_unknown', message: "that fact isn't one this film can quote" },
        })
      const profileProof = (o.profile ?? run.input.profile).proof
      if (
        proof &&
        (new Set(proof).size !== proof.length || proof.some((i) => i >= profileProof.length))
      )
        return reply.status(422).send({
          error: {
            code: 'proof_unknown',
            message: `pick up to 3 different results from your profile (0 to ${profileProof.length - 1})`,
          },
        })
      const edited = applyEdit(o.script, lines)
      // the results stay the ones the film showed, unless the review swapped them
      const script = {
        ...edited,
        insight: { ...edited.insight, factId: fact?.id ?? edited.insight.factId },
        proof: proof ?? run.input.proof ?? edited.proof,
      }
      const known = [
        o.script.hook,
        o.script.noticed,
        o.script.insight.why,
        o.script.pitch.headline,
        ...o.script.pitch.points,
        o.script.cta,
        o.highlights?.quote.text ?? '',
      ].join(' ')
      const bad = precheckEdit(script, run.input.profile, known)
      if (bad.length)
        return reply
          .status(422)
          .send({ error: { code: 'edit_invalid', message: `${bad.join('. ')}.`, issues: bad } })
      const root = run.input.editOf ?? run.id
      const [edits] = await sql<{ n: number }[]>`
        select count(*)::int as n from runs
        where agent = 'film' and owner = ${req.owner} and input->>'editOf' = ${root}`
      if ((edits?.n ?? 0) >= 5)
        return limited(reply, 'That film has been edited 5 times. Make a new film to keep going.')
      const { proof: _picked, ...rest } = run.input
      const input = FilmInputSchema.parse({
        ...rest,
        script,
        editOf: root,
        ...(fact ? { fact: { id: fact.id, text: fact.text } } : {}),
        ...(wordmark ? { wordmark: true } : {}),
      })
      const r = await createRun(sql, { agent: 'film', input, owner: req.owner })
      kick()
      return reply.status(202).send(filmDto(r.run as FilmRow, publicUrl))
    },
  )

  app.put(
    '/v1/films/:id/outreach',
    {
      schema: {
        tags: ['films'],
        summary: 'Mark what happened after sending a film: sent, replied, interview, no reply',
        params: z.object({ id: RunId }),
        body: z.object({ status: z.enum(OUTREACH).nullable() }),
      },
    },
    async (req, reply) => {
      const run = await ownFilm(req.params.id, req.owner)
      if (!run) return notFound(reply)
      if (run.status !== 'succeeded')
        return reply
          .status(409)
          .send({ error: { code: 'not_finished', message: 'only a finished film can be sent' } })
      const now = new Date().toISOString()
      const prev = (run as FilmRow).outreach
      // follow-ups already sent stay on the record when the status changes
      const next: Outreach | null = req.body.status
        ? {
            ...(prev ?? {}),
            status: req.body.status,
            at: now,
            sentAt: prev?.sentAt ?? now,
            // the way its email opened when it went out, kept for the A/B (/v1/me/openers)
            ...(prev?.sentAt
              ? {}
              : { opener: openerFor(run.id, presetOf(run as FilmRow)) satisfies Opener }),
            // the first reply starts the warm-lead touches (warm.ts), and stays the same after
            ...(prev?.repliedAt
              ? { repliedAt: prev.repliedAt }
              : req.body.status === 'replied' || req.body.status === 'interview'
                ? { repliedAt: now }
                : {}),
          }
        : null
      const [r] = await sql<FilmRow[]>`
        update runs set outreach = ${next ? sql.json(next as never) : null}
        where id = ${req.params.id} returning *`
      void syncCrm(r!)
      return filmDto(r!, publicUrl)
    },
  )

  /* ---------------------------------------------------------------- sending */
  // keys are sealed with the server's secret; a private install without one uses its database URL
  const keySecret = cfg.SESSION_SECRET ?? cfg.DATABASE_URL

  /**
   * Brings the sender's HubSpot up to date for a film, when they saved a HubSpot token: the
   * company, the contact it went to, and a note for each step. Never fails the request it rides on.
   */
  const syncCrm = async (run: FilmRow): Promise<CrmState | null> => {
    if (!run.output || !run.outreach) return null
    const owner = run.owner ?? 'team'
    const token = await readKey(sql, keySecret, owner, 'hubspot')
    if (!token) return null
    const views = (await viewSummaries(sql, [run.id])).get(run.id)
    let state: CrmState
    try {
      state = await syncFilm(
        token,
        {
          company: run.output.company,
          domain: domainOf(run.output.host ?? run.input.url),
          share: filmDto(run, publicUrl).share!,
          role: run.output.job?.title ?? null,
          recipient: run.recipient ?? null,
          status: run.outreach.status,
          watched: (views?.plays ?? 0) > 0,
        },
        run.crm ?? null,
        crmFetch,
      )
    } catch (err) {
      state = {
        ...(run.crm ?? { noted: [] }),
        noted: run.crm?.noted ?? [],
        syncedAt: new Date().toISOString(),
        error: err instanceof HubSpotError ? err.message : 'HubSpot could not be reached',
      }
      log.warn({ err, film: run.id }, 'HubSpot sync failed')
    }
    await sql`update runs set crm = ${sql.json(state as never)} where id = ${run.id}`
    return state
  }
  app.put(
    '/v1/films/:id/recipient',
    {
      schema: {
        tags: ['films'],
        summary: 'Save who this film is going to',
        description:
          'Their name (and email or LinkedIn profile when known). The messages then greet them by name, and follow-ups open in Gmail already addressed. Send null to clear.',
        params: z.object({ id: RunId }),
        body: RecipientSchema.nullable(),
      },
    },
    async (req, reply) => {
      if (!(await ownFilm(req.params.id, req.owner))) return notFound(reply)
      const [r] = await sql<FilmRow[]>`
        update runs set recipient = ${req.body ? sql.json(req.body as never) : null}
        where id = ${req.params.id} returning *`
      void syncCrm(r!)
      return filmDto(r!, publicUrl)
    },
  )

  app.post(
    '/v1/films/:id/find-email',
    {
      schema: {
        tags: ['films'],
        summary: "Find someone's work email at the film's company",
        description:
          "With your Hunter key saved (PUT /v1/me/keys/hunter), Hunter looks it up; the likely patterns for the company's domain always come with it, as guesses. Nothing is sent.",
        params: z.object({ id: RunId }),
        body: z.object({ name: z.string().trim().min(2).max(120) }),
      },
    },
    async (req, reply) => {
      const run = await ownFilm(req.params.id, req.owner)
      if (!run?.output) return notFound(reply)
      const domain = domainOf(run.output.host ?? run.input.url)
      if (!domain)
        return reply
          .status(422)
          .send({ error: { code: 'no_domain', message: "couldn't tell the company's domain" } })
      const key = await readKey(sql, keySecret, req.owner, 'hunter')
      let found: EmailFound | null = null
      let note: string | null = null
      if (key) {
        try {
          found = await hunterFind(key, req.body.name, domain, hunterFetch)
          if (!found) note = "Hunter doesn't know this person's address."
        } catch (err) {
          note = err instanceof HunterError ? err.message : 'Hunter could not be reached'
        }
      }
      const guessed = guesses(req.body.name, domain).filter((g) => g.email !== found?.email)
      return { domain, found, guesses: guessed, hunter: !!key, note }
    },
  )

  app.post(
    '/v1/films/:id/founders',
    {
      schema: {
        tags: ['films'],
        summary: "The company's founders and executives, with their work emails",
        description:
          'One Hunter domain search with your saved Hunter key (PUT /v1/me/keys/hunter): founders, CEOs and CTOs first. Nothing is sent.',
        params: z.object({ id: RunId }),
      },
    },
    async (req, reply) => {
      const run = await ownFilm(req.params.id, req.owner)
      if (!run?.output) return notFound(reply)
      const domain = domainOf(run.output.host ?? run.input.url)
      if (!domain)
        return reply
          .status(422)
          .send({ error: { code: 'no_domain', message: "couldn't tell the company's domain" } })
      const key = await readKey(sql, keySecret, req.owner, 'hunter')
      if (!key)
        return reply.status(409).send({
          error: {
            code: 'no_hunter_key',
            message: 'Add your free Hunter key on your Profile page to look up founders’ emails',
          },
        })
      try {
        return { domain, people: await hunterLeaders(key, domain, hunterFetch) }
      } catch (err) {
        return reply.status(502).send({
          error: {
            code: 'hunter',
            message: err instanceof HunterError ? err.message : 'Hunter could not be reached',
          },
        })
      }
    },
  )

  /* --------------------------------------------------------- access tokens */
  const signedIn = (owner: Owner) => owner === 'team' || owner.startsWith('u:')
  app.get(
    '/v1/me/tokens',
    { schema: { tags: ['account'], summary: 'Your access tokens (for MCP clients and scripts)' } },
    async (req) => ({ data: signedIn(req.owner) ? await listTokens(sql, req.owner) : [] }),
  )
  app.post(
    '/v1/me/tokens',
    {
      schema: {
        tags: ['account'],
        summary: 'Make an access token: shown once',
        description:
          'For coldopen as an MCP server in Claude, Cursor or ChatGPT, or for scripts. It acts as you; delete it to stop it working.',
        body: z.object({ name: z.string().trim().min(1).max(60).default('MCP') }),
      },
    },
    async (req, reply) => {
      if (!signedIn(req.owner))
        return reply
          .status(403)
          .send({ error: { code: 'sign_in', message: 'sign in to make an access token' } })
      const [{ n } = { n: 0 }] = await sql<{ n: number }[]>`
        select count(*)::int as n from user_tokens where owner = ${req.owner}`
      if (n >= 10)
        return reply
          .status(409)
          .send({ error: { code: 'too_many', message: 'delete a token first: 10 is the most' } })
      return makeToken(sql, req.owner, req.body.name)
    },
  )
  app.delete(
    '/v1/me/tokens/:id',
    { schema: { tags: ['account'], params: z.object({ id: z.string().max(40) }) } },
    async (req, reply) =>
      (await deleteToken(sql, req.owner, req.params.id))
        ? { deleted: true }
        : reply.status(404).send({ error: { code: 'not_found', message: 'no such token' } }),
  )

  /* -------------------------------------------------------------- autopilot */
  /**
   * Autopilot's settings and today's pick. Signed-in job seekers only: it films from a job
   * seeker's profile, and a visitor's work is gone in a week. Nothing here makes a film.
   */
  type AutopilotRow = {
    on: boolean
    perDay: number
    days: number[]
    profileId: string | null
    format: AutopilotSettings['format']
    webhook: string | null
  }
  /** their job seeker profiles, newest first; null when they can't use Autopilot */
  const seekerProfiles = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!signedIn(req.owner)) {
      void reply
        .status(403)
        .send({ error: { code: 'sign_in', message: 'sign in to use Autopilot' } })
      return null
    }
    const rows = await sql<{ id: string; name: string; data: { preset?: string } }[]>`
      select id, name, data from profiles where owner = ${req.owner} order by updated_at desc`
    const seekers = rows.filter((p) => p.data?.preset === 'candidate')
    if (!seekers.length) {
      void reply.status(403).send({
        error: {
          code: 'job_seekers_only',
          message: 'Autopilot is for job seekers: save a job seeker profile first',
        },
      })
      return null
    }
    return seekers.map((p) => ({ id: p.id, name: p.name }))
  }
  const autopilotOf = async (owner: Owner): Promise<AutopilotSettings> => {
    const [row] = await sql<AutopilotRow[]>`
      select "on", per_day, days, profile_id, format, webhook from autopilot where owner = ${owner}`
    return row ? { ...row, days: [...row.days] } : DEFAULT_SETTINGS
  }
  const autopilotDto = (s: AutopilotSettings, profiles: { id: string; name: string }[]) => {
    // the profile it filmed from was deleted (or is no longer a job seeker's): it's off until
    // they pick another
    const profileGone = !!s.profileId && !profiles.some((p) => p.id === s.profileId)
    return {
      ...s,
      profiles,
      profileGone,
      ...(profileGone
        ? {
            note: 'Autopilot turned off because the profile it used was deleted. Pick another profile to turn it back on.',
          }
        : {}),
    }
  }

  app.get(
    '/v1/autopilot',
    {
      schema: {
        tags: ['autopilot'],
        summary: 'Your Autopilot settings: films a weekday, which days, profile, format, webhook',
        description:
          'Signed-in job seekers only. `profiles` lists the job seeker profiles it can film from; `profileGone` says the one it used was deleted, which turned it off. Days are ISO weekdays (Monday 1), Pacific time.',
      },
    },
    async (req, reply) => {
      const profiles = await seekerProfiles(req, reply)
      if (!profiles) return reply
      return autopilotDto(await autopilotOf(req.owner), profiles)
    },
  )

  app.put(
    '/v1/autopilot',
    {
      schema: {
        tags: ['autopilot'],
        summary: 'Turn Autopilot on or off, and choose how many films a weekday',
        description:
          'Films a weekday is 1 to 25. The webhook, when set, must be an https link on hooks.slack.com or discord.com/api/webhooks. Turning it on makes nothing straight away: the next daily run does.',
        body: AutopilotSchema,
      },
    },
    async (req, reply) => {
      const profiles = await seekerProfiles(req, reply)
      if (!profiles) return reply
      const b = req.body
      const bad = (message: string) =>
        reply.status(422).send({
          error: { code: 'bad_profile', message, fields: [{ path: 'profileId', message }] },
        })
      if (b.profileId && !profiles.some((p) => p.id === b.profileId))
        return bad('Pick one of your job seeker profiles')
      if (b.on && !b.profileId) return bad('Pick the profile Autopilot makes films from')
      await sql`
        insert into autopilot (owner, "on", per_day, days, profile_id, format, webhook)
        values (${req.owner}, ${b.on}, ${b.perDay}, ${b.days}::int[], ${b.profileId},
          ${b.format}, ${b.webhook})
        on conflict (owner) do update set "on" = excluded."on", per_day = excluded.per_day,
          days = excluded.days, profile_id = excluded.profile_id, format = excluded.format,
          webhook = excluded.webhook, updated_at = now()`
      return autopilotDto(await autopilotOf(req.owner), profiles)
    },
  )

  app.get(
    '/v1/autopilot/today',
    {
      schema: {
        tags: ['autopilot'],
        summary: "Today's pick: the companies Autopilot's films would be for, made or not",
        description:
          "Network this week's companies in order, skipping any with no website or already filmed by Autopilot today, up to films a weekday less the ones made today. Makes nothing. `runs` says whether Autopilot is on and today (Pacific) is one of its days.",
      },
    },
    async (req, reply) => {
      const profiles = await seekerProfiles(req, reply)
      if (!profiles) return reply
      const settings = await autopilotOf(req.owner)
      const gone = autopilotDto(settings, profiles).profileGone
      const now = Date.now()
      const day = dayOf(now)
      // the same cached, sliced scoring as /v1/targets, so this never holds the event loop,
      // scored from Autopilot's own profile (the newest job seeker profile until one is picked)
      const [{ list }, made] = await Promise.all([
        targetsFor(req.owner, settings.profileId && !gone ? settings.profileId : profiles[0]!.id),
        sql<{ host: string | null }[]>`
          select coalesce(output->>'host', input->>'url') as host from runs
          where agent = 'film' and owner = ${req.owner} and origin = 'autopilot'
            and status not in ('failed', 'cancelled')
            and (created_at at time zone ${WEEK_ZONE})::date = ${day.date}::date`,
      ])
      const madeToday = made.flatMap((m) => (m.host ? [m.host] : []))
      const { picks, skipped } = pickToday({ targets: list, settings, madeToday, now })
      return {
        day,
        runs: isOn(settings, now) && !gone,
        perDay: settings.perDay,
        madeToday: madeToday.length,
        picks,
        skipped,
      }
    },
  )

  app.get(
    '/v1/me/keys',
    {
      schema: {
        tags: ['account'],
        summary: 'Keys you saved for other services (last 4 characters only)',
      },
    },
    async (req) => listKeys(sql, req.owner),
  )

  app.put(
    '/v1/me/keys/hunter',
    {
      schema: {
        tags: ['account'],
        summary: 'Save your Hunter API key, to find emails',
        description:
          "Checked with Hunter first, then kept encrypted. It's only ever used for your own searches.",
        body: z.object({ key: z.string().trim().min(10).max(200) }),
      },
    },
    async (req, reply) => {
      try {
        const { left } = await checkHunterKey(req.body.key, hunterFetch)
        await saveKey(sql, keySecret, req.owner, 'hunter', req.body.key)
        return { saved: true, last4: req.body.key.slice(-4), searchesLeft: left }
      } catch (err) {
        const msg = err instanceof HunterError ? err.message : 'Hunter could not be reached'
        return reply.status(422).send({ error: { code: 'bad_key', message: msg } })
      }
    },
  )

  app.delete(
    '/v1/me/keys/hunter',
    { schema: { tags: ['account'], summary: 'Forget your Hunter key' } },
    async (req) => ({ deleted: await deleteKey(sql, req.owner, 'hunter') }),
  )

  app.put(
    '/v1/me/keys/hubspot',
    {
      schema: {
        tags: ['account'],
        summary: 'Save your HubSpot private app token, to sync films to your CRM',
        description:
          'A private app token with contacts and companies (read and write). Checked with HubSpot first, then kept encrypted. Films you mark sent are synced from then on.',
        body: z.object({ key: z.string().trim().min(10).max(300) }),
      },
    },
    async (req, reply) => {
      try {
        const { portal } = await checkHubSpot(req.body.key, crmFetch)
        await saveKey(sql, keySecret, req.owner, 'hubspot', req.body.key)
        return { saved: true, last4: req.body.key.slice(-4), portal }
      } catch (err) {
        const msg = err instanceof HubSpotError ? err.message : 'HubSpot could not be reached'
        return reply.status(422).send({ error: { code: 'bad_key', message: msg } })
      }
    },
  )

  app.delete(
    '/v1/me/keys/hubspot',
    { schema: { tags: ['account'], summary: 'Forget your HubSpot token' } },
    async (req) => ({ deleted: await deleteKey(sql, req.owner, 'hubspot') }),
  )

  app.post(
    '/v1/crm/sync',
    {
      schema: {
        tags: ['films'],
        summary: 'Sync every film you sent to HubSpot now',
        description:
          'Companies, the people they went to, and a note for each step (sent, watched, replied, interview). Usually automatic; this catches up films sent before you connected HubSpot.',
      },
    },
    async (req, reply) => {
      if (!(await readKey(sql, keySecret, req.owner, 'hubspot')))
        return reply.status(409).send({
          error: { code: 'no_hubspot', message: 'Save your HubSpot token on Profile first' },
        })
      const rows = await sql<FilmRow[]>`
        select * from runs where agent = 'film' and owner = ${req.owner} and status = 'succeeded'
          and outreach is not null
        order by id desc limit 200`
      let synced = 0
      let failed = 0
      for (const r of rows) {
        const s = await syncCrm(r)
        if (s?.error) failed++
        else if (s) synced++
      }
      return { synced, failed }
    },
  )

  /**
   * The morning run, called by .github/workflows/autopilot.yml every 3 minutes from 5am
   * Pacific on weekdays: one film per owner per call (src/autopilot/run.ts). Only the holder
   * of RENDER_DISPATCH_TOKEN, the token the app and GitHub Actions already share.
   */
  const dispatchToken = cfg.RENDER_DISPATCH_TOKEN ? digest(cfg.RENDER_DISPATCH_TOKEN) : null
  app.post('/internal/autopilot/run', { schema: { hide: true } }, async (req, reply) => {
    const h = req.headers.authorization ?? ''
    const t = h.startsWith('Bearer ') ? h.slice(7) : ''
    if (!dispatchToken || !t || !timingSafeEqual(dispatchToken, digest(t)))
      return reply
        .status(401)
        .send({ error: { code: 'unauthorized', message: 'the dispatch token is needed' } })
    return runAutopilotOnce(sql, cfg, Date.now(), {
      targets: async (owner, profileId) => (await targetsFor(owner, profileId)).list,
      kick,
    })
  })

  app.get(
    '/v1/me/openers',
    {
      schema: {
        tags: ['films'],
        summary:
          'Which email opener gets you more replies: your homework first or your question first (job seekers), the film first or your best number first (sellers)',
        description:
          "Half your films' drafts lead each way. A job seeker's email opens with their homework (homework) or their question for them (question); a seller's with the film (film) or their strongest number (proof). Each film counts under the opener it had when you marked it sent; films sent before that was kept count as film or proof. Counts films you marked sent in the last 180 days. `leader` is the winner of the pair you're sending now, once each side has 5 sends.",
      },
    },
    async (req) => {
      const rows = await sql<FilmRow[]>`
        select * from runs where agent = 'film' and owner = ${req.owner} and status = 'succeeded'
          and outreach is not null and created_at > now() - interval '180 days'
        order by id desc limit 500`
      const seen = await summariesFor(rows)
      const arm = () => ({ sent: 0, watched: 0, replied: 0 })
      const arms: Record<Opener, { sent: number; watched: number; replied: number }> = {
        homework: arm(),
        question: arm(),
        film: arm(),
        proof: arm(),
      }
      for (const r of rows) {
        // the opener stored when it was marked sent; a film sent before that was kept opened
        // the old way (the film or the number), whoever made it
        const opener = r.outreach?.opener ?? openerFor(r.id)
        // a film with no number to lead with always opened with the film
        const a = arms[opener === 'proof' && !r.output?.highlights?.proof?.length ? 'film' : opener]
        a.sent++
        if ((seen.get(r.id)?.plays ?? 0) > 0) a.watched++
        if (r.outreach?.status === 'replied' || r.outreach?.status === 'interview') a.replied++
      }
      const rate = (a: { sent: number; replied: number }) => (a.sent ? a.replied / a.sent : 0)
      // a winner needs enough sends on each side to mean something
      const winner = <K extends Opener>(x: K, y: K): K | null =>
        arms[x].sent >= 5 && arms[y].sent >= 5 && rate(arms[x]) !== rate(arms[y])
          ? rate(arms[x]) > rate(arms[y])
            ? x
            : y
          : null
      const sendingNew = arms.homework.sent + arms.question.sent > 0
      const leader = sendingNew ? winner('homework', 'question') : winner('film', 'proof')
      return { ...arms, leader }
    },
  )

  app.get(
    '/v1/followups',

    {
      schema: {
        tags: ['films'],
        summary: 'Sent films that are due a follow-up, with the message ready',
        description:
          'A film marked sent with no reply is due a follow-up. A job seeker\'s film gets one, 7 days after it was sent (or 2 days after someone watched it), that brings something new; a seller\'s gets a first after 4 days and a last, shorter one 7 days later. 7 days after the last one it is due to be marked no reply. Each comes with the email (subject "Re: …") and a LinkedIn version, with a [First name] placeholder.',
      },
    },
    async (req) => {
      const rows = await sql<FilmRow[]>`
        select * from runs where agent = 'film' and owner = ${req.owner} and status = 'succeeded'
          and outreach->>'status' = 'sent'
        order by id desc limit 500`
      const now = Date.now()
      const seen = await viewSummaries(
        sql,
        rows.map((r) => r.id),
      )
      const steps = rows.map((r) => ({
        r,
        next: nextStep(r.outreach, now, watchedFrom(seen.get(r.id)), waitsOf(r))!,
      }))
      const due = steps
        .filter((s) => s.next.due)
        .sort((a, b) => a.next.dueAt.localeCompare(b.next.dueAt))
      const upcoming = steps
        .filter((s) => !s.next.due)
        .map((s) => s.next.dueAt)
        .sort()
      return {
        data: await Promise.all(
          due.map(async ({ r, next }) => {
            const film = filmDto(r, publicUrl, seen.get(r.id))
            const m =
              r.output && film.share
                ? addressed(
                    messagesFor(r.output, r.output.profile ?? r.input.profile, film.share, {
                      homework: homeworkOf(r),
                      fresh: await freshFact(r),
                      opener: openerFor(r.id, presetOf(r)),
                      raised: raisedBySite(r.output.host),
                      now: new Date(r.createdAt).getTime(),
                    }),
                    r.recipient?.name,
                  )
                : null
            return {
              film,
              next,
              message:
                m && next.kind === 'follow_up'
                  ? {
                      subject: `Re: ${m.email.subject}`,
                      body: next.step === 1 ? m.followUp : m.lastNote,
                      linkedin: m.linkedinFollowUp,
                      to: r.recipient?.email ?? null,
                    }
                  : null,
            }
          }),
        ),
        waiting: upcoming.length,
        nextDueAt: upcoming[0] ?? null,
      }
    },
  )

  app.post(
    '/v1/films/:id/followup',
    {
      schema: {
        tags: ['films'],
        summary: 'Record that you sent a follow-up for this film',
        params: z.object({ id: RunId }),
      },
    },
    async (req, reply) => {
      const run = (await ownFilm(req.params.id, req.owner)) as FilmRow | undefined
      if (!run) return notFound(reply)
      if (run.outreach?.status !== 'sent')
        return reply.status(409).send({
          error: {
            code: 'not_waiting',
            message: 'only a film marked sent, with no reply yet, can be followed up',
          },
        })
      const [r] = await sql<FilmRow[]>`
        update runs set outreach = ${sql.json(followedUp(run.outreach) as never)}
        where id = ${req.params.id} returning *`
      return filmDto(r!, publicUrl)
    },
  )

  /* ------------------------------------------------------------- warm leads */
  /** the touches the sender marked done on these films, by film */
  const touchesOf = async (owner: Owner, ids: string[]) => {
    const rows = ids.length
      ? await sql<(Touch & { runId: string; doneAt: Date })[]>`
          select run_id, kind, role_id, said, build_note, build_link, done_at from touches
          where owner = ${owner} and run_id = any(${ids}) order by done_at, id`
      : []
    const out = new Map<string, Touch[]>()
    for (const r of rows)
      out.set(r.runId, [
        ...(out.get(r.runId) ?? []),
        {
          kind: r.kind,
          roleId: r.roleId,
          said: r.said,
          buildNote: r.buildNote,
          buildLink: r.buildLink,
          doneAt: new Date(r.doneAt).toISOString(),
        },
      ])
    return out
  }
  /** the day a film was first marked replied: kept since step 12, else its last status change */
  const repliedOf = (r: FilmRow) => r.outreach?.repliedAt ?? r.outreach?.at ?? null
  const warmFilm = (r: FilmRow) => ({
    preset: presetOf(r),
    status: r.outreach?.status,
    repliedAt: repliedOf(r),
    company: r.output?.company ?? null,
    host: r.output?.host ?? r.input.url,
  })
  /**
   * Roles from the Jobs cache at these films' companies, posted since the reply, with how well
   * the sender fits each (Fit check). Only these few get their requirements read.
   */
  const warmJobs = async (owner: Owner, rows: FilmRow[]): Promise<WarmJob[]> => {
    if (!rows.length) return []
    const profile = await newestProfile(owner)
    if (!profile) return []
    const state = await getSearch(sql, owner, profile.sender.role)
    const all = await cachedJobs(sql, boardsFor(state.boards))
    // every role at a warm company posted since the reply, of any fit; rolesFor keeps strong and good
    const jobs = all
      .filter((j) => rows.some((r) => rolesFor(warmFilm(r), [{ ...j, fit: 'good' }]).length > 0))
      .slice(0, 40)
    const reqs = await requirementsFor(sql, jobs, jobsFetch ? { fetch: jobsFetch } : {})
    return jobs.map((j) => {
      const fit = fitOf(reqs.get(j.id) ?? [], profile)
      return {
        id: j.id,
        title: j.title,
        url: j.url,
        company: j.company,
        site: j.site,
        posted: j.posted,
        fit: fit?.level ?? null,
        why: fit?.best?.with ?? null,
      }
    })
  }
  /** a film's newest post from its homework, for a stay-in-touch with nothing new built */
  const newestPost = (r: FilmRow) =>
    [...(r.output?.homework?.items ?? [])].sort((a, b) =>
      (b.date ?? '').localeCompare(a.date ?? ''),
    )[0] ?? null

  app.get(
    '/v1/warm',
    {
      schema: {
        tags: ['films'],
        summary: 'Warm leads: the touches due after a reply, each with its draft',
        description:
          "Films marked replied or interview, from a job seeker's profile. Each gets a thank-you the day it's marked replied (naming one thing they said, and asking who else to talk to), a short note with what you built 5 days later when you said you'd build something, then a stay-in-touch note every 42 days. When a role with a strong or good Fit check is posted at their company after the reply, a referral ask is due the next day, once per role, with a forwardable blurb, and one bump 7 days after it was sent. Drafts only: nothing is sent for you. `month.conversations` counts films first marked replied or interview this calendar month, Pacific time.",
      },
    },
    async (req) => {
      const rows = await sql<FilmRow[]>`
        select * from runs where agent = 'film' and owner = ${req.owner} and status = 'succeeded'
          and outreach->>'status' in ('replied', 'interview')
        order by id desc limit 500`
      const now = Date.now()
      const warm = rows.filter((r) => isWarm(warmFilm(r)))
      const [touches, jobs] = await Promise.all([
        touchesOf(
          req.owner,
          warm.map((r) => r.id),
        ),
        warmJobs(req.owner, warm),
      ])
      const steps = warm.map((r) => ({
        r,
        t: touches.get(r.id) ?? [],
        next: nextTouch(warmFilm(r), touches.get(r.id) ?? [], jobs, now),
      }))
      const due = steps
        .filter((s) => s.next?.due)
        .sort((a, b) => a.next!.dueAt.localeCompare(b.next!.dueAt))
      const upcoming = steps
        .filter((s) => s.next && !s.next.due)
        .map((s) => s.next!.dueAt)
        .sort()
      return {
        data: due.map(({ r, t, next }) => {
          const film = filmDto(r, publicUrl)
          const profile = r.output?.profile ?? r.input.profile
          const thanks = saidOf(t)
          const post = newestPost(r)
          const draft = draftTouch({
            kind: next!.kind,
            company: film.company ?? film.host ?? '',
            profile,
            said: thanks?.said ?? null,
            buildNote: thanks?.buildNote ?? null,
            role: next!.role ?? null,
            share: film.share,
            post: post ? { title: post.title, url: post.url } : null,
          })
          const ctx = touchContext(r.output ?? {}, profile, {
            homework: r.output?.homework ?? null,
            said: thanks?.said,
            buildNote: thanks?.buildNote,
            role: next!.role ?? null,
            link: film.share,
          })
          // a saved line that breaks a rule is shown with why, not quietly edited
          const flags = [
            ...checkMessage(next!.kind, draft, ctx),
            ...(draft.blurb ? checkMessage('referralBlurb', draft.blurb, ctx) : []),
          ].filter((c) => !c.ok)
          return {
            film,
            next,
            // what the web app redrafts the thank-you from as the sender types
            profile: {
              sender: profile.sender,
              points: profile.points,
              proof: profile.proof,
              ...(profile.creator ? { creator: profile.creator } : {}),
              projects: profile.projects ?? [],
            },
            said: thanks?.said ?? null,
            buildNote: thanks?.buildNote ?? null,
            draft: { ...draft, to: r.recipient?.email ?? null },
            flags,
          }
        }),
        waiting: upcoming.length,
        nextDueAt: upcoming[0] ?? null,
        month: {
          conversations: conversationsThisMonth(
            rows.map((r) => ({ repliedAt: repliedOf(r) })),
            now,
          ),
        },
      }
    },
  )

  const WarmDone = z.object({
    kind: z.enum(TOUCH_KINDS),
    roleId: z.string().trim().min(1).max(300).optional(),
    said: z.string().trim().min(3).max(240).optional(),
    buildNote: z.string().trim().min(3).max(160).optional(),
    buildLink: z
      .string()
      .trim()
      .regex(/^https:\/\/\S{4,300}$/, 'the link to what you built starts with https://')
      .optional(),
  })
  /** a warm film the asker owns, or the reply that says why not */
  const ownWarm = async (id: string, owner: Owner, reply: FastifyReply) => {
    const run = (await ownFilm(id, owner)) as FilmRow | undefined
    if (!run) return void notFound(reply)
    if (!isWarm(warmFilm(run))) {
      void reply.status(409).send({
        error: {
          code: 'not_warm',
          message: "only a job seeker's film marked replied or interview has warm-lead touches",
        },
      })
      return
    }
    return run
  }

  app.post(
    '/v1/warm/:runId/done',
    {
      schema: {
        tags: ['films'],
        summary: 'Mark a warm-lead touch done (you sent it yourself)',
        description:
          'The thank-you takes `said` (one thing they said) and, optionally, `buildNote` (something you will build from it). The proof-of-work note takes `buildLink`. A referral ask or bump takes the `roleId` it was about. Marking the same touch twice is fine; the first one stands.',
        params: z.object({ runId: RunId }),
        body: WarmDone,
      },
    },
    async (req, reply) => {
      const run = await ownWarm(req.params.runId, req.owner, reply)
      if (!run) return reply
      const b = req.body
      const need = (field: string, message: string) =>
        reply.status(422).send({
          error: { code: 'invalid_request', message, fields: [{ path: field, message }] },
        })
      if (b.kind === 'thankYou' && !b.said)
        return need('said', 'add one thing they said, so the thank-you can name it')
      if (b.kind === 'proofOfWork' && !b.buildLink)
        return need('buildLink', 'add the link to what you built')
      if ((b.kind === 'referralAsk' || b.kind === 'referralBump') && !b.roleId)
        return need('roleId', 'say which role the referral ask was about')
      const role = b.kind === 'referralAsk' || b.kind === 'referralBump' ? b.roleId! : null
      await sql`
        insert into touches (owner, run_id, kind, role_id, said, build_note, build_link)
        values (${req.owner}, ${run.id}, ${b.kind satisfies TouchKind}, ${role},
          ${b.kind === 'thankYou' ? (b.said ?? null) : null},
          ${b.kind === 'thankYou' ? (b.buildNote ?? null) : null},
          ${b.kind === 'proofOfWork' ? (b.buildLink ?? null) : null})
        on conflict do nothing`
      const touches = (await touchesOf(req.owner, [run.id])).get(run.id) ?? []
      return {
        touches,
        next: nextTouch(warmFilm(run), touches, await warmJobs(req.owner, [run]), Date.now()),
      }
    },
  )

  app.post(
    '/v1/warm/:runId/stop',
    {
      schema: {
        tags: ['films'],
        summary: '"Stop reminders": no more warm-lead touches for this film',
        params: z.object({ runId: RunId }),
      },
    },
    async (req, reply) => {
      const run = (await ownFilm(req.params.runId, req.owner)) as FilmRow | undefined
      if (!run) return notFound(reply)
      await sql`
        insert into touches (owner, run_id, kind, stopped) values (${req.owner}, ${run.id}, 'stop', true)
        on conflict do nothing`
      return { stopped: true }
    },
  )

  app.get(
    '/v1/outreach',
    {
      schema: {
        tags: ['films'],
        summary: 'Films sent and how many got a reply',
      },
    },
    async (req) => {
      const rows = await sql<{ status: OutreachStatus; n: number }[]>`
        select outreach->>'status' as status, count(*)::int as n from runs
        where agent = 'film' and owner = ${req.owner} and outreach is not null
        group by 1`
      const n = (s: OutreachStatus) => rows.find((r) => r.status === s)?.n ?? 0
      const sent = rows.reduce((a, r) => a + r.n, 0)
      const replied = n('replied') + n('interview')
      return {
        sent,
        replied,
        interviews: n('interview'),
        noReply: n('no_reply'),
        waiting: n('sent'),
        replyRate: sent ? replied / sent : null,
      }
    },
  )

  app.post(
    '/v1/films/:id/cancel',
    { schema: { tags: ['films'], params: z.object({ id: RunId }) } },
    async (req, reply) => {
      if (!(await ownFilm(req.params.id, req.owner))) return notFound(reply)
      const r = await cancelRun(sql, req.params.id)
      return r
        ? filmDto(r as FilmRow, publicUrl)
        : reply
            .status(409)
            .send({ error: { code: 'not_cancellable', message: 'film already finished' } })
    },
  )

  app.get(
    '/v1/batches/:id/results.csv',
    {
      schema: {
        tags: ['films'],
        summary: 'Batch results as CSV, ready for a CRM or sequencer',
        params: z.object({ id: z.string() }),
      },
    },
    async (req, reply) => {
      const rows = await sql<FilmRow[]>`
        select * from runs where agent = 'film' and owner = ${req.owner} and input->>'batch' = ${req.params.id} order by (input->>'ref')::int`
      const views = await summariesFor(rows)
      const base = publicUrl.replace(/\/$/, '')
      const cell = (s: unknown) => {
        const v = s == null ? '' : String(s)
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
      }
      const lines = [
        'url,company,status,share_url,gif_url,video_url,email_snippet,plays,finishes,best_seconds,last_viewed',
        ...rows.map((r) => {
          const d = filmDto(r, publicUrl, views.get(r.id))
          const share = d.share ?? ''
          const gif = d.share ? `${share}/preview.gif` : ''
          const video =
            d.share && r.output ? `${share}/${r.output.files.film.split('/').pop()}` : ''
          const snippet = d.share
            ? `<a href="${share}"><img src="${gif}" width="480" alt="A video made for ${d.company}"></a>`
            : ''
          const v = d.views
          return [
            r.input.url,
            d.company,
            d.status,
            share,
            gif,
            video,
            snippet,
            v?.plays,
            v?.finishes,
            v?.bestSeconds,
            v?.lastSeen,
          ]
            .map(cell)
            .join(',')
        }),
      ]
      void base
      reply.header('content-type', 'text/csv; charset=utf-8')
      reply.header('content-disposition', `attachment; filename="coldopen-${req.params.id}.csv"`)
      return lines.join('\n')
    },
  )

  app.get(
    '/v1/stats',
    {
      schema: {
        tags: ['ops'],
        summary: 'Film counts, render throughput and the reply rate on sent films',
        description:
          "Totals only, nothing about any one person. Readable from any site, for the landing page's counter.",
      },
    },
    async (_req, reply) => {
      reply.header('access-control-allow-origin', '*')
      reply.header('cache-control', 'public, max-age=300')
      const [counts, perf, [o]] = await Promise.all([
        sql<
          { status: string; n: number }[]
        >`select status, count(*)::int as n from runs where agent = 'film' group by status`,
        sql<{ n: number; avg: number | null; recovered: number }[]>`
        select count(*)::int as n,
          avg(extract(epoch from completed_at - created_at))::float8 as avg,
          (select count(distinct run_id)::int from run_log l where l.kind = 'worker_lost') as recovered
        from runs where agent = 'film' and status = 'succeeded'`,
        sql<{ sent: number; replied: number }[]>`
        select count(*)::int as sent,
          count(*) filter (where outreach->>'status' in ('replied', 'interview'))::int as replied
        from runs where agent = 'film' and outreach is not null`,
      ])
      return {
        films: Object.fromEntries(counts.map((c) => [c.status, c.n])),
        avgSecondsPerFilm: perf[0]?.avg ? Math.round(perf[0].avg) : null,
        recoveredFromCrashes: perf[0]?.recovered ?? 0,
        outreach: { sent: o?.sent ?? 0, replied: o?.replied ?? 0 },
      }
    },
  )

  /* --------------------------------------------------------- public share */
  app.get(
    '/f/:id',
    { schema: { hide: true, params: z.object({ id: RunId }) } },
    async (req, reply) => {
      const run = (await getRun(sql, req.params.id)) as FilmRow | undefined
      if (run?.agent !== 'film' || run.status !== 'succeeded' || !run.output) {
        return reply
          .status(404)
          .type('text/html')
          .send(
            '<!doctype html><title>Not found</title><p>This film does not exist or is not ready yet.</p>',
          )
      }
      reply.type('text/html; charset=utf-8')
      const link = `${publicUrl.replace(/\/$/, '')}/f/${run.id}`
      return sharePage(
        viewFromRun(
          run.output.profile ? { ...run.input, profile: run.output.profile } : run.input,
          run.output,
        ),
        link,
        `${link}/v`,
        cfg.HOSTED ? publicUrl : undefined,
      )
    },
  )

  // reports from the share page: open, play, progress, end. Always 204, so a page never
  // learns anything from the response and a bad report can't break it.
  const viewStore = pgViewStore(sql)
  app.post(
    '/f/:id/v',
    { schema: { hide: true, params: z.object({ id: RunId }) } },
    async (req, reply) => {
      const [film] = await sql<{ company: string }[]>`
        select output->>'company' as company from runs
        where id = ${req.params.id} and agent = 'film' and status = 'succeeded'`
      if (film) {
        await recordBeacon({
          store: viewStore,
          filmId: req.params.id,
          company: film.company,
          body: req.body,
          userAgent: req.headers['user-agent'],
          ip: req.ip,
          ownHost: new URL(publicUrl).host,
          salt: cfg.VIEW_SALT,
          webhook: cfg.NOTIFY_WEBHOOK_URL,
          link: `${publicUrl.replace(/\/$/, '')}/f/${req.params.id}`,
          defer: (p) => {
            p.catch(() => {})
          },
        })
      }
      return reply.status(204).send()
    },
  )

  app.get(
    '/v1/films/:id/messages',
    {
      schema: {
        tags: ['films'],
        summary: 'Draft the LinkedIn sequence, the email and the follow-ups that go with a film',
        description:
          'The connection note (200 characters, no link), the message once they accept, InMail, the warm email and the follow-ups, with a [First name] placeholder. `writer` says which drafts the model wrote and which are templates; `flags` lists the checks a draft failed (why it fell back to its template), and `notes` says in plain sentences what code changed in a draft, such as a funding line left out. For a job seeker, `rewrite: true` means stored model drafts no longer pass the current checks or were written before the homework you saved, so the templates stand in until POST /v1/films/:id/messages/rewrite writes them again. Nothing is sent.',
        params: z.object({ id: RunId }),
      },
    },
    async (req, reply) => {
      const run = await ownFilm(req.params.id, req.owner)
      if (!run?.output) return notFound(reply)
      const link = filmDto(run, publicUrl).share!
      const row = run as FilmRow
      return addressed(
        messagesFor(run.output, run.output.profile ?? run.input.profile, link, {
          homework: homeworkOf(row),
          fresh: await freshFact(row),
          opener: openerFor(run.id, presetOf(row)),
          raised: raisedBySite(run.output.host),
          // the research pick is the one the film had when it was made
          now: new Date(run.createdAt).getTime(),
        }),
        run.recipient?.name,
      )
    },
  )

  app.post(
    '/v1/films/:id/messages/rewrite',
    {
      schema: {
        tags: ['films'],
        summary: "Have the model write a film's messages again, from your homework",
        description:
          "For a job seeker's film whose drafts were written before today's checks or before the homework you saved (the messages come back with `rewrite: true`). One model call writes the connection note, the message once they accept, InMail and the email again, checked as always; any draft that still fails is its template. Job seekers only. On the hosted app it has its own daily limit (10 by default, `DAILY_REWRITES`), apart from résumé drafts, and an attempt the model couldn't finish isn't counted. Nothing is sent. Returns the messages, as GET /v1/films/:id/messages does.",
        params: z.object({ id: RunId }),
      },
    },
    async (req, reply) => {
      const run = await ownFilm(req.params.id, req.owner)
      if (!run?.output || run.status !== 'succeeded') return notFound(reply)
      const row = run as FilmRow
      const profile = run.output.profile ?? run.input.profile
      // only a job seeker's drafts are ever offered again (messagesFor's `rewrite`)
      if (profile.preset !== 'candidate')
        return reply.status(409).send({
          error: {
            code: 'no_model_drafts',
            message: "only a job seeker's messages can be written again",
          },
        })
      if (!llm)
        return reply.status(409).send({
          error: {
            code: 'no_model',
            message: 'writing the messages again needs a model, so the templates are shown instead',
          },
        })
      // its own daily count, apart from résumé drafts: rewriting is a smaller, more frequent ask
      const counted = !unlimited(req)
      if (counted && !(await consume(sql, `rewrites:${req.owner}`, cfg.DAILY_REWRITES)))
        return limited(
          reply,
          `That's ${cfg.DAILY_REWRITES} rewrites today. The template drafts are still here, or come back tomorrow.`,
        )
      const [research] = await sql<
        { output: { facts?: { text: string; kind: string }[] } | null }[]
      >`
        select output from steps where run_id = any(${[run.id, run.input.editOf].filter(Boolean) as string[]})
          and key = 'research' and status = 'completed' limit 1`
      const out = run.output
      const signal = AbortSignal.timeout(120_000)
      try {
        const written = await writeMessages({
          film: {
            company: out.company,
            ...(out.job ? { job: out.job } : {}),
            script: out.script,
            highlights: out.highlights,
            ...(out.related ? { related: out.related } : {}),
            requirements: (research?.output?.facts ?? [])
              .filter((f) => f.kind === 'requirement')
              .map((f) => f.text),
          },
          profile,
          homework: out.homework,
          sender: homeworkOf(row),
          opener: openerFor(run.id, profile.preset),
          model: cfg.LLM_MODEL,
          // the post the drafts read is the one the film had when it was made
          now: new Date(run.createdAt).getTime(),
          complete: async (_key, messages) =>
            (await callModel(llm, { schema: messagesSchemaFor(profile.preset), messages }, signal))
              .value as ModelMessages,
        })
        // ownFilm checked the owner, as the outreach and recipient routes do
        await sql`
          update runs set output = jsonb_set(output, '{messages}', ${sql.json(written as never)})
          where id = ${run.id}`
        const link = filmDto(run, publicUrl).share!
        return addressed(
          messagesFor({ ...out, messages: written }, profile, link, {
            homework: homeworkOf(row),
            fresh: await freshFact(row),
            opener: openerFor(run.id, presetOf(row)),
            raised: raisedBySite(out.host),
            now: new Date(run.createdAt).getTime(),
          }),
          run.recipient?.name,
        )
      } catch (err) {
        req.log.warn({ err }, 'messages rewrite failed')
        // nothing was written, so it doesn't count against today's rewrites
        if (counted) await refund(sql, `rewrites:${req.owner}`)
        return reply.status(503).send({
          error: {
            code: 'model_busy',
            message:
              "the model couldn't write them just now, so the template drafts are still here. Try again in a minute",
          },
        })
      }
    },
  )

  /** a line from their site the film didn't quote, for a follow-up that brings something new */
  const freshFact = async (run: FilmRow): Promise<string | null> => {
    const [st] = await sql<{ output: { facts?: { text: string; kind: string }[] } | null }[]>`
      select output from steps where run_id = any(${[run.id, run.input.editOf].filter(Boolean) as string[]})
        and key = 'research' and status = 'completed' limit 1`
    const used = (run.output?.highlights?.quote.text ?? '').toLowerCase()
    const fact = (st?.output?.facts ?? []).find(
      (f) =>
        (f.kind === 'stat' || f.kind === 'claim') &&
        f.text.length >= 20 &&
        f.text.length <= 110 &&
        !used.includes(f.text.toLowerCase()) &&
        !f.text.toLowerCase().includes(used || '\u0000'),
    )
    return fact?.text.replace(/\s+/g, ' ').trim() ?? null
  }

  app.put(
    '/v1/films/:id/detail',
    {
      schema: {
        tags: ['films'],
        summary: 'Save your one detail from using their product',
        description:
          'In your own words, like "the export to CSV dropped every custom field, so I rebuilt my report by hand". The email opens with it. Send null to clear.',
        params: z.object({ id: RunId }),
        body: z.object({ detail: z.string().trim().min(10).max(240).nullable() }),
      },
    },
    async (req, reply) => {
      if (!(await ownFilm(req.params.id, req.owner))) return notFound(reply)
      const [r] = await sql<FilmRow[]>`
        update runs set detail = ${req.body.detail} where id = ${req.params.id} returning *`
      return { detail: r!.detail ?? null }
    },
  )

  app.put(
    '/v1/films/:id/homework',
    {
      schema: {
        tags: ['films'],
        summary: 'Save your homework: what you noticed, what you built and your question',
        description:
          'Three things only someone who did the work would have: a detail from using their product (the email opens with it), something small you built with it (a link and one line) and your own question for them. Leave a field out to keep it as it is; send null to clear it.',
        params: z.object({ id: RunId }),
        body: z.object({
          detail: z.string().trim().min(10).max(240).nullable().optional(),
          question: z.string().trim().min(10).max(200).nullable().optional(),
          built: BuiltSchema.nullable().optional(),
        }),
      },
    },
    async (req, reply) => {
      const run = await ownFilm(req.params.id, req.owner)
      if (!run) return notFound(reply)
      // a field left out keeps what was saved; null clears it
      const b = req.body
      const next = {
        detail: b.detail === undefined ? (run.detail ?? null) : b.detail,
        question: b.question === undefined ? (run.question ?? null) : b.question,
        built: b.built === undefined ? (run.built ?? null) : b.built,
      }
      const [r] = await sql<FilmRow[]>`
        update runs set detail = ${next.detail}, question = ${next.question},
          built = ${next.built ? sql.json(next.built as never) : null}
        where id = ${req.params.id} returning *`
      return homeworkOf(r!)
    },
  )

  /** who to reach at a film's company: grouped, in the order that gets replies at its size */
  const reachFor = async (run: FilmRow, owner: Owner) => {
    const out = run.output!
    const title = out.job?.title
    const keys = [...new Set([companyKey(out.company), companyKey(out.host)].filter(Boolean))]
    // a rough cut in SQL (same key, or one key starting the other), then the exact match
    const rows = await sql<Connection[]>`
      select name, url, company, position, connected_on from connections
      where owner = ${owner} and (
        company_key = any(${keys})
        or split_part(company_key, ' ', 1) = any(${keys.map((k) => k.split(' ')[0]!)})
      )
      limit 500`
    const [{ n } = { n: 0 }] = await sql<{ n: number }[]>`
      select count(*)::int as n from connections where owner = ${owner}`
    const site = /^https?:\/\//.test(out.host) ? out.host : `https://${out.host}`
    const hiring = ycOf({ site })
    const startup = startupOf({ site, slug: hiring?.slug })
    const yc = hiring ?? (startup ? { batch: startup.batch, slug: startup.slug } : null)
    const known = knownAt(rows, out.company, out.host, title).slice(0, 25)
    // with no job link, the roles in their saved job search say what the job is
    const saved = title ? null : await getSearch(sql, owner, undefined)
    const groups = peopleSearches(out.company, {
      jobTitle: title,
      profile: run.input.profile,
      ...(saved ? { roles: targetRoles(saved.search, run.input.profile) } : {}),
      yc,
      team: startup?.team ?? null,
      known,
    })
    return { company: out.company, team: startup?.team ?? null, groups, known, connections: n }
  }

  app.get(
    '/v1/films/:id/brief',
    {
      schema: {
        tags: ['films'],
        summary:
          'A brief for the call once they reply: the company, the role, who to reach and questions to ask',
        description:
          "Built from the film's own research (the company's site and the job post) and your profile; nothing new is fetched.",
        params: z.object({ id: RunId }),
      },
    },
    async (req, reply) => {
      const run = await ownFilm(req.params.id, req.owner)
      if (!run?.output) return notFound(reply)
      const steps = await sql<{ key: string; output: unknown }[]>`
        select key, output from steps
        where run_id = any(${[run.id, run.input.editOf].filter(Boolean) as string[]})
          and key in ('research', 'job') and status = 'completed'`
      const out = (k: string) => (steps.find((s) => s.key === k)?.output ?? null) as never
      const { groups } = await reachFor(run, req.owner)
      return briefOf(run.output.company, out('research'), out('job'), run.input.profile, groups)
    },
  )

  app.get(
    '/v1/films/:id/people',
    {
      schema: {
        tags: ['films'],
        summary:
          'Who to send a film to: groups of LinkedIn searches, and people you already know there',
        description:
          "Searches open on LinkedIn for you to run yourself; nothing is scraped or sent. `groups` are in the order most likely to get a reply at a company this size (team size from YC's list when known): Founders, Warm paths, People doing the job, Hiring manager and Recruiting, each with `why` (when to write to them) and `ask` (what to ask them); the first is the one to start with. Known people come from the connections export you uploaded. **Deprecated:** `searches`, the same searches as one flat list, stays for one release for older clients (the Chrome extension); use `groups`.",
        params: z.object({ id: RunId }),
      },
    },
    async (req, reply) => {
      const run = await ownFilm(req.params.id, req.owner)
      if (!run?.output) return notFound(reply)
      const r = await reachFor(run, req.owner)
      return { ...r, searches: flatSearches(r.groups) }
    },
  )

  app.get(
    '/v1/connections',
    { schema: { tags: ['people'], summary: 'How many LinkedIn connections you uploaded' } },
    async (req) => {
      const [r] = await sql<{ n: number; addedAt: Date | null }[]>`
        select count(*)::int as n, max(added_at) as added_at from connections where owner = ${req.owner}`
      return { count: r?.n ?? 0, addedAt: r?.addedAt ?? null }
    },
  )

  app.put(
    '/v1/connections',
    {
      bodyLimit: 12 * 1024 * 1024,
      schema: {
        tags: ['people'],
        summary: "Upload LinkedIn's Connections.csv, replacing the last one",
        description:
          'Keeps name, profile link, company, position and date connected; emails are dropped. Used only to show who you know at a company.',
        body: z.object({
          csv: z
            .string()
            .min(10)
            .max(10 * 1024 * 1024),
        }),
      },
    },
    async (req, reply) => {
      let list: Connection[]
      try {
        list = parseConnections(req.body.csv)
      } catch (err) {
        return reply
          .status(400)
          .send({ error: { code: 'bad_csv', message: (err as Error).message } })
      }
      await sql.begin(async (tx) => {
        await tx`delete from connections where owner = ${req.owner}`
        for (let i = 0; i < list.length; i += 1000) {
          const chunk = list.slice(i, i + 1000).map((c) => ({
            owner: req.owner,
            name: c.name,
            url: c.url,
            company: c.company,
            companyKey: companyKey(c.company),
            position: c.position,
            connectedOn: c.connectedOn,
          }))
          await tx`insert into connections ${tx(chunk)}`
        }
      })
      return { count: list.length }
    },
  )

  app.delete(
    '/v1/connections',
    { schema: { tags: ['people'], summary: 'Delete your uploaded connections' } },
    async (req) => {
      const gone = await sql`delete from connections where owner = ${req.owner}`
      return { deleted: gone.count }
    },
  )

  app.get(
    '/v1/films/:id/views',
    {
      schema: {
        tags: ['films'],
        summary: "Who watched a film's share page",
        description:
          'A summary (opens, distinct viewers, plays, finishes, furthest point) and the 100 most recent viewing sessions. Bots and link scanners are not counted, and no IP address is stored.',
        params: z.object({ id: RunId }),
      },
    },
    async (req, reply) => {
      const run = await ownFilm(req.params.id, req.owner)
      if (!run) return notFound(reply)
      if (run.output?.shared && share) {
        try {
          return { ...(await oneFilmViews(share, run.output.shared.id)), loaded: true }
        } catch (err) {
          app.log.warn({ err }, 'could not read views from the share worker')
          return { summary: NO_VIEWS, sessions: [], loaded: false }
        }
      }
      return { ...(await filmViews(sql, req.params.id)), loaded: true }
    },
  )

  app.get(
    '/f/:id/:name',
    { schema: { hide: true, params: z.object({ id: RunId, name: z.string() }) } },
    async (req, reply) => {
      if (!PUBLIC_FILES.test(req.params.name)) return reply.status(404).send('not found')
      const [ok] =
        await sql`select 1 from runs where id = ${req.params.id} and agent = 'film' and status = 'succeeded'`
      if (!ok || !existsSync(filmFile(req.params.id, req.params.name) ?? '\0'))
        return reply.status(404).send('not found')
      reply.header('cache-control', 'public, max-age=86400')
      const dl = attachment(
        new URL(req.url, 'http://x').searchParams.get('download'),
        req.params.name,
      )
      if (dl) reply.header('content-disposition', dl)
      return reply.sendFile(`${req.params.id}/${req.params.name}`)
    },
  )

  /* ----------------------------------------------------------------- slack */
  app.post('/slack/events', { schema: { hide: true } }, async (req, reply) => {
    if (!cfg.SLACK_SIGNING_SECRET || !slack)
      return reply.status(404).send({ error: 'slack not configured' })
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? ''
    const ok = verifySlackSignature({
      signingSecret: cfg.SLACK_SIGNING_SECRET,
      timestamp: req.headers['x-slack-request-timestamp'] as string | undefined,
      signature: req.headers['x-slack-signature'] as string | undefined,
      rawBody: raw,
    })
    if (!ok) return reply.status(401).send({ error: 'bad signature' })
    const body = req.body as {
      type: string
      challenge?: string
      event_id?: string
      event?: {
        type: string
        text?: string
        channel?: string
        ts?: string
        thread_ts?: string
        bot_id?: string
      }
    }
    if (body.type === 'url_verification') return { challenge: body.challenge }
    const ev = body.event
    if (body.type !== 'event_callback' || ev?.type !== 'app_mention' || ev.bot_id)
      return { ok: true }

    const url = urlFromMention(ev.text ?? '')
    const thread = { channel: ev.channel!, threadTs: ev.thread_ts ?? ev.ts! }
    if (!url) {
      await slack
        .postMessage(
          thread.channel,
          'Send me a company URL, like `@coldopen acme.com`, and I’ll make them a film.',
          thread.threadTs,
        )
        .catch(() => {})
      return { ok: true }
    }
    try {
      const profile = await resolveProfile({}, 'team', true)
      const input = FilmInputSchema.parse({ url, profile, format: 'square', slack: thread })
      // Slack retries deliveries; the event id makes the run idempotent
      const r = await createRun(sql, {
        agent: 'film',
        input,
        idempotencyKey: `slack:${body.event_id ?? ev.ts}`,
      })
      if (r.kind === 'created') {
        await slack
          .postMessage(
            thread.channel,
            `On it. Researching ${new URL(url).hostname} and rendering a 30-second film. I'll post it here in about a minute.`,
            thread.threadTs,
          )
          .catch(() => {})
      }
    } catch (err) {
      await slack
        .postMessage(
          thread.channel,
          `I couldn't start that film: ${err instanceof Error ? err.message : err}`,
          thread.threadTs,
        )
        .catch(() => {})
    }
    return { ok: true }
  })

  /* -------------------------------------------------------------- dashboard */
  const dist = join(import.meta.dirname, '../../dashboard/dist')
  if (existsSync(dist)) {
    await app.register(fastifyStatic, {
      root: dist,
      prefix: '/',
      decorateReply: false,
      wildcard: true,
    })
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/v1/'))
        return reply.sendFile('index.html', dist)
      reply.status(404).send({ error: { code: 'not_found', message: 'route not found' } })
    })
  }
  // the hosted app keeps what people make 7 days (30 with an account): delete the rest hourly
  if (cfg.HOSTED) {
    const purge = () =>
      purgeExpired(sql, cfg)
        .then((n) => (n.runs || n.profiles || n.connections) && log.info(n, 'expired data deleted'))
        .catch((err) => log.warn({ err }, 'could not delete expired data'))
    void purge()
    const timer = setInterval(purge, 60 * 60_000)
    timer.unref()
    app.addHook('onClose', async () => clearInterval(timer))
    // keep every company's board read, so Jobs for you never waits on hundreds of them
    const warm = () =>
      warmBoards(sql, jobsFetch).catch((err) => log.warn({ err }, 'could not read job boards'))
    const first = setTimeout(warm, 20_000)
    const boards = setInterval(warm, 3 * 60 * 60_000)
    first.unref()
    boards.unref()
    app.addHook('onClose', async () => {
      clearTimeout(first)
      clearInterval(boards)
    })
  }

  return app
}
