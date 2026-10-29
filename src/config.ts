import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().url().default('postgres://postgres@127.0.0.1:5432/coldopen'),
  API_KEYS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  PORT: z.coerce.number().int().default(8080),
  HOST: z.string().default('0.0.0.0'),
  /** public base URL used in share links (e.g. https://films.example.com) */
  PUBLIC_URL: z.string().default('http://localhost:8080'),
  /** Slack or Discord incoming webhook: posted to when someone starts watching a film */
  NOTIFY_WEBHOOK_URL: z.string().url().optional(),
  /** secret mixed into viewer hashes; set it so they can't be recomputed from public data */
  VIEW_SALT: z.string().default('coldopen-views'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),

  /** where films, frames and screenshots are written (shared volume if workers are on several hosts) */
  FILMS_DIR: z.string().default('./films'),

  /** films rendered at once per worker; each holds a Chromium page */
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  LEASE_MS: z.coerce.number().int().min(1000).default(60_000),
  RUN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  RETRY_BASE_MS: z.coerce.number().int().positive().default(5_000),
  RETRY_MAX_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 60 * 1000),
  EXECUTION_MODE: z.enum(['durable', 'naive']).default('durable'),

  /** none = deterministic writer (free, no model); openai = any OpenAI-compatible API (Ollama, Groq, OpenAI...) */
  LLM_PROVIDER: z.enum(['none', 'openai']).default('none'),
  LLM_BASE_URL: z.string().default('http://localhost:11434/v1'),
  LLM_MODEL: z.string().default('qwen2.5:7b'),
  LLM_API_KEY: z.string().default('ollama'),
  // optional second model, tried when the first is rate limited or down (e.g. Groq -> local Ollama)
  LLM_FALLBACK_MODEL: z.string().optional(),
  LLM_FALLBACK_BASE_URL: z.string().default('http://localhost:11434/v1'),
  LLM_FALLBACK_API_KEY: z.string().default('ollama'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),

  /** Slack app (optional): mention the bot with a URL, the film comes back in the thread */
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),

  /** let the research browser open localhost / private-network URLs. Only for local development. */
  ALLOW_PRIVATE_NETWORKS: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),

  CHAOS_KILL_AFTER_EFFECT: z.coerce.number().min(0).max(1).default(0),
})

export type Config = z.infer<typeof schema>

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid configuration: ${issues}`)
  }
  return parsed.data
}
