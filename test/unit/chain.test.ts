import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildLlm, ChainProvider } from '../../src/llm/chain.ts'
import { OpenAICompatibleProvider } from '../../src/llm/openai.ts'
import type { LlmProvider } from '../../src/llm/types.ts'
import { callModel } from '../../src/runtime/context.ts'

/** A fake OpenAI-compatible endpoint whose behaviour is picked by the model name. */
let server: Server
let base = ''
const calls: { model: string; format?: string; body: Record<string, unknown> }[] = []

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    const r = JSON.parse(body)
    calls.push({ model: r.model, format: r.response_format?.type, body: r })
    res.setHeader('content-type', 'application/json')
    if (r.model === 'missing') {
      res.statusCode = 404
      return res.end('{"error":{"message":"model not found"}}')
    }
    if (r.model === 'limited' || r.model === 'openai/gpt-oss-limited') {
      res.statusCode = 429
      return res.end('{"error":{"message":"rate limit"}}')
    }
    if (r.model === 'old-server' && r.response_format?.type === 'json_schema') {
      res.statusCode = 400
      return res.end('{"error":{"message":"response_format json_schema is not supported"}}')
    }
    const content = JSON.stringify({ answer: `from ${r.model}` })
    return res.end(JSON.stringify({ model: r.model, choices: [{ message: { content } }] }))
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
})
afterAll(() => server.close())

const Answer = z.object({ answer: z.string() })
const ask = (p: LlmProvider) =>
  callModel(
    p,
    { schema: Answer, messages: [{ role: 'user', content: 'hi' }] },
    new AbortController().signal,
  )
const provider = (model: string, baseUrl = base) =>
  new OpenAICompatibleProvider({ baseUrl, model, apiKey: 'k', timeoutMs: 5000 })

describe('model providers', () => {
  it('lists several fallbacks; Groq-style names reuse the primary endpoint', async () => {
    calls.length = 0
    const llm = buildLlm(
      { baseUrl: base, model: 'openai/gpt-oss-limited', apiKey: 'k' },
      // "missing" has no slash: a local Ollama model, which isn't running here, so it's skipped
      { model: 'openai/gpt-oss-20b, missing-local' },
      5000,
    )
    expect((await ask(llm)).value).toEqual({ answer: 'from openai/gpt-oss-20b' })
    expect(calls.map((c) => c.model)).toEqual(['openai/gpt-oss-limited', 'openai/gpt-oss-20b'])
  })

  it('keeps gpt-oss requests small enough for a free tier', async () => {
    calls.length = 0
    await ask(provider('openai/gpt-oss-120b'))
    expect(calls[0]!.body).toMatchObject({
      reasoning_effort: 'low',
      include_reasoning: false,
      max_completion_tokens: 1500,
    })
    calls.length = 0
    await ask(provider('qwen2.5:7b'))
    expect(calls[0]!.body.reasoning_effort).toBeUndefined()
  })

  it('moves to the fallback when the first provider is rate limited', async () => {
    const llm = buildLlm(
      { baseUrl: base, model: 'limited', apiKey: 'k' },
      { baseUrl: base, model: 'local', apiKey: 'k' },
      5000,
    )
    expect((await ask(llm)).value).toEqual({ answer: 'from local' })
  })

  it('stops calling a misconfigured provider after its first failure', async () => {
    calls.length = 0
    const chain = new ChainProvider([provider('missing'), provider('local')])
    await ask(chain)
    await ask(chain)
    expect(calls.filter((c) => c.model === 'missing')).toHaveLength(1)
  })

  it('uses strict structured outputs, and downgrades once on servers without them', async () => {
    calls.length = 0
    const p = provider('old-server')
    expect((await ask(p)).value).toEqual({ answer: 'from old-server' })
    await ask(p)
    expect(calls.map((c) => c.format)).toEqual(['json_schema', 'json_object', 'json_object'])
  })
})
