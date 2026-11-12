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
      'find_targets',
      'follow_ups_due',
      'get_film',
      'list_films',
      'make_film',
      'rewrite_messages',
      'search_jobs',
      'set_recipient',
      'warm_leads_due',
    ])
    expect(tools.find((t) => t.name === 'search_jobs')?.annotations?.readOnlyHint).toBe(true)
    expect(tools.find((t) => t.name === 'make_film')?.annotations?.readOnlyHint).toBeUndefined()
    expect(tools.find((t) => t.name === 'find_targets')?.annotations?.readOnlyHint).toBe(true)
  })

  it('warm_leads_due is a thin call to Warm leads', async () => {
    const warm = {
      data: [{ next: { kind: 'thankYou', due: true }, draft: { subject: 's', body: 'b' } }],
      waiting: 1,
      nextDueAt: null,
      month: { conversations: 2 },
    }
    const { client, calls } = await connect({ 'GET /v1/warm': { status: 200, json: warm } })
    const { tools } = await client.listTools()
    expect(tools.find((t) => t.name === 'warm_leads_due')?.annotations?.readOnlyHint).toBe(true)
    const r = await client.callTool({ name: 'warm_leads_due', arguments: {} })
    expect(calls).toEqual([{ method: 'GET', url: '/v1/warm' }])
    expect(JSON.parse((r.content as { text: string }[])[0]!.text)).toEqual(warm)
    // an API error comes back as the tool's error, in the API's words
    const no = await connect({
      'GET /v1/warm': { status: 401, json: { error: { message: 'missing or invalid API key' } } },
    })
    const e = await no.client.callTool({ name: 'warm_leads_due', arguments: {} })
    expect(e.isError).toBe(true)
    expect((e.content as { text: string }[])[0]!.text).toBe('missing or invalid API key')
  })

  it('find_targets is a thin call to Network this week', async () => {
    const week = {
      data: [{ company: 'Anchor', reasons: ['6 people'] }],
      week: { made: 4, target: 10 },
    }
    const { client, calls } = await connect({ 'GET /v1/targets': { status: 200, json: week } })
    const r = await client.callTool({ name: 'find_targets', arguments: { limit: 5 } })
    expect(calls).toEqual([{ method: 'GET', url: '/v1/targets?limit=5' }])
    expect(JSON.parse((r.content as { text: string }[])[0]!.text)).toEqual(week)
  })

  it('rewrite_messages is a thin call to "Write it again", limits and errors included', async () => {
    const messages = { email: { subject: 's', body: 'b' }, rewrite: false }
    const ok = await connect({
      'POST /v1/films/run_1/messages/rewrite': { status: 200, json: messages },
    })
    const r = await ok.client.callTool({ name: 'rewrite_messages', arguments: { id: 'run_1' } })
    expect(ok.calls).toEqual([
      { method: 'POST', url: '/v1/films/run_1/messages/rewrite', body: {} },
    ])
    expect(JSON.parse((r.content as { text: string }[])[0]!.text)).toEqual(messages)
    const { tools } = await ok.client.listTools()
    expect(
      tools.find((t) => t.name === 'rewrite_messages')?.annotations?.readOnlyHint,
    ).toBeUndefined()

    // the route's own daily limit comes back as the tool's error, in its words
    const limit =
      "That's 10 rewrites today. The template drafts are still here, or come back tomorrow."
    const out = await connect({
      'POST /v1/films/run_1/messages/rewrite': {
        status: 429,
        json: { error: { code: 'daily_limit', message: limit } },
      },
    })
    const e = await out.client.callTool({ name: 'rewrite_messages', arguments: { id: 'run_1' } })
    expect(e.isError).toBe(true)
    expect((e.content as { text: string }[])[0]!.text).toBe(limit)
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

  it('find_founders says who to reach in groups, with the founders’ emails when there is a Hunter key', async () => {
    const id = 'run_01JABCDEFGHJKMNPQRSTVWXYZ0'
    const groups = [
      { id: 'founders', label: 'Founders', why: 'w', ask: 'a', searches: [{ url: 'u' }] },
    ]
    const people = { company: 'Acme', team: 4, groups, searches: [{ url: 'u' }], known: [] }
    const withKey = await connect({
      [`GET /v1/films/${id}/people`]: { status: 200, json: people },
      [`POST /v1/films/${id}/founders`]: {
        status: 200,
        json: { domain: 'acme.com', people: [{ name: 'Dana', email: 'dana@acme.com' }] },
      },
    })
    const got = await withKey.client.callTool({ name: 'find_founders', arguments: { id } })
    const body = JSON.parse((got.content as { text: string }[])[0]!.text)
    expect(body.groups).toEqual(groups)
    // the deprecated flat list stays out of the agent's answer
    expect(body.searches).toBeUndefined()
    expect(body.emails.people[0].email).toBe('dana@acme.com')

    const noKey = await connect({
      [`GET /v1/films/${id}/people`]: { status: 200, json: people },
      [`POST /v1/films/${id}/founders`]: {
        status: 409,
        json: { error: { message: 'Add your free Hunter key on your Profile page' } },
      },
    })
    const plain = await noKey.client.callTool({ name: 'find_founders', arguments: { id } })
    expect(plain.isError).toBeFalsy()
    const b2 = JSON.parse((plain.content as { text: string }[])[0]!.text)
    expect(b2.groups).toEqual(groups)
    expect(b2.emails).toBeNull()
    expect(b2.emailsNote).toMatch(/Hunter key/)
  })
})
