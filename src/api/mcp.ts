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

/** A REST response as the tool's result, or an MCP error carrying the API's own message */
function result(r: { status: number; json: unknown }) {
  if (r.status >= 400) {
    const e = (r.json as { error?: { message?: string } } | null)?.error?.message
    return fail(e ?? `coldopen answered HTTP ${r.status}`)
  }
  return text(r.json)
}

/** The REST answer, or an MCP error carrying the API's own message */
async function answer(call: Call, method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown) {
  return result(await call(method, url, body))
}

/** a film's homework, as make_film and draft_messages take it; PUT /v1/films/:id/homework checks it */
const homework = {
  detail: z
    .string()
    .optional()
    .describe(
      'something only someone who used their product would notice, in the person’s words (10-240 characters); the email opens with it',
    ),
  question: z
    .string()
    .optional()
    .describe('the person’s own question for these people (10-200 characters)'),
  built: z
    .object({
      url: z.string().describe('starts with https://'),
      line: z.string().describe('one line on what it is (3-120 characters)'),
    })
    .optional()
    .describe('something small the person built with their product'),
}
type Homework = { detail?: string; question?: string; built?: { url: string; line: string } }

/** the homework fields that were given, or null when none were */
const given = (h: Homework) => {
  const body = Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined))
  return Object.keys(body).length ? body : null
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
        raisedOnly: z
          .boolean()
          .optional()
          .describe('only companies that raised a private round (SEC Form D) in the last 3 months'),
        raisedSize: z
          .enum(['any', 'seed', 'a', 'b', 'c'])
          .optional()
          .describe(
            'with raisedOnly, the round size: seed under $3M, a $3-20M, b $20-80M, c $80M and up',
          ),
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
        'Active YC startups, hiring or not, newest batch first: for reaching founders before a role is posted. hiring "yc-only" finds the ones whose roles are only on YC’s Work at a Startup, not in search_jobs. Each links its YC page, which names the founders.',
      inputSchema: {
        q: z
          .string()
          .max(80)
          .optional()
          .describe('words in the name or one-liner, e.g. "payments"'),
        industry: z.string().max(60).optional(),
        since: z.number().int().optional().describe('batches from this year on'),
        maxTeam: z.number().int().optional(),
        hiring: z.enum(['any', 'hiring', 'yc-only', 'quiet']).default('any'),
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
    'find_targets',
    {
      title: 'Companies worth a warm message this week',
      description:
        'Network this week: the companies most worth a film and a warm message now for the roles the person wants, whether or not they have an opening today, each with the plain reasons it’s on the list (team size, a recent round, a matching role, people they know there, what they do). Leaves out companies filmed or messaged in the last 60 days, ones they hid and their current employer. `week` is films made this week against the 10-a-week target. Make one with make_film and the company’s site.',
      inputSchema: { limit: z.number().int().min(1).max(30).default(10) },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => answer(call, 'GET', `/v1/targets?limit=${limit}`),
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
        jobText: z
          .string()
          .optional()
          .describe(
            'the job post’s description, pasted; needed for LinkedIn, Indeed and Glassdoor posts, which need a login (then url is the company’s website)',
          ),
        ...homework,
      },
    },
    async ({ url, jobUrl, jobText, detail, question, built }) => {
      const hw = given({ detail, question, built })
      const r = await call('POST', '/v1/films', {
        url,
        ...(jobUrl || jobText
          ? { job: { ...(jobUrl ? { url: jobUrl } : {}), ...(jobText ? { text: jobText } : {}) } }
          : {}),
      })
      if (r.status >= 400 || !hw) return result(r)
      // the homework is saved on the film the same way the app saves it
      const id = (r.json as { id: string }).id
      const saved = await call('PUT', `/v1/films/${encodeURIComponent(id)}/homework`, hw)
      if (saved.status >= 400) return result(saved)
      return text({ ...(r.json as object), homework: saved.json })
    },
  )

  mcp.registerTool(
    'get_film',
    {
      title: 'Get a film',
      description:
        'A film’s status (queued, running, succeeded, failed), its share link once ready, who it’s for and how far views got. Once it’s finished, `review` has each scene with plain flags for anything a founder would find odd (a quote that doesn’t stand alone, unclear proof, no logo, a font stand-in, a cut-off line, low contrast, a template line, job words) and the fix for each; `review.ready` is true when nothing is flagged.',
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
        'The drafts that go with a finished film, in the order they are sent: the LinkedIn connection note (`linkedin`, at most 200 characters, no link and no question), the message once they accept (`afterAccept`, with the film), InMail (`inmail`, subject and body; free only if they have an Open Profile or share a LinkedIn group with the person, otherwise use the connection note), the warm email (subject and body, under 125 words), the follow-ups and an intro request. `writer` says which drafts the model wrote and which are templates, `flags` says in plain words why a draft fell back to its template, and `notes` what code changed in a kept draft. Nothing is sent: these are drafts for the person to send.',
      inputSchema: { id: z.string().describe('the film’s id'), ...homework },
    },
    async ({ id, detail, question, built }) => {
      const hw = given({ detail, question, built })
      if (hw) {
        const saved = await call('PUT', `/v1/films/${encodeURIComponent(id)}/homework`, hw)
        if (saved.status >= 400) return result(saved)
      }
      return answer(call, 'GET', `/v1/films/${encodeURIComponent(id)}/messages`)
    },
  )

  mcp.registerTool(
    'find_founders',
    {
      title: 'Who to reach, and founders’ emails',
      description:
        'For a film’s company: who to reach, in `groups` ordered by who is most likely to reply at a company this size (Founders, Warm paths, People doing the job, Hiring manager, Recruiting), each with when to write to them (`why`), what to ask (`ask`) and LinkedIn searches the person runs themselves. Plus the founders and executives with their work emails (`emails`), from one Hunter search with the person’s own Hunter key; without a key, `emails` is null and `emailsNote` says how to add one. Nothing is sent.',
      inputSchema: { id: z.string().describe('the film’s id') },
    },
    async ({ id }) => {
      const film = encodeURIComponent(id)
      const people = await call('GET', `/v1/films/${film}/people`)
      if (people.status >= 400) return result(people)
      const { searches: _flat, ...reach } = people.json as { searches?: unknown }
      const found = await call('POST', `/v1/films/${film}/founders`, {})
      const err = (found.json as { error?: { message?: string } } | null)?.error?.message
      return text({
        ...reach,
        emails: found.status < 400 ? found.json : null,
        ...(found.status >= 400 ? { emailsNote: err ?? `HTTP ${found.status}` } : {}),
      })
    },
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
