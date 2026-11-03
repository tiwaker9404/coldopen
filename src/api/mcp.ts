import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { Sql } from '../db/index.ts'
import { TOKEN_PREFIX, tokenOwner } from './tokens.ts'

/**
 * coldopen as an MCP server, at POST /mcp: Claude, Cursor, ChatGPT or any MCP client can search
 * jobs and YC startups, make films, draft the messages and see what's due, as the person whose
 * access token it sends. Every tool calls the REST API with that token, so limits, ownership and
 * checks are exactly the app's. Stateless: each request gets its own server.
 */

type Call = (
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  body?: unknown,
) => Promise<{ status: number; json: unknown }>

const text = (v: unknown) => ({
  content: [
    { type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) },
  ],
})
const fail = (message: string) => ({ ...text(message), isError: true })

/** The REST answer, or an MCP error carrying the API's own message */
async function answer(call: Call, method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  const r = await call(method, url, body)
  if (r.status >= 400) {
    const e = (r.json as { error?: { message?: string } } | null)?.error?.message
    return fail(e ?? `coldopen answered HTTP ${r.status}`)
  }
  return text(r.json)
}

export function buildMcp(call: Call): McpServer {
  const mcp = new McpServer(
    { name: 'coldopen', version: '1.0.0' },
    {
      instructions:
        'coldopen finds open roles and YC startups, makes a 30-second film for a company in its own brand (from its website or a job post), drafts the email and LinkedIn note that go with it, finds founders’ emails, and tracks follow-ups. A film takes about a minute and a half: make_film returns its id, then get_film shows when it is ready and its share link. Nothing is ever sent for the person; drafts are for them to send.',
    },
  )

  mcp.registerTool(
    'search_jobs',
    {
      title: 'Search open roles',
      description:
        'Open roles from 450+ companies’ public job boards (about 400 of them YC startups), ranked by how well they fit the person’s profile. Leave a field out to use their saved search. Each role has its company, link, pay when listed, fit, YC batch and H-1B sponsorship.',
      inputSchema: {
        roles: z
          .array(z.string())
          .max(8)
          .optional()
          .describe('job titles, e.g. "Forward Deployed Engineer"'),
        locations: z
          .array(z.string())
          .max(8)
          .optional()
          .describe('cities or regions, e.g. "Bay Area"'),
        levels: z
          .array(z.enum(['intern', 'entry', 'mid', 'senior', 'lead', 'director']))
          .optional(),
        types: z.array(z.enum(['full_time', 'part_time', 'contract', 'intern'])).optional(),
        workplaces: z.array(z.enum(['remote', 'hybrid', 'onsite'])).optional(),
        within: z.enum(['any', 'day', '3days', 'week', 'month']).optional(),
        ycOnly: z.boolean().optional(),
        visaOnly: z.boolean().optional().describe('only companies that sponsor H-1B visas'),
        minPay: z.number().int().optional().describe('yearly, in dollars'),
        limit: z.number().int().min(1).max(30).default(10),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ limit, ...search }) => {
      const body = Object.fromEntries(Object.entries(search).filter(([, v]) => v !== undefined))
      return answer(call, 'POST', `/v1/jobs/preview?limit=${limit}`, body)
    },
  )

  mcp.registerTool(
    'find_startups',
    {
      title: 'Find YC startups',
      description:
        'Active YC startups, hiring or not, newest batch first: for reaching founders before a role is posted. Each links its YC page, which names the founders.',
      inputSchema: {
        q: z
          .string()
          .max(80)
          .optional()
          .describe('words in the name or one-liner, e.g. "payments"'),
        industry: z.string().max(60).optional(),
        since: z.number().int().optional().describe('batches from this year on'),
        maxTeam: z.number().int().optional(),
        hiring: z.enum(['any', 'hiring', 'quiet']).default('any'),
        limit: z.number().int().min(1).max(30).default(10),
      },
      annotations: { readOnlyHint: true },
    },
    async (a) => {
      const p = new URLSearchParams()
      for (const [k, v] of Object.entries(a)) if (v !== undefined) p.set(k, String(v))
      return answer(call, 'GET', `/v1/startups?${p}`)
    },
  )

  mcp.registerTool(
    'make_film',
    {
      title: 'Make a film',
      description:
        'Starts a 30-second film for a company, in its brand, from its website or a job post link. Returns the film’s id; it takes about a minute and a half. Uses one of the person’s films for today.',
      inputSchema: {
        url: z.string().describe('the company’s website, or a job post link'),
        jobUrl: z.string().optional().describe('a job post the film should answer'),
      },
    },
    async ({ url, jobUrl }) =>
      answer(call, 'POST', '/v1/films', { url, ...(jobUrl ? { job: { url: jobUrl } } : {}) }),
  )

  mcp.registerTool(
    'get_film',
    {
      title: 'Get a film',
      description:
        'A film’s status (queued, running, succeeded, failed), its share link once ready, who it’s for and how far views got.',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => answer(call, 'GET', `/v1/films/${encodeURIComponent(id)}`),
  )

  mcp.registerTool(
    'list_films',
    {
      title: 'List films',
      description:
        'The person’s films, newest first, with where each stands: not sent, sent, replied, interview.',
      inputSchema: { limit: z.number().int().min(1).max(50).default(20) },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => answer(call, 'GET', `/v1/films?limit=${limit}`),
  )

  mcp.registerTool(
    'draft_messages',
    {
      title: 'Draft the messages',
      description:
        'The email (with subject), LinkedIn note, follow-ups and intro request that go with a finished film, plus checks on the email: under 125 words, subject about them, the person’s own detail, one ask. Nothing is sent.',
      inputSchema: { id: z.string().describe('the film’s id') },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => answer(call, 'GET', `/v1/films/${encodeURIComponent(id)}/messages`),
  )

  mcp.registerTool(
    'find_founders',
    {
      title: 'Find founders’ emails',
      description:
        'For a film’s company: its founders and executives with their work emails, from one Hunter search with the person’s own Hunter key.',
      inputSchema: { id: z.string().describe('the film’s id') },
    },
    async ({ id }) => answer(call, 'POST', `/v1/films/${encodeURIComponent(id)}/founders`, {}),
  )

  mcp.registerTool(
    'set_recipient',
    {
      title: 'Say who a film is for',
      description:
        'Saves who the film goes to, so the drafts greet them by name and open addressed.',
      inputSchema: {
        id: z.string().describe('the film’s id'),
        name: z.string(),
        email: z.string().optional(),
      },
    },
    async ({ id, name, email }) =>
      answer(call, 'PUT', `/v1/films/${encodeURIComponent(id)}/recipient`, {
        name,
        ...(email ? { email } : {}),
      }),
  )

  mcp.registerTool(
    'follow_ups_due',
    {
      title: 'Follow-ups due',
      description: 'Sent films due a follow-up today, each with the follow-up written.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => answer(call, 'GET', '/v1/followups'),
  )

  mcp.registerTool(
    'call_brief',
    {
      title: 'Brief for a call',
      description:
        'Once they reply: what the company says it does, facts worth knowing, where the person fits the role, what to prepare and three questions to ask.',
      inputSchema: { id: z.string().describe('the film’s id') },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => answer(call, 'GET', `/v1/films/${encodeURIComponent(id)}/brief`),
  )

  return mcp
}

/** POST /mcp, authenticated by a personal access token (or an API key on a private install) */
export function registerMcp(app: FastifyInstance, sql: Sql, apiKeyOk: (token: string) => boolean) {
  app.post('/mcp', { schema: { hide: true } }, async (req, reply) => {
    const h = req.headers.authorization ?? ''
    const token = h.startsWith('Bearer ') ? h.slice(7) : ''
    const ok = token.startsWith(TOKEN_PREFIX) ? !!(await tokenOwner(sql, token)) : apiKeyOk(token)
    if (!ok)
      return reply.status(401).send({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'Send a coldopen access token: Profile → Use coldopen from Claude or Cursor',
        },
        id: null,
      })
    const call: Call = async (method, url, body) => {
      const r = await app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
      })
      let json: unknown = null
      try {
        json = r.json()
      } catch {
        json = r.body
      }
      return { status: r.statusCode, json }
    }
    const mcp = buildMcp(call)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    reply.hijack()
    reply.raw.on('close', () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport)
    await transport.handleRequest(req.raw, reply.raw, req.body)
  })
  const notHere = { jsonrpc: '2.0', error: { code: -32000, message: 'Use POST' }, id: null }
  app.get('/mcp', { schema: { hide: true } }, async (_req, reply) =>
    reply.status(405).send(notHere),
  )
  app.delete('/mcp', { schema: { hide: true } }, async (_req, reply) =>
    reply.status(405).send(notHere),
  )
}
