import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeBrowser } from '../../src/browser.ts'
import { OpenAICompatibleProvider } from '../../src/llm/openai.ts'
import { LocalContext } from '../../src/runtime/local.ts'
import { checkScript } from '../../src/script/checks.ts'
import { ScriptSchema } from '../../src/script/types.ts'
import { writeScript } from '../../src/script/writer.ts'
import { fixtureServer, kitFor, profile } from '../helpers/index.ts'

/**
 * The model path end to end through the real OpenAI-compatible client, against a fake
 * server that behaves like a typical small model: first draft breaks the taste rules (and
 * wraps JSON in a code fence), the revision fixes them.
 */
let server: Server
let base = ''
const requests: { messages: { role: string; content: string }[]; response_format?: unknown }[] = []

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    const parsed = JSON.parse(body)
    if (parsed.model === 'retired-model') {
      missingCalls++
      res.statusCode = 404
      res.end(JSON.stringify({ error: { code: 'model_not_found' } }))
      return
    }
    requests.push(parsed)
    const user = parsed.messages.find((m: { role: string }) => m.role === 'user').content as string
    const factId = user.match(/^(f\d+) \[stat\]/m)?.[1] ?? 'f1'
    const draft = {
      hook: 'Hey Northwind!!',
      noticed: 'Your innovative platform cut late deliveries 52% this year.',
      insight: { factId, why: 'Tessellate shows which shippers stay after that drop.' },
      pitch: {
        headline: 'Revolutionize retention',
        points: ['See which features keep shippers', 'Ask in plain English'],
      },
      proof: [0, 1],
      cta: 'Worth a 15-minute look?',
    }
    const fixed = {
      ...draft,
      hook: 'Hi Northwind Freight team',
      noticed: 'Northwind promises every pallet is visible before it is late.',
      pitch: { ...draft.pitch, headline: 'Know which features keep your shippers' },
    }
    const content =
      requests.length === 1 ? `\`\`\`json\n${JSON.stringify(draft)}\n\`\`\`` : JSON.stringify(fixed)
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        model: 'fake-7b',
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 900, completion_tokens: 120 },
      }),
    )
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
})

afterAll(async () => {
  server.close()
  await closeBrowser()
  ;(await fixtureServer()).close()
})

let missingCalls = 0

describe('model-written scripts', () => {
  it('stops at once, with a hint, when the model name is wrong', async () => {
    const llm = new OpenAICompatibleProvider({
      baseUrl: base,
      model: 'retired-model',
      apiKey: 'k',
      timeoutMs: 5000,
    })
    const ctx = new LocalContext({ runId: 'run_missing_model', llm })
    await expect(
      ctx.llm('script-1', { schema: ScriptSchema, messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/check the model name/)
    expect(missingCalls).toBe(1)
  })

  it('critiques, revises and journals every draft', async () => {
    const { kit } = await kitFor('northwind')
    const p = profile('sales')
    const llm = new OpenAICompatibleProvider({
      baseUrl: base,
      model: 'fake-7b',
      apiKey: 'k',
      timeoutMs: 5000,
    })
    const ctx = new LocalContext({ runId: 'run_llm', llm })
    const { script, meta } = await writeScript({
      kit,
      profile: p,
      model: 'fake-7b',
      complete: (key, messages) => ctx.llm(key, { schema: ScriptSchema, messages }),
    })

    expect(meta.rounds).toBe(2)
    expect(meta.usedFallback).toBe(false)
    const first = meta.violations[0]!.join('\n')
    expect(first).toContain('"52%"') // invented number caught
    expect(first).toContain('banned phrase "innovative"')
    expect(first).toContain('exclamation')
    expect(checkScript(script, kit, p)).toEqual([])
    expect(script.hook).toBe('Hi Northwind Freight team')

    // the revision request quotes the exact violations back to the model
    const revision = requests[1]!.messages.at(-1)!.content
    expect(revision).toContain('Fix every problem below')
    expect(revision).toContain('"52%"')
    expect(requests[0]!.response_format).toEqual({ type: 'json_object' })
  })
})
