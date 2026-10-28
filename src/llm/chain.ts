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

/** One model, or a primary with a fallback when LLM_FALLBACK_MODEL is set. */
export function buildLlm(
  primary: ModelEndpoint,
  fallback: Partial<ModelEndpoint> | null,
  timeoutMs: number,
): LlmProvider {
  const first = new OpenAICompatibleProvider({ ...primary, timeoutMs })
  if (!fallback?.model) return first
  const second = new OpenAICompatibleProvider({
    baseUrl: fallback.baseUrl ?? 'http://localhost:11434/v1',
    model: fallback.model,
    apiKey: fallback.apiKey ?? 'ollama',
    timeoutMs,
  })
  return new ChainProvider([first, second])
}
