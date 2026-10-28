import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import fastifyStatic from '@fastify/static'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import Fastify, { LogController } from 'fastify'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Config } from '../config.ts'
import type { Sql } from '../db/index.ts'
import { FilmInputSchema, type FilmResult } from '../film.ts'
import { newId } from '../ids.ts'
import type { LlmProvider } from '../llm/types.ts'
import type { Logger } from '../logger.ts'
import { registerQueueGauges, registry } from '../metrics.ts'
import { draftProfile } from '../profile/draft.ts'
import { parseResume } from '../profile/parse.ts'
import { resumeText } from '../profile/read.ts'
import {
  cancelRun,
  createRun,
  getLog,
  getRun,
  getSteps,
  type Run,
  retryRun,
} from '../runtime/store.ts'
import { ProfileSchema } from '../script/types.ts'
import { type SlackClient, urlFromMention, verifySlackSignature } from '../slack.ts'
import { sharePage } from './share.ts'

const FILE_NAMES =
  /^(film-(square|landscape|portrait)\.mp4|poster\.jpg|preview\.gif|contact-sheet\.jpg|site\.jpg|kit\.json|storyboard\.json)$/
const PUBLIC_FILES =
  /^(film-(square|landscape|portrait)\.mp4|poster\.jpg|preview\.gif|contact-sheet\.jpg)$/
const RunId = z.string().regex(/^run_[0-9A-Z]{26}$/, 'not a film id')

interface FilmRow extends Run {
  input: z.infer<typeof FilmInputSchema>
  output: FilmResult | null
}

function filmDto(r: FilmRow, publicUrl: string) {
  const out = r.output
  const base = `/v1/films/${r.id}/files`
  return {
    id: r.id,
    status: r.status,
    url: r.input.url,
    format: r.input.format,
    batch: r.input.batch ?? null,
    ref: r.input.ref ?? null,
    sender: r.input.profile.sender.name,
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
    share: out ? `${publicUrl.replace(/\/$/, '')}/f/${r.id}` : null,
  }
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
}

export async function buildApi({ sql, cfg, log, slack, llm = null }: ApiDeps) {
  const filmsDir = resolve(cfg.FILMS_DIR)
  const publicUrl = cfg.PUBLIC_URL
  const app = Fastify({
    loggerInstance: log,
    logController: new LogController({
      disableRequestLogging: (req) =>
        !['debug', 'trace'].includes(cfg.LOG_LEVEL) || req.url.startsWith('/healthz'),
    }),
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

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

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, _req, reply) => {
    const status = err.statusCode ?? 500
    if (status >= 500) app.log.error({ err }, 'request failed')
    reply.status(status).send({
      error: {
        code: err.validation ? 'invalid_request' : status >= 500 ? 'internal' : 'bad_request',
        message: status >= 500 ? 'internal error' : err.message,
      },
    })
  })

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
  app.get('/healthz', { schema: { hide: true } }, async () => ({ ok: true }))
  app.get('/readyz', { schema: { hide: true } }, async (_r, reply) => {
    try {
      await sql`select 1`
      return { ok: true }
    } catch {
      return reply.status(503).send({ ok: false })
    }
  })
  app.get('/metrics', { schema: { hide: true } }, async (_r, reply) => {
    reply.header('content-type', registry.contentType)
    return registry.metrics()
  })

  /* ------------------------------------------------------------------ auth */
  const keys = cfg.API_KEYS.map(digest)
  if (keys.length === 0) app.log.warn('API_KEYS is empty: the API is UNAUTHENTICATED (local mode)')
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/v1/') || keys.length === 0) return
    const h = req.headers.authorization ?? ''
    const token = h.startsWith('Bearer ') ? h.slice(7) : ''
    const d = digest(token)
    if (!token || !keys.some((k) => timingSafeEqual(k, d))) {
      return reply
        .status(401)
        .send({ error: { code: 'unauthorized', message: 'missing or invalid API key' } })
    }
  })

  /* -------------------------------------------------------------- profiles */
  app.get(
    '/v1/profiles',
    { schema: { tags: ['profiles'], summary: 'List sender profiles' } },
    async () => {
      const rows = await sql<{ id: string; name: string; data: unknown; updatedAt: Date }[]>`
      select id, name, data, updated_at from profiles order by updated_at desc`
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
    async (req) => {
      const [row] = await sql`
        insert into profiles (id, name, data) values (${req.params.id}, ${req.body.name}, ${sql.json(req.body.data as never)})
        on conflict (id) do update set name = excluded.name, data = excluded.data, updated_at = now()
        returning id, name, data, updated_at`
      return row
    },
  )

  app.delete(
    '/v1/profiles/:id',
    { schema: { tags: ['profiles'], params: z.object({ id: z.string() }) } },
    async (req, reply) => {
      const rows = await sql`delete from profiles where id = ${req.params.id} returning id`
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
      try {
        const text = await resumeText(
          new Uint8Array(Buffer.from(req.body.data, 'base64')),
          req.body.filename,
        )
        const resume = parseResume(text, req.body.exclude)
        return await draftProfile({
          resume,
          role: req.body.role,
          exclude: req.body.exclude,
          llm,
          ...(req.body.contact ? { contact: req.body.contact } : {}),
        })
      } catch (err) {
        return reply
          .status(422)
          .send({ error: { code: 'unreadable_resume', message: (err as Error).message } })
      }
    },
  )

  async function resolveProfile(body: { profile?: unknown; profileId?: string | undefined }) {
    if (body.profile) return ProfileSchema.parse(body.profile)
    if (body.profileId) {
      const [p] = await sql<
        { data: unknown }[]
      >`select data from profiles where id = ${body.profileId}`
      if (!p) throw Object.assign(new Error(`no profile "${body.profileId}"`), { statusCode: 404 })
      return ProfileSchema.parse(p.data)
    }
    const [first] = await sql<
      { data: unknown }[]
    >`select data from profiles order by updated_at desc limit 1`
    if (!first)
      throw Object.assign(new Error('create a profile first (PUT /v1/profiles/:id)'), {
        statusCode: 422,
      })
    return ProfileSchema.parse(first.data)
  }

  const normalizeUrl = (u: string) =>
    /^https?:\/\//i.test(u.trim()) ? u.trim() : `https://${u.trim()}`

  /* ----------------------------------------------------------------- films */
  const FilmBody = z.object({
    url: z.string().min(3),
    profileId: z.string().optional(),
    profile: ProfileSchema.optional(),
    format: z.enum(['square', 'landscape', 'portrait']).default('square'),
    ref: z.string().max(200).optional(),
    /** which proof items to show (indices into the profile's proof list) */
    proof: z.array(z.number().int().min(0)).min(1).max(3).optional(),
  })

  app.post(
    '/v1/films',
    {
      schema: {
        tags: ['films'],
        summary: 'Make a film for one company',
        description:
          'Queues research, script, render and encode. Poll GET /v1/films/:id for progress. Send an Idempotency-Key header to make retries safe.',
        body: FilmBody,
      },
    },
    async (req, reply) => {
      const profile = await resolveProfile(req.body)
      const input = FilmInputSchema.parse({ ...req.body, url: normalizeUrl(req.body.url), profile })
      const key = req.headers['idempotency-key']
      const r = await createRun(sql, {
        agent: 'film',
        input,
        idempotencyKey: typeof key === 'string' ? key : undefined,
      })
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
        summary: 'Make one film per prospect',
        body: z.object({
          urls: z.array(z.string().min(3)).min(1).max(1000),
          profileId: z.string().optional(),
          profile: ProfileSchema.optional(),
          format: z.enum(['square', 'landscape', 'portrait']).default('square'),
          proof: z.array(z.number().int().min(0)).min(1).max(3).optional(),
        }),
      },
    },
    async (req, reply) => {
      const profile = await resolveProfile(req.body)
      const batch = newId('bat')
      const urls = [...new Set(req.body.urls.map(normalizeUrl))]
      const created = await sql.begin(async (tx) => {
        const out = []
        for (const [i, url] of urls.entries()) {
          const input = FilmInputSchema.parse({
            url,
            profile,
            format: req.body.format,
            ...(req.body.proof ? { proof: req.body.proof } : {}),
            batch,
            ref: String(i + 1),
          })
          out.push((await createRun(tx as unknown as Sql, { agent: 'film', input })).run)
        }
        return out
      })
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
        select * from runs where agent = 'film'
          ${req.query.before ? sql`and id < ${req.query.before}` : sql``}
          ${req.query.batch ? sql`and input->>'batch' = ${req.query.batch}` : sql``}
        order by id desc limit ${req.query.limit}`
      return {
        data: rows.map((r) => filmDto(r, publicUrl)),
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
      const run = (await getRun(sql, req.params.id)) as FilmRow | undefined
      if (run?.agent !== 'film')
        return reply.status(404).send({ error: { code: 'not_found', message: 'film not found' } })
      const [steps, timeline] = await Promise.all([getSteps(sql, run.id), getLog(sql, run.id)])
      return {
        ...filmDto(run, publicUrl),
        script: run.output?.script ?? null,
        scriptMeta: run.output?.scriptMeta ?? null,
        qa: run.output?.qa ?? null,
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
        embed: run.output
          ? `<a href="${publicUrl.replace(/\/$/, '')}/f/${run.id}"><img src="${publicUrl.replace(/\/$/, '')}/f/${run.id}/preview.gif" width="480" alt="A 30-second video made for ${run.output.company}"></a>`
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
      if (!existsSync(join(filmsDir, req.params.id, req.params.name))) {
        return reply
          .status(404)
          .send({ error: { code: 'not_ready', message: 'file not rendered yet' } })
      }
      return reply.sendFile(`${req.params.id}/${req.params.name}`)
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
      const r = await retryRun(sql, req.params.id)
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
    '/v1/films/:id/cancel',
    { schema: { tags: ['films'], params: z.object({ id: RunId }) } },
    async (req, reply) => {
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
        select * from runs where agent = 'film' and input->>'batch' = ${req.params.id} order by (input->>'ref')::int`
      const base = publicUrl.replace(/\/$/, '')
      const cell = (s: unknown) => {
        const v = s == null ? '' : String(s)
        return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
      }
      const lines = [
        'url,company,status,share_url,gif_url,video_url,email_snippet',
        ...rows.map((r) => {
          const d = filmDto(r, publicUrl)
          const share = d.share ?? ''
          const gif = d.share ? `${share}/preview.gif` : ''
          const video =
            d.share && r.output ? `${share}/${r.output.files.film.split('/').pop()}` : ''
          const snippet = d.share
            ? `<a href="${share}"><img src="${gif}" width="480" alt="A video made for ${d.company}"></a>`
            : ''
          return [r.input.url, d.company, d.status, share, gif, video, snippet].map(cell).join(',')
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
    { schema: { tags: ['ops'], summary: 'Film counts and render throughput' } },
    async () => {
      const [counts, perf] = await Promise.all([
        sql<
          { status: string; n: number }[]
        >`select status, count(*)::int as n from runs where agent = 'film' group by status`,
        sql<{ n: number; avg: number | null; recovered: number }[]>`
        select count(*)::int as n,
          avg(extract(epoch from completed_at - created_at))::float8 as avg,
          (select count(distinct run_id)::int from run_log l where l.kind = 'worker_lost') as recovered
        from runs where agent = 'film' and status = 'succeeded'`,
      ])
      return {
        films: Object.fromEntries(counts.map((c) => [c.status, c.n])),
        avgSecondsPerFilm: perf[0]?.avg ? Math.round(perf[0].avg) : null,
        recoveredFromCrashes: perf[0]?.recovered ?? 0,
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
      return sharePage(run.input, run.output, `${publicUrl.replace(/\/$/, '')}/f/${run.id}`)
    },
  )

  app.get(
    '/f/:id/:name',
    { schema: { hide: true, params: z.object({ id: RunId, name: z.string() }) } },
    async (req, reply) => {
      if (!PUBLIC_FILES.test(req.params.name)) return reply.status(404).send('not found')
      const [ok] =
        await sql`select 1 from runs where id = ${req.params.id} and agent = 'film' and status = 'succeeded'`
      if (!ok || !existsSync(join(filmsDir, req.params.id, req.params.name)))
        return reply.status(404).send('not found')
      reply.header('cache-control', 'public, max-age=86400')
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
      const profile = await resolveProfile({})
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
  return app
}
