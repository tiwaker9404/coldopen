import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { OpenAICompatibleProvider, rateLimitWait } from '../../src/llm/openai.ts'

describe('rate limits on free tiers', () => {
  it('reads how long Groq says to wait', () => {
    const groq =
      '{"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` ... on tokens per minute (TPM): Limit 8000, Used 6422, Requested 2928. Please try again in 10.125s. Need more tokens?"}}'
    expect(rateLimitWait(null, groq)).toBe(10_375)
    expect(rateLimitWait(null, 'Please try again in 1m30.5s.')).toBe(90_750)
    expect(rateLimitWait(null, 'try again in 450ms')).toBe(700)
    expect(rateLimitWait('3', '')).toBe(3250)
    expect(rateLimitWait(null, 'daily limit reached')).toBeNull()
  })

  it('waits it out and carries on, instead of failing the film', async () => {
    let calls = 0
    const server = createServer((_req, res) => {
      calls++
      if (calls === 1) {
        res.writeHead(429, { 'content-type': 'application/json' })
        res.end('{"error":{"message":"Please try again in 0.2s."}}')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const llm = new OpenAICompatibleProvider({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'm',
      apiKey: 'k',
      timeoutMs: 5000,
    })
    const started = Date.now()
    const r = await llm.complete({ messages: [{ role: 'user', content: 'hi' }], json: true })
    server.close()
    expect(r.text).toBe('{"ok":true}')
    expect(calls).toBe(2)
    expect(Date.now() - started).toBeGreaterThanOrEqual(400)
  })

  it('gives up on a limit with no end in sight, so the fallback model can step in', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(
        '{"error":{"message":"Rate limit reached on requests per day (RPD). Please try again in 7h12m."}}',
      )
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const llm = new OpenAICompatibleProvider({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'm',
      apiKey: 'k',
      timeoutMs: 5000,
    })
    await expect(
      llm.complete({ messages: [{ role: 'user', content: 'hi' }], json: true }),
    ).rejects.toThrow(/429/)
    server.close()
  })
})
