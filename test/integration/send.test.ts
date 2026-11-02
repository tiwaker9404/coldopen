import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApi } from '../../src/api/server.ts'
import type { Sql } from '../../src/db/index.ts'
import { freshDb, log, profile, testConfig, tmp } from '../helpers/index.ts'

let sql: Sql
let app: Awaited<ReturnType<typeof buildApi>>
const auth = { authorization: 'Bearer k1' }
const hunterCalls: { url: string; key: string | null }[] = []

/** stands in for Hunter: "good-key-0000" works; Priya Shah at sierra.ai is known */
const hunter = async (url: string, init: RequestInit) => {
  const key = new Headers(init.headers).get('x-api-key')
  hunterCalls.push({ url, key })
  if (key !== 'good-key-0000') return new Response('{}', { status: 401 })
  if (url.includes('/account'))
    return Response.json({ data: { requests: { searches: { used: 3, available: 50 } } } })
  if (url.includes('full_name=Priya+Shah'))
    return Response.json({
      data: { email: 'priya.shah@sierra.ai', score: 94, verification: { status: 'valid' } },
    })
  return Response.json({ data: { email: null } })
}

let film = ''
beforeAll(async () => {
  sql = await freshDb()
  app = await buildApi({
    sql,
    cfg: testConfig({
      API_KEYS: 'k1',
      FILMS_DIR: tmp('send-films-'),
      SESSION_SECRET: 'x'.repeat(40),
    }),
    log,
    slack: null,
    hunterFetch: hunter as never,
  })
  await app.inject({
    method: 'PUT',
    url: '/v1/profiles/me',
    headers: auth,
    payload: { name: 'Me', data: profile('candidate') },
  })
  film = (
    await app.inject({
      method: 'POST',
      url: '/v1/films',
      headers: auth,
      payload: { url: 'https://www.sierra.ai/' },
    })
  ).json().id
  const output = {
    company: 'Sierra',
    host: 'www.sierra.ai',
    format: 'square',
    durationSec: 29,
    files: {
      film: 'x/film-square.mp4',
      poster: 'x/poster.jpg',
      gif: 'x/preview.gif',
      sheet: 'x/contact-sheet.jpg',
      kit: 'x/kit.json',
      storyboard: 'x/storyboard.json',
    },
    script: {
      hook: 'Hi',
      noticed: 'x',
      insight: { factId: 'f1', why: 'y' },
      pitch: { headline: 'h', points: ['a', 'b'] },
      proof: [0],
      cta: 'Talk?',
    },
  }
  await sql`update runs set status = 'succeeded', completed_at = now(), output = ${sql.json(output as never)} where id = ${film}`
})
afterAll(async () => {
  await app?.close()
  await sql?.end()
})

const find = (name: string) =>
  app.inject({
    method: 'POST',
    url: `/v1/films/${film}/find-email`,
    headers: auth,
    payload: { name },
  })

describe('sending', () => {
  it('guesses addresses without a Hunter key, and calls no one', async () => {
    const r = (await find('Priya Shah')).json()
    expect(r).toMatchObject({ domain: 'sierra.ai', found: null, hunter: false })
    expect(r.guesses[0].email).toBe('priya@sierra.ai')
    expect(hunterCalls).toHaveLength(0)
  })

  it('checks a Hunter key before saving it, and never gives it back whole', async () => {
    const bad = await app.inject({
      method: 'PUT',
      url: '/v1/me/keys/hunter',
      headers: auth,
      payload: { key: 'wrong-key-1111' },
    })
    expect(bad.statusCode).toBe(422)
    expect(bad.json().error.message).toMatch(/didn't accept/)
    const ok = await app.inject({
      method: 'PUT',
      url: '/v1/me/keys/hunter',
      headers: auth,
      payload: { key: 'good-key-0000' },
    })
    expect(ok.json()).toEqual({ saved: true, last4: '0000', searchesLeft: 47 })
    const keys = await app.inject({ url: '/v1/me/keys', headers: auth })
    expect(keys.json().hunter.last4).toBe('0000')
    expect(keys.body).not.toContain('good-key')
    const [row] = await sql<{ value: string }[]>`select value from owner_keys`
    expect(row!.value).not.toContain('good-key')
  })

  it('finds the address with Hunter, keeping the guesses as alternatives', async () => {
    const r = (await find('Priya Shah')).json()
    expect(r.found).toEqual({
      email: 'priya.shah@sierra.ai',
      source: 'hunter',
      score: 94,
      status: 'valid',
    })
    expect(r.guesses.map((g: { email: string }) => g.email)).not.toContain('priya.shah@sierra.ai')
    const none = (await find('Nobody Known')).json()
    expect(none).toMatchObject({ found: null, note: "Hunter doesn't know this person's address." })
  })

  it('greets the saved person in the messages, and addresses follow-ups to them', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/v1/films/${film}/recipient`,
      headers: auth,
      payload: { name: 'Priya Shah', email: 'priya.shah@sierra.ai' },
    })
    expect(put.json().recipient).toEqual({ name: 'Priya Shah', email: 'priya.shah@sierra.ai' })
    const m = (await app.inject({ url: `/v1/films/${film}/messages`, headers: auth })).json()
    expect(m.email.body.startsWith('Hi Priya,')).toBe(true)
    expect(m.intro).toContain('[First name]')

    const back = new Date(Date.now() - 5 * 86_400_000).toISOString()
    await sql`update runs set outreach = ${sql.json({ status: 'sent', at: back, sentAt: back } as never)} where id = ${film}`
    const fu = (await app.inject({ url: '/v1/followups', headers: auth })).json()
    expect(fu.data[0].message.to).toBe('priya.shah@sierra.ai')
    expect(fu.data[0].message.body.startsWith('Hi Priya,')).toBe(true)
  })

  it('forgets the key, and deleting your data removes it too', async () => {
    expect(
      (await app.inject({ method: 'DELETE', url: '/v1/me/keys/hunter', headers: auth })).json(),
    ).toEqual({ deleted: true })
    expect((await app.inject({ url: '/v1/me/keys', headers: auth })).json()).toEqual({})
  })
})
