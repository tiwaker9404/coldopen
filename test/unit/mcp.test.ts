import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { buildMcp } from '../../src/api/mcp.ts'

async function connect(answers: Record<string, { status: number; json: unknown }>) {
  const calls: { method: string; url: string; body?: unknown }[] = []
  const mcp = buildMcp(async (method, url, body) => {
    calls.push({ method, url, ...(body !== undefined ? { body } : {}) })
    return answers[`${method} ${url.split('?')[0]}`] ?? { status: 200, json: { ok: true } }
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1.0.0' })
  await Promise.all([mcp.connect(a), client.connect(b)])
  return { client, calls }
}

describe('coldopen as an MCP server', () => {
  it('offers the tools an agent needs, read-only ones marked', async () => {
    const { client } = await connect({})
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      'call_brief',
      'draft_messages',
      'find_founders',
      'find_startups',
      'follow_ups_due',
      'get_film',
      'list_films',
      'make_film',
      'search_jobs',
      'set_recipient',
    ])
    expect(tools.find((t) => t.name === 'search_jobs')?.annotations?.readOnlyHint).toBe(true)
    expect(tools.find((t) => t.name === 'make_film')?.annotations?.readOnlyHint).toBeUndefined()
  })

  it('calls the REST API with what the agent asked, and passes its errors on', async () => {
    const { client, calls } = await connect({
      'POST /v1/films': { status: 429, json: { error: { message: 'No films left today' } } },
    })
    await client.callTool({
      name: 'search_jobs',
      arguments: { roles: ['Forward Deployed Engineer'], ycOnly: true, limit: 5 },
    })
    expect(calls[0]).toEqual({
      method: 'POST',
      url: '/v1/jobs/preview?limit=5',
      body: { roles: ['Forward Deployed Engineer'], ycOnly: true },
    })
    const made = await client.callTool({ name: 'make_film', arguments: { url: 'acme.com' } })
    expect(made.isError).toBe(true)
    expect(JSON.stringify(made.content)).toContain('No films left today')
  })

  it('saves the homework make_film and draft_messages bring, through the homework route', async () => {
    const id = 'run_01JABCDEFGHJKMNPQRSTVWXYZ0'
    const { client, calls } = await connect({
      'POST /v1/films': { status: 202, json: { id, status: 'queued' } },
    })
    const built = { url: 'https://github.com/me/sync', line: 'Syncs their rates into checkout' }
    await client.callTool({
      name: 'make_film',
      arguments: { url: 'acme.com', question: 'Who owns onboarding today?', built },
    })
    expect(calls.slice(-2)).toEqual([
      { method: 'POST', url: '/v1/films', body: { url: 'acme.com' } },
      {
        method: 'PUT',
        url: `/v1/films/${id}/homework`,
        body: { question: 'Who owns onboarding today?', built },
      },
    ])
    await client.callTool({
      name: 'draft_messages',
      arguments: { id, detail: 'the CSV export dropped every custom field' },
    })
    expect(calls.slice(-2)).toEqual([
      {
        method: 'PUT',
        url: `/v1/films/${id}/homework`,
        body: { detail: 'the CSV export dropped every custom field' },
      },
      { method: 'GET', url: `/v1/films/${id}/messages` },
    ])
    // without homework, draft_messages only reads
    const before = calls.length
    await client.callTool({ name: 'draft_messages', arguments: { id } })
    expect(calls.slice(before)).toEqual([{ method: 'GET', url: `/v1/films/${id}/messages` }])
  })
})
