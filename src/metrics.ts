import { monitorEventLoopDelay } from 'node:perf_hooks'
import client from '@prometheus-io/client'
import type { Sql } from './db/index.ts'

export const registry = new client.Registry()
client.collectDefaultMetrics({ register: registry, prefix: 'coldopen_' })

export const executions = new client.Counter({
  name: 'coldopen_executions_total',
  help: 'Agent executions started (a resumed run is a new execution)',
  labelNames: ['agent', 'resumed'],
  registers: [registry],
})

export const outcomes = new client.Counter({
  name: 'coldopen_execution_outcomes_total',
  help: 'How executions ended',
  labelNames: ['agent', 'outcome'],
  registers: [registry],
})

export const replayedSteps = new client.Counter({
  name: 'coldopen_replayed_steps_total',
  help: 'Completed steps served from the journal instead of re-executed',
  registers: [registry],
})

export const llmCalls = new client.Counter({
  name: 'coldopen_llm_calls_total',
  help: 'LLM API calls actually made',
  registers: [registry],
})

export const llmTokens = new client.Counter({
  name: 'coldopen_llm_tokens_total',
  help: 'LLM tokens actually billed',
  labelNames: ['direction'],
  registers: [registry],
})

export const leasesReaped = new client.Counter({
  name: 'coldopen_leases_reaped_total',
  help: 'Runs recovered after their worker disappeared',
  registers: [registry],
})

export const leasesLost = new client.Counter({
  name: 'coldopen_leases_lost_total',
  help: 'Executions aborted because another worker took over the run',
  registers: [registry],
})

export const executionDuration = new client.Histogram({
  name: 'coldopen_execution_duration_seconds',
  help: 'Wall time of one execution (until it finished, suspended or failed)',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300],
  registers: [registry],
})

/**
 * Read from Postgres at scrape time so every replica reports the same truth. A second API in the
 * same process (a test that builds a hosted one beside the self-hosted one) takes the gauges over
 * rather than failing to register them twice.
 */
export function registerQueueGauges(sql: Sql): void {
  for (const name of ['coldopen_runs', 'coldopen_queue_lag_seconds'])
    registry.removeSingleMetric(name)
  new client.Gauge({
    name: 'coldopen_runs',
    help: 'Runs by status',
    labelNames: ['status'],
    registers: [registry],
    async collect() {
      const rows = await sql<{ status: string; n: number }[]>`
        select status, count(*)::int as n from runs group by status`
      this.reset()
      for (const r of rows) this.set({ status: r.status }, r.n)
    },
  })
  new client.Gauge({
    name: 'coldopen_queue_lag_seconds',
    help: 'Age of the oldest due-but-unclaimed run',
    registers: [registry],
    async collect() {
      const [row] = await sql<{ s: number | null }[]>`
        select coalesce(extract(epoch from now() - min(next_run_at)), 0)::float8 as s
        from runs where status = 'queued' and next_run_at <= now()`
      this.set(Math.max(0, row?.s ?? 0))
    },
  })
}

/**
 * How late the event loop ran, as the 99th percentile over the last 10 seconds. The hosted app
 * has 0.1 CPU, and Render restarts it when /healthz takes over 5 seconds, so anything that
 * holds the loop shows here first.
 */
export const eventLoopDelayP99 = new client.Gauge({
  name: 'coldopen_event_loop_delay_p99_ms',
  help: 'Event-loop delay, 99th percentile over the last 10 seconds, in milliseconds',
  registers: [registry],
})

interface WarnLog {
  warn(obj: object, msg: string): void
}

/**
 * Keeps the gauge current and logs a warning, with the routes in flight, whenever the loop was
 * held for longer than `warnMs`: the route in flight is usually the one that held it. Timers are
 * unref'd; the returned function stops them.
 */
export function watchEventLoop(opts: {
  log: WarnLog
  inFlight: () => string[]
  warnMs?: number
  windowMs?: number
}): () => void {
  const warnMs = opts.warnMs ?? 1000
  const h = monitorEventLoopDelay({ resolution: 20 })
  h.enable()
  const window = setInterval(() => {
    eventLoopDelayP99.set(h.count ? Math.round(h.percentile(99) / 1e6) : 0)
    h.reset()
  }, opts.windowMs ?? 10_000)
  // a timer that should fire every 250 ms: when it's late, the loop was held that long
  const every = 250
  let due = performance.now() + every
  const tick = setInterval(() => {
    const now = performance.now()
    const late = now - due
    due = now + every
    if (late > warnMs)
      opts.log.warn(
        { delayMs: Math.round(late), routes: opts.inFlight() },
        'event loop was blocked',
      )
  }, every)
  window.unref()
  tick.unref()
  return () => {
    clearInterval(window)
    clearInterval(tick)
    h.disable()
  }
}
