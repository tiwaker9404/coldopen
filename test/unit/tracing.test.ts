import { InMemorySpanExporter } from '@opentelemetry/sdk-trace'
import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { LlmProvider } from '../../src/llm/types.ts'
import {
  carrier,
  inSpan,
  registerHttpTracing,
  startTracing,
  type Tracing,
  tracedLlm,
  traceId,
  withCarrier,
} from '../../src/tracing.ts'

const spans = new InMemorySpanExporter()
let tracing: Tracing | null = null

beforeAll(() => {
  tracing = startTracing('test', { exporter: spans, env: {} })
})
afterAll(async () => {
  await tracing?.shutdown()
})

describe('tracing', () => {
  it('is off without an endpoint', () => {
    expect(startTracing('x', { env: {} })).toBeNull()
  })

  it('gives each request a server span, continues the caller’s trace, and nests work in it', async () => {
    spans.reset()
    const app = Fastify()
    registerHttpTracing(app)
    app.get('/v1/things/:id', async () => {
      await inSpan('lookup', {}, async () => {})
      return { trace: traceId() }
    })
    const parent = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'
    const r = await app.inject({ url: '/v1/things/7', headers: { traceparent: parent } })
    expect(r.headers['x-trace-id']).toBe('0af7651916cd43dd8448eb211c80319c')
    expect(r.json().trace).toBe('0af7651916cd43dd8448eb211c80319c')
    const got = spans.getFinishedSpans()
    const server = got.find((s) => s.name === 'GET /v1/things/:id')!
    const inner = got.find((s) => s.name === 'lookup')!
    expect(server.attributes['http.response.status_code']).toBe(200)
    expect(server.attributes['http.route']).toBe('/v1/things/:id')
    expect(inner.parentSpanContext?.spanId).toBe(server.spanContext().spanId)
    await app.close()
  })

  it('records LLM calls with GenAI attributes', async () => {
    spans.reset()
    const fake: LlmProvider = {
      name: 'openai-compatible:gpt-oss-120b',
      complete: async () => ({
        text: 'hi',
        model: 'gpt-oss-120b',
        inputTokens: 12,
        outputTokens: 3,
        latencyMs: 5,
      }),
    }
    await tracedLlm(fake, 'api.groq.com').complete({ messages: [] })
    const [s] = spans.getFinishedSpans()
    expect(s!.name).toBe('chat gpt-oss-120b')
    expect(s!.attributes['gen_ai.usage.input_tokens']).toBe(12)
    expect(s!.attributes['server.address']).toBe('api.groq.com')
  })

  it('marks a failed span and rethrows', async () => {
    spans.reset()
    await expect(
      inSpan('boom', {}, async () => {
        throw new Error('no')
      }),
    ).rejects.toThrow('no')
    expect(spans.getFinishedSpans()[0]!.status.code).toBe(2)
  })

  it('carries a trace to another process (an API request to the run it queued)', async () => {
    spans.reset()
    let c: Record<string, string> = {}
    await inSpan('request', {}, async () => {
      c = carrier()
    })
    await withCarrier(c, () => inSpan('run film', {}, async () => {}))
    const [req, run] = [spans.getFinishedSpans()[0]!, spans.getFinishedSpans()[1]!]
    expect(run.spanContext().traceId).toBe(req.spanContext().traceId)
  })
})
