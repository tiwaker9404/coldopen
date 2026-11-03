import { resolve } from 'node:path'
import { buildApi } from './api/server.ts'
import { closeBrowser } from './browser.ts'
import { loadConfig } from './config.ts'
import { connect, migrate } from './db/index.ts'
import { createFilmAgent } from './film.ts'
import { buildLlm } from './llm/chain.ts'
import type { LlmProvider } from './llm/types.ts'
import { createLogger } from './logger.ts'
import { registry, Worker } from './runtime/worker.ts'
import { SlackClient } from './slack.ts'
import { startTracing } from './tracing.ts'

/**
 *   node src/main.ts migrate   apply schema migrations
 *   node src/main.ts api       HTTP API, dashboard, share pages, Slack events
 *   node src/main.ts worker    researches, writes and renders films (scale horizontally)
 *   node src/main.ts all       everything in one process
 *   node src/main.ts drain     render whatever is queued, then exit (a renderer that runs on
 *                              demand, e.g. a GitHub Actions job started by the hosted app)
 */
const role = process.argv[2] ?? 'all'
const cfg = loadConfig()
const log = createLogger(cfg.LOG_LEVEL, `coldopen:${role}`)
const tracing = startTracing(`coldopen-${role}`)
const sql = connect(cfg.DATABASE_URL, cfg.DB_POOL_SIZE)
const stoppers: (() => Promise<void>)[] = []

const llm: LlmProvider =
  cfg.LLM_PROVIDER === 'openai'
    ? buildLlm(
        { baseUrl: cfg.LLM_BASE_URL, model: cfg.LLM_MODEL, apiKey: cfg.LLM_API_KEY },
        cfg.LLM_FALLBACK_MODEL
          ? {
              model: cfg.LLM_FALLBACK_MODEL,
              baseUrl: cfg.LLM_FALLBACK_BASE_URL,
              apiKey: cfg.LLM_FALLBACK_API_KEY,
            }
          : null,
        cfg.LLM_TIMEOUT_MS,
        { gemini: cfg.GEMINI_API_KEY },
      )
    : {
        name: 'none',
        complete: () => Promise.reject(new Error('no LLM configured (set LLM_PROVIDER=openai)')),
      }
const slack = cfg.SLACK_BOT_TOKEN ? new SlackClient(cfg.SLACK_BOT_TOKEN) : null

async function main() {
  // a renderer may start before the web app ever has, on an empty database
  if (role === 'migrate' || role === 'all' || role === 'drain') {
    const applied = await migrate(sql, (m) => log.info(m))
    if (role === 'migrate') {
      log.info({ applied }, 'migrations complete')
      await sql.end()
      return
    }
  }
  if (!['api', 'worker', 'all', 'drain'].includes(role)) throw new Error(`unknown role "${role}"`)

  if (role === 'worker' || role === 'all' || role === 'drain') {
    const agents = registry(
      createFilmAgent({
        filmsDir: resolve(cfg.FILMS_DIR),
        llmModel: cfg.LLM_PROVIDER === 'openai' ? cfg.LLM_MODEL : null,
        slack,
        share:
          cfg.SHARE_URL && cfg.SHARE_TOKEN
            ? { url: cfg.SHARE_URL.replace(/\/$/, ''), token: cfg.SHARE_TOKEN }
            : null,
        publicUrl: cfg.PUBLIC_URL,
        allowPrivateNetworks: cfg.ALLOW_PRIVATE_NETWORKS,
        ...(cfg.RENDER_PAGES ? { renderPages: cfg.RENDER_PAGES } : {}),
      }) as never,
    )
    const worker = new Worker(sql, cfg, log, agents, llm)
    await worker.start()
    stoppers.push(() => worker.stop(60_000))
    stoppers.push(closeBrowser)
    if (role === 'drain') void drain(worker)
  }
  if (role === 'api' || role === 'all') {
    const app = await buildApi({
      sql,
      cfg,
      log,
      slack,
      llm: cfg.LLM_PROVIDER === 'openai' ? llm : null,
    })
    await app.listen({ port: cfg.PORT, host: cfg.HOST })
    stoppers.unshift(() => app.close())
  }
}

/**
 * On-demand rendering: keep working while anything is queued (or due soon, after a retry's
 * backoff) or running, then shut down. Two quiet checks in a row, so a film queued between
 * finishing one and checking isn't missed. A hard cap keeps a stuck queue from burning a
 * CI runner for hours; whatever is left is picked up by the next run.
 */
/**
 * A renderer started on demand (a GitHub Actions job): render until there's nothing left this
 * job could take, then exit. Films other jobs are rendering don't keep it running; a crashed
 * job's film (its lease ran out) and retries due soon do. Logs each film's step timings without
 * any film details, since the job's logs are public.
 */
async function drain(worker: Worker) {
  const started = new Date()
  const maxMs = Number(process.env.DRAIN_MAX_MINUTES ?? 50) * 60_000
  let quiet = 0
  while (!stopping) {
    await new Promise((r) => setTimeout(r, 5_000))
    const [row] = await sql<{ n: number }[]>`
      select count(*)::int as n from runs
      where (status = 'queued' and next_run_at <= now() + interval '5 minutes')
         or (status = 'running' and lease_expires_at < now())`
    quiet = worker.inFlight === 0 && (row?.n ?? 0) === 0 ? quiet + 1 : 0
    if (quiet >= 2 || Date.now() - started.getTime() > maxMs) {
      await logTimings(started, worker.id)
      log.info({ minutes: Math.round((Date.now() - started.getTime()) / 60_000) }, 'queue drained')
      return shutdown('drained')
    }
  }
}

/** "film: 82.4s from request to ready (research 6.2, script-1 9.8, render 37.0, encode 2.1, publish 3.0)" */
async function logTimings(since: Date, workerId: string) {
  try {
    const rows = await sql<{ id: string; total: number; key: string; ms: number }[]>`
      select r.id, extract(epoch from r.completed_at - r.created_at)::float8 as total,
        case when s.key like 'render:%' then 'render' else s.key end as key,
        -- elapsed time: scenes render side by side, so their durations don't add up
        (extract(epoch from max(s.completed_at) - min(s.started_at)) * 1000)::int as ms
      from runs r join steps s on s.run_id = r.id
      where r.agent = 'film' and r.status = 'succeeded' and r.completed_at >= ${since}
        and r.worker_id = ${workerId} and s.replays = 0
      group by 1, 2, 3 order by 1, min(s.seq)`
    const films = new Map<string, { total: number; parts: string[] }>()
    for (const r of rows) {
      const f = films.get(r.id) ?? { total: r.total, parts: [] }
      f.parts.push(`${r.key} ${(r.ms / 1000).toFixed(1)}`)
      films.set(r.id, f)
    }
    // stdout, not the logger: it's set to errors only on GitHub, and this holds no film details
    for (const f of films.values())
      console.log(`film: ${f.total.toFixed(1)}s from request to ready (${f.parts.join(', ')})`)
  } catch {
    // timings are a nice-to-have
  }
}

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  log.info({ signal }, 'shutting down')
  for (const stop of stoppers)
    await stop().catch((err) => log.error({ err }, 'shutdown step failed'))
  await tracing?.shutdown()
  await sql.end({ timeout: 5 })
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

main().catch((err) => {
  log.fatal({ err }, 'startup failed')
  process.exit(1)
})
