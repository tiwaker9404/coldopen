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

/**
 *   node src/main.ts migrate   apply schema migrations
 *   node src/main.ts api       HTTP API, dashboard, share pages, Slack events
 *   node src/main.ts worker    researches, writes and renders films (scale horizontally)
 *   node src/main.ts all       everything in one process
 */
const role = process.argv[2] ?? 'all'
const cfg = loadConfig()
const log = createLogger(cfg.LOG_LEVEL, `coldopen:${role}`)
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
      )
    : {
        name: 'none',
        complete: () => Promise.reject(new Error('no LLM configured (set LLM_PROVIDER=openai)')),
      }
const slack = cfg.SLACK_BOT_TOKEN ? new SlackClient(cfg.SLACK_BOT_TOKEN) : null

async function main() {
  if (role === 'migrate' || role === 'all') {
    const applied = await migrate(sql, (m) => log.info(m))
    if (role === 'migrate') {
      log.info({ applied }, 'migrations complete')
      await sql.end()
      return
    }
  }
  if (!['api', 'worker', 'all'].includes(role)) throw new Error(`unknown role "${role}"`)

  if (role === 'worker' || role === 'all') {
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
      }) as never,
    )
    const worker = new Worker(sql, cfg, log, agents, llm)
    await worker.start()
    stoppers.push(() => worker.stop(60_000))
    stoppers.push(closeBrowser)
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

let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  log.info({ signal }, 'shutting down')
  for (const stop of stoppers)
    await stop().catch((err) => log.error({ err }, 'shutdown step failed'))
  await sql.end({ timeout: 5 })
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

main().catch((err) => {
  log.fatal({ err }, 'startup failed')
  process.exit(1)
})
