import { NonRetryableError } from '../runtime/errors.ts'
import { LlmHttpError, OpenAICompatibleProvider } from './openai.ts'
import type { LlmProvider, LlmRequest, LlmResponse } from './types.ts'

/**
 * Free tiers run out (Groq's is about 1,000 requests a day per model). A chain tries each
 * provider in order and moves on when one is rate limited, down, unreachable or misconfigured,
 * so a 500-prospect batch keeps going on the next free provider or a local model.
 */
export class ChainProvider implements LlmProvider {
  readonly name: string
  readonly #providers: LlmProvider[]
  /** providers that failed with a permanent error (bad key, unknown model) are skipped */
  readonly #dead = new Set<number>()

  constructor(providers: LlmProvider[]) {
    if (!providers.length) throw new Error('a chain needs at least one provider')
    this.#providers = providers
    this.name = providers.map((p) => p.name).join(' -> ')
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    let first: unknown = null
    for (const [i, p] of this.#providers.entries()) {
      if (this.#dead.has(i)) continue
      try {
        return await p.complete(req)
      } catch (err) {
        if (req.signal?.aborted) throw err
        first ??= err
        if (err instanceof NonRetryableError) this.#dead.add(i)
        else if (!(err instanceof LlmHttpError) && !isNetworkError(err)) throw err
      }
    }
    throw first
  }
}

function isNetworkError(err: unknown): boolean {
  return (
    err instanceof TypeError ||
    (err instanceof Error &&
      /fetch failed|ECONNREFUSED|ENOTFOUND|timeout|aborted/i.test(err.message))
  )
}

export interface ModelEndpoint {
  baseUrl: string
  model: string
  apiKey: string
}

/**
 * One model, or a primary with fallbacks. LLM_FALLBACK_MODEL may list several, comma
 * separated, tried in order. A name with a slash ("openai/gpt-oss-20b") is served by the
 * primary's endpoint, so a second Groq model with its own rate limit needs no extra setup; a
 * name without one ("qwen2.5:7b") is a local Ollama model, unless LLM_FALLBACK_BASE_URL says
 * otherwise.
 */
export function buildLlm(
  primary: ModelEndpoint,
  fallback: Partial<ModelEndpoint> | null,
  timeoutMs: number,
): LlmProvider {
  const names = (fallback?.model ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  const endpoints: ModelEndpoint[] = [
    primary,
    ...names.map((model) => {
      const local = !model.includes('/')
      const customUrl = fallback?.baseUrl && fallback.baseUrl !== OLLAMA
      return {
        model,
        baseUrl: customUrl ? fallback.baseUrl! : local ? OLLAMA : primary.baseUrl,
        apiKey: customUrl || local ? (fallback?.apiKey ?? 'ollama') : primary.apiKey,
      }
    }),
  ]
  const providers = endpoints.map(
    (e, i) =>
      new OpenAICompatibleProvider({
        ...e,
        timeoutMs,
        // with somewhere to go next, move on quickly; the last option waits as long as it takes
        maxRateWaitMs: i < endpoints.length - 1 ? 20_000 : 300_000,
      }),
  )
  return providers.length === 1 ? providers[0]! : new ChainProvider(providers)
}

const OLLAMA = 'http://localhost:11434/v1'
