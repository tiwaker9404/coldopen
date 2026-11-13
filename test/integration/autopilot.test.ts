import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApi } from '../../src/api/server.ts'
import { makeToken } from '../../src/api/tokens.ts'
import type { Sql } from '../../src/db/index.ts'
import { freshDb, log, profile, testConfig, tmp } from '../helpers/index.ts'

/**
 * Autopilot's settings and today's pick: a signed-in job seeker chooses how many films a
 * weekday and sees which companies they'd be for. Nothing here makes a film.
 */
let sql: Sql
let app: Awaited<ReturnType<typeof buildApi>>
let hosted: Awaited<ReturnType<typeof buildApi>>
const me: Record<string, string> = { authorization: 'Bearer k1' }
let them: Record<string, string>

beforeAll(async () => {
  sql = await freshDb()
  app = await buildApi({
    sql,
    cfg: testConfig({ API_KEYS: 'k1', FILMS_DIR: tmp('autopilot-films-') }),
    log,
    slack: null,
  })
  hosted = await buildApi({
    sql,
    cfg: testConfig({
      HOSTED: 'true',
      SESSION_SECRET: 'x'.repeat(40),
      GITHUB_CLIENT_ID: 'gh-client',
      GITHUB_CLIENT_SECRET: 'gh-secret',
      PUBLIC_URL: 'https://coldopen.example',
      FILMS_DIR: tmp('autopilot-hosted-'),
    }),
    log,
    slack: null,
  })
  them = { authorization: `Bearer ${(await makeToken(sql, 'u:gh:autopilot-other', 't')).token}` }
})

afterAll(async () => {
  await app?.close()
  await hosted?.close()
  await sql`delete from profiles`
  await sql?.end()
})

const put = (body: unknown, headers = me) =>
  app.inject({ method: 'PUT', url: '/v1/autopilot', headers, payload: body as object })
const get = (url = '/v1/autopilot', headers = me) => app.inject({ url, headers })
const saveProfile = (id: string, data: unknown, headers = me) =>
  app.inject({ method: 'PUT', url: `/v1/profiles/${id}`, headers, payload: { name: id, data } })
const settings = {
  on: true,
  perDay: 5,
  days: [1, 2, 3, 4, 5],
  profileId: 'alex',
  format: 'square',
  webhook: null,
}

describe('Autopilot settings', () => {
  it('is for signed-in job seekers only, with a plain sentence otherwise', async () => {
    const visitor = await hosted.inject({ url: '/v1/autopilot' })
    expect(visitor.statusCode).toBe(403)
    expect(visitor.json().error).toEqual({ code: 'sign_in', message: 'sign in to use Autopilot' })

    // signed in, but only a seller's profile
    expect((await saveProfile('seller', profile('sales'))).statusCode).toBe(200)
    const seller = await get()
    expect(seller.statusCode).toBe(403)
    expect(seller.json().error.message).toBe(
      'Autopilot is for job seekers: save a job seeker profile first',
    )
  })

  it('starts off, then keeps what was saved', async () => {
    const data = { ...profile('candidate'), skills: ['Python'] }
    expect((await saveProfile('alex', data)).statusCode).toBe(200)
    const first = (await get()).json()
    expect(first).toMatchObject({
      on: false,
      perDay: 20,
      days: [1, 2, 3, 4, 5],
      profileId: null,
      format: 'square',
      webhook: null,
      profileGone: false,
    })
    // only job seeker profiles can be picked
    expect(first.profiles).toEqual([{ id: 'alex', name: 'alex' }])

    const hook = 'https://hooks.slack.com/services/T0/B0/abc'
    const saved = await put({
      ...settings,
      perDay: 12,
      days: [5, 1, 3, 3],
      format: 'portrait',
      webhook: hook,
    })
    expect(saved.statusCode).toBe(200)
    const back = (await get()).json()
    expect(back).toMatchObject({
      on: true,
      perDay: 12,
      days: [1, 3, 5],
      profileId: 'alex',
      format: 'portrait',
      webhook: hook,
    })
  })

  it('refuses a webhook that is not Slack or Discord, naming the field', async () => {
    for (const webhook of [
      'http://hooks.slack.com/services/T0/B0/abc',
      'https://example.com/hook',
      'https://discord.com/channels/1/2',
    ]) {
      const r = await put({ ...settings, webhook })
      expect(r.statusCode).toBe(400)
      expect(r.json().error.fields).toEqual([
        {
          path: 'webhook',
          message:
            'The webhook must be an https link on hooks.slack.com or discord.com/api/webhooks',
        },
      ])
    }
    const discord = await put({ ...settings, webhook: 'https://discord.com/api/webhooks/1/x' })
    expect(discord.statusCode).toBe(200)
  })

  it('takes 1 to 25 films a weekday, and says the range otherwise', async () => {
    for (const perDay of [0, 26, 100]) {
      const r = await put({ ...settings, perDay })
      expect(r.statusCode).toBe(400)
      expect(r.json().error.message).toBe('Films a weekday must be a whole number from 1 to 25.')
      expect(r.json().error.fields[0].path).toBe('perDay')
    }
    for (const perDay of [1, 25]) expect((await put({ ...settings, perDay })).statusCode).toBe(200)
  })

  it('needs a profile to turn on, and one of their own job seeker profiles', async () => {
    const none = await put({ ...settings, profileId: null })
    expect(none.statusCode).toBe(422)
    expect(none.json().error.fields[0]).toEqual({
      path: 'profileId',
      message: 'Pick the profile Autopilot makes films from',
    })
    expect((await put({ ...settings, profileId: 'seller' })).statusCode).toBe(422)
    expect((await put({ ...settings, on: false, profileId: null })).statusCode).toBe(200)
  })
})

describe("today's pick", () => {
  it("is Network this week's companies in order, up to films a weekday, and makes nothing", async () => {
    expect((await put({ ...settings, perDay: 5 })).statusCode).toBe(200)
    const targets = (await get('/v1/targets?limit=50')).json().data as { site: string }[]
    const r = await get('/v1/autopilot/today')
    expect(r.statusCode).toBe(200)
    const today = r.json()
    expect(today.day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(today.perDay).toBe(5)
    expect(today.madeToday).toBe(0)
    expect(today.picks.map((p: { site: string }) => p.site)).toEqual(
      targets.slice(0, 5).map((t) => t.site),
    )
    for (const p of today.picks) expect(p.reasons.length).toBeGreaterThan(0)
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from runs`
    expect(row?.n).toBe(0)
  })

  it('counts the films Autopilot made today against the cap', async () => {
    const before = (await get('/v1/autopilot/today')).json()
    const first = before.picks[0].site as string
    await sql`
      insert into runs (id, agent, input, output, owner, origin)
      values ('run_autopilot_1', 'film', ${sql.json({ url: first } as never)},
        ${sql.json({ host: new URL(first).hostname.replace(/^www\./, '') } as never)},
        'team', 'autopilot')`
    const after = (await get('/v1/autopilot/today')).json()
    expect(after.madeToday).toBe(1)
    expect(after.picks).toHaveLength(4)
    expect(after.picks.map((p: { site: string }) => p.site)).not.toContain(first)
    await sql`delete from runs where id = 'run_autopilot_1'`
  })

  it("keeps each person's settings to themselves", async () => {
    const data = { ...profile('candidate'), skills: ['Python'] }
    expect((await saveProfile('sam', data, them)).statusCode).toBe(200)
    const theirs = (await get('/v1/autopilot', them)).json()
    expect(theirs).toMatchObject({ on: false, perDay: 20, profileId: null })
    expect(theirs.profiles).toEqual([{ id: 'sam', name: 'sam' }])
    // my profile isn't theirs to pick
    expect((await put({ ...settings, profileId: 'alex' }, them)).statusCode).toBe(422)
    expect((await put({ ...settings, profileId: 'sam', perDay: 3 }, them)).statusCode).toBe(200)
    expect((await get()).json()).toMatchObject({ perDay: 5, profileId: 'alex' })
    expect((await get('/v1/autopilot/today', them)).json().perDay).toBe(3)
  })

  it('turns off when its profile is deleted, and says so', async () => {
    const data = { ...profile('candidate'), skills: ['Python'] }
    expect((await saveProfile('alex2', data)).statusCode).toBe(200)
    expect((await put({ ...settings, profileId: 'alex2' })).statusCode).toBe(200)
    const del = await app.inject({ method: 'DELETE', url: '/v1/profiles/alex2', headers: me })
    expect(del.statusCode).toBe(200)
    const after = (await get()).json()
    expect(after).toMatchObject({ on: false, profileId: 'alex2', profileGone: true })
    expect(after.note).toMatch(/turned off because the profile it used was deleted/)
    expect((await get('/v1/autopilot/today')).json().runs).toBe(false)
    // and can't be turned back on with it
    expect((await put({ ...settings, profileId: 'alex2' })).statusCode).toBe(422)
  })
})
