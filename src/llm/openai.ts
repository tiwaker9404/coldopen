import { NonRetryableError } from '../runtime/errors.ts'
import { estimateTokens, type LlmProvider, type LlmRequest, type LlmResponse } from './types.ts'

/**
 * Any OpenAI-compatible chat completions API: Ollama (free, local), OpenAI, Groq,
 * Together, vLLM, LM Studio... Point LLM_BASE_URL at it and set LLM_MODEL.
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly name: string
  readonly #baseUrl: string
  readonly #model: string
  readonly #apiKey: string
  readonly #timeoutMs: number

  constructor(opts: { baseUrl: string; model: string; apiKey: string; timeoutMs: number }) {
    this.#baseUrl = opts.baseUrl.replace(/\/$/, '')
    this.#model = opts.model
    this.#apiKey = opts.apiKey
    this.#timeoutMs = opts.timeoutMs
    this.name = `openai-compatible:${opts.model}`
  }

  /** set after the endpoint rejects a json_schema response_format once */
  #schemaUnsupported = false

  #format(req: LlmRequest, strict: boolean): Record<string, unknown> {
    if (req.schema && strict)
      return {
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'reply', strict: true, schema: req.schema },
        },
      }
    return req.json ? { response_format: { type: 'json_object' } } : {}
  }

  async complete(
    req: LlmRequest,
    strict = Boolean(req.schema) && !this.#schemaUnsupported,
    waited = 0,
  ): Promise<LlmResponse> {
    const started = performance.now()
    const signal = req.signal
      ? AbortSignal.any([req.signal, AbortSignal.timeout(this.#timeoutMs)])
      : AbortSignal.timeout(this.#timeoutMs)
    const res = await fetch(`${this.#baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify({
        model: this.#model,
        messages: req.messages,
        temperature: req.temperature ?? 0,
        ...this.#format(req, strict),
      }),
      signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status === 400 && strict) {
        // Groq: the constrained decode occasionally fails validation; retry once as plain JSON.
        // Anything else at 400 with a schema attached means this endpoint doesn't support
        // structured outputs: remember that and stop sending them.
        if (!/json_validate_failed/.test(body)) this.#schemaUnsupported = true
        return this.complete(req, false, waited)
      }
      // free tiers cap tokens per minute and say how long to wait ("try again in 10.1s").
      // Waiting that long beats failing the film; past two minutes in total, give up and let
      // the fallback model (if any) take over.
      if (res.status === 429) {
        const wait = rateLimitWait(res.headers.get('retry-after'), body)
        if (wait !== null && waited + wait <= 120_000) {
          await sleep(wait, req.signal)
          return this.complete(req, strict, waited + wait)
        }
      }
      const err = new LlmHttpError(res.status, body.slice(0, 500))
      if (err.retryable) throw err
      // a wrong model name or key fails the same way every time: stop, and say what to fix
      const hint =
        res.status === 404
          ? ` (check the model name; list what this endpoint serves with: curl ${this.#baseUrl}/models -H "Authorization: Bearer $LLM_API_KEY")`
          : res.status === 401 || res.status === 403
            ? ' (check LLM_API_KEY)'
            : ''
      throw new NonRetryableError(`${err.message}${hint}`)
    }
    const data = (await res.json()) as {
      model?: string
      choices: { message: { content: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const text = data.choices[0]?.message.content ?? ''
    return {
      text,
      model: data.model ?? this.#model,
      inputTokens:
        data.usage?.prompt_tokens ?? estimateTokens(req.messages.map((m) => m.content).join('\n')),
      outputTokens: data.usage?.completion_tokens ?? estimateTokens(text),
      latencyMs: Math.round(performance.now() - started),
    }
  }
}

export class LlmHttpError extends Error {
  readonly status: number
  constructor(status: number, body: string) {
    super(`LLM API returned HTTP ${status}: ${body}`)
    this.status = status
  }
  /** 429 and 5xx are worth retrying; 4xx (bad model name, auth) are not */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500
  }
}

/** How long a 429 asks us to wait, in ms (plus a little slack), or null if it doesn't say. */
export function rateLimitWait(retryAfter: string | null, body: string): number | null {
  const header = retryAfter ? Number.parseFloat(retryAfter) : Number.NaN
  if (Number.isFinite(header) && header >= 0) return Math.ceil(header * 1000) + 250
  const m = body.match(/try again in\s+(?:(\d+)m)?\s*([\d.]+)\s*(ms|s)\b/i)
  if (!m) return null
  const mins = m[1] ? Number(m[1]) * 60_000 : 0
  const n = Number.parseFloat(m[2]!)
  return Math.ceil(mins + (m[3] === 'ms' ? n : n * 1000)) + 250
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}
