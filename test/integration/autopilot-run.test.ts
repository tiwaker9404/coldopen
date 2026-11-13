import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApi } from '../../src/api/server.ts'
import { makeToken } from '../../src/api/tokens.ts'
import { runAutopilotOnce } from '../../src/autopilot/run.ts'
import type { Sql } from '../../src/db/index.ts'
import type { Target } from '../../src/jobs/targets.ts'
import { freshDb, log, profile, testConfig, tmp } from '../helpers/index.ts'

/**
 * The morning run: one film per owner per call, best first, from the day's stored pick, up to
 * films a weekday. Nothing is sent. Every day is switched on here (days 1–7) so the tests don't
 * depend on the weekday they run on; the weekend test pins a Saturday.
 */
let sql: Sql
let app: Awaited<ReturnType<typeof buildApi>>
const TOKEN = 'dispatch-secret'
const cfg = testConfig({
  API_KEYS: 'k1',
  FILMS_DIR: tmp('autopilot-run-'),
  RENDER_DISPATCH_TOKEN: TOKEN,
})
const me: Record<string, string> = { authorization: 'Bearer k1' }
let them: Record<string, string>
const OTHER = 'u:gh:run-other'

beforeAll(async () => {
  sql = await freshDb()
  app = await buildApi({ sql, cfg, log, slack: null })
  them = { authorization: `Bearer ${(await makeToken(sql, OTHER, 't')).token}` }
})
afterAll(async () => {
  await app?.close()
  await sql`delete from profiles`
  await sql?.end()
})
beforeEach(async () => {
  await sql`delete from runs`
  await sql`delete from autopilot_runs`
  await sql`delete from autopilot`
})

const target = (company: string, site: string): Target => ({
  company,
  site,
  oneLiner: null,
  teamSize: 5,
  score: 1,
  reasons: [`${company} fits`],
})
const LIST = ['acme.com', 'globex.com', 'initech.io', 'umbrella.dev', 'hooli.xyz'].map((h) =>
  target(h.split('.')[0]!, `https://${h}`),
)
let list: Target[] = LIST
let kicks = 0
const deps = {
  targets: async () => list,
  kick: () => {
    kicks++
  },
}
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7]
const saveProfile = (id: string, headers = me, data: unknown = profile('candidate')) =>
  app.inject({ method: 'PUT', url: `/v1/profiles/${id}`, headers, payload: { name: id, data } })
const turnOn = async (perDay: number, headers = me, profileId = 'alex', days = ALL_DAYS) => {
  const r = await app.inject({
    method: 'PUT',
    url: '/v1/autopilot',
    headers,
    payload: { on: true, perDay, days, profileId, format: 'portrait', webhook: null },
  })
  expect(r.statusCode).toBe(200)
}
const once = (now = Date.now()) => runAutopilotOnce(sql, cfg, now, deps)
const films = (owner = 'team') =>
  sql<{ id: string; url: string; origin: string; format: string }[]>`
    select id, input->>'url' as url, origin, input->>'format' as format from runs
    where owner = ${owner} order by created_at, id`

beforeAll(async () => {
  expect((await saveProfile('alex')).statusCode).toBe(200)
  expect((await saveProfile('sam', them)).statusCode).toBe(200)
})

describe('the morning run', () => {
  it('makes one film per call, best first, with origin autopilot and the chosen format', async () => {
    list = LIST
    kicks = 0
    await turnOn(3)
    const first = await once()
    expect(first.owners).toEqual([
      { owner: 'team', made: expect.stringMatching(/^run_/), remaining: 2, done: false },
    ])
    expect(first.done).toBe(false)
    expect(kicks).toBe(1)
    await once()
    const made = await films()
    expect(made.map((f) => f.url)).toEqual(['https://acme.com', 'https://globex.com'])
    expect(made.every((f) => f.origin === 'autopilot' && f.format === 'portrait')).toBe(true)
  })

  it('answers done once films a weekday are made, however many calls come', async () => {
    list = LIST
    await turnOn(2)
    await once()
    const second = await once()
    expect(second.owners[0]).toMatchObject({ remaining: 0, done: true })
    expect(second.done).toBe(true)
    for (let i = 0; i < 3; i++) expect((await once()).done).toBe(true)
    expect(await films()).toHaveLength(2)
  })

  it('gives two owners their own caps', async () => {
    list = LIST
    await turnOn(1)
    await turnOn(3, them, 'sam')
    for (let i = 0; i < 4; i++) await once()
    expect(await films()).toHaveLength(1)
    expect(await films(OTHER)).toHaveLength(3)
    const last = await once()
    expect(last.done).toBe(true)
  })

  it('carries on where a stopped run left off, from the stored order', async () => {
    list = LIST
    await turnOn(4)
    await once()
    await once()
    // the job stopped; by the next call scoring has changed, and the order doesn't
    list = [...LIST].reverse()
    await once()
    await once()
    expect((await films()).map((f) => f.url)).toEqual([
      'https://acme.com',
      'https://globex.com',
      'https://initech.io',
      'https://umbrella.dev',
    ])
    const [row] = await sql<{ picked: { site: string }[]; made: { id: string }[] }[]>`
      select picked, made from autopilot_runs where owner = 'team'`
    expect(row!.picked.map((p) => p.site)).toEqual(LIST.map((t) => t.site))
    expect(row!.made).toHaveLength(4)
  })

  it('skips a company filmed by hand since the morning pick, and a failed film does not count', async () => {
    list = LIST
    await turnOn(2)
    await once() // acme
    await sql`
      insert into runs (id, agent, input, owner) values
        ('run_by_hand', 'film', ${sql.json({ url: 'https://globex.com' } as never)}, 'team')`
    // the acme film failed: it doesn't count, and acme isn't tried again
    await sql`update runs set status = 'failed' where origin = 'autopilot'`
    await once()
    await once()
    const auto = (await films()).filter((f) => f.origin === 'autopilot').map((f) => f.url)
    expect(auto).toEqual(['https://acme.com', 'https://initech.io', 'https://umbrella.dev'])
  })

  it('makes nothing on a day that is not one of its days', async () => {
    list = LIST
    await turnOn(3, me, 'alex', [1, 2, 3, 4, 5])
    const saturday = Date.parse('2026-11-14T18:00:00Z')
    const r = await once(saturday)
    expect(r).toEqual({
      owners: [
        {
          owner: 'team',
          made: null,
          remaining: 0,
          done: true,
          why: 'today is not one of its days',
        },
      ],
      done: true,
    })
    expect(await films()).toHaveLength(0)
  })

  it('turns Autopilot off when its profile is gone, and records why', async () => {
    list = LIST
    expect((await saveProfile('gone')).statusCode).toBe(200)
    await turnOn(3, me, 'gone')
    // removed behind the API's back, so the run is what notices
    await sql`delete from profiles where owner = 'team' and id = 'gone'`
    const r = await once()
    expect(r.owners[0]).toMatchObject({ made: null, done: true })
    expect(r.owners[0]!.why).toMatch(/profile Autopilot used is gone/)
    const [a] = await sql<{ on: boolean }[]>`select "on" from autopilot where owner = 'team'`
    expect(a!.on).toBe(false)
    const [row] = await sql<{ skipped: { why: string }[] }[]>`
      select skipped from autopilot_runs where owner = 'team'`
    expect(row!.skipped[0]!.why).toMatch(/turned off/)
    expect(await films()).toHaveLength(0)
  })

  it('stops at the daily film limit on the hosted app, like a film made by hand', async () => {
    list = LIST
    await turnOn(3, them, 'sam')
    const hosted = testConfig({
      HOSTED: 'true',
      SESSION_SECRET: 'x'.repeat(40),
      PUBLIC_URL: 'https://coldopen.example',
      USER_DAILY_FILMS: '1',
    })
    await sql`delete from usage`
    const a = await runAutopilotOnce(sql, hosted, Date.now(), deps)
    expect(a.owners[0]!.made).toBeTruthy()
    const b = await runAutopilotOnce(sql, hosted, Date.now(), deps)
    expect(b.owners[0]).toMatchObject({ made: null, done: true })
    expect(b.owners[0]!.why).toMatch(/your 1 films for today/)
    expect(await films(OTHER)).toHaveLength(1)
    await sql`delete from usage`
  })
})

describe('POST /internal/autopilot/run', () => {
  it('needs the dispatch token', async () => {
    for (const headers of [{}, { authorization: 'Bearer nope' }, me]) {
      const r = await app.inject({ method: 'POST', url: '/internal/autopilot/run', headers })
      expect(r.statusCode).toBe(401)
    }
    const ok = await app.inject({
      method: 'POST',
      url: '/internal/autopilot/run',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json()).toEqual({ owners: [], done: true })
  })

  it("isn't in the API docs", async () => {
    const doc = (await app.inject({ url: '/docs/json' })).json() as { paths: object }
    expect(Object.keys(doc.paths).some((p) => p.includes('internal'))).toBe(false)
  })

  it('scores today from the Autopilot profile, and leaves /v1/targets on the newest', async () => {
    // a second job seeker profile, saved last, wanting a different role
    const other = {
      ...profile('candidate'),
      sender: { ...profile('candidate').sender, role: 'Product designer' },
      skills: ['Figma'],
    }
    expect((await saveProfile('designer', me, other)).statusCode).toBe(200)
    const targets = await app.inject({ url: '/v1/targets?limit=50', headers: me })
    expect(targets.json().roles).toContain('Product designer')
    await turnOn(5, me, 'alex')
    const today = (await app.inject({ url: '/v1/autopilot/today', headers: me })).json()
    const theirs = targets.json().data.map((t: { site: string }) => t.site)
    expect(today.picks.map((p: { site: string }) => p.site)).not.toEqual(theirs.slice(0, 5))

    // and the run itself picks from the same list today's pick shows
    const r = await app.inject({
      method: 'POST',
      url: '/internal/autopilot/run',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    expect(r.statusCode).toBe(200)
    expect((await films()).map((f) => f.url)).toEqual([today.picks[0].site])
    await sql`delete from profiles where owner = 'team' and id = 'designer'`
  })
})
