import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApi } from '../../src/api/server.ts'
import type { Sql } from '../../src/db/index.ts'
import { freshDb, log, profile, testConfig, tmp } from '../helpers/index.ts'

/**
 * The public app: visitors try it without an account, GitHub sign-in keeps their work, and
 * daily limits hold. Nobody sees anybody else's films or profiles.
 */
let sql: Sql
let app: Awaited<ReturnType<typeof buildApi>>

beforeAll(async () => {
  sql = await freshDb()
  app = await buildApi({
    sql,
    cfg: testConfig({
      HOSTED: 'true',
      SESSION_SECRET: 'x'.repeat(40),
      GITHUB_CLIENT_ID: 'gh-client',
      GITHUB_CLIENT_SECRET: 'gh-secret',
      PUBLIC_URL: 'https://coldopen.example',
      FILMS_DIR: tmp('hosted-films-'),
      ANON_DAILY_FILMS: '1',
      USER_DAILY_FILMS: '2',
      IP_DAILY_FILMS: '10',
      GLOBAL_DAILY_FILMS: '100',
      DAILY_DRAFTS: '1',
      API_KEYS: 'operator-key',
    }),
    log,
    slack: null,
  })
})
afterAll(async () => {
  await app?.close()
  await sql?.end()
})
afterEach(() => vi.unstubAllGlobals())

/** A browser: keeps the cookies the app sets. */
function browser() {
  const jar = new Map<string, string>()
  const remember = (res: { headers: Record<string, unknown> }) => {
    const set = res.headers['set-cookie']
    for (const c of (Array.isArray(set) ? set : set ? [set] : []) as string[]) {
      const [pair, ...attrs] = c.split(';')
      const [k, v] = pair!.split('=') as [string, string]
      if (attrs.some((a) => /max-age=0/i.test(a.trim()))) jar.delete(k)
      else jar.set(k, v)
    }
  }
  return {
    jar,
    async req(method: string, url: string, payload?: unknown) {
      const res = await app.inject({
        method: method as 'GET',
        url,
        headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') },
        ...(payload !== undefined ? { payload: payload as object } : {}),
      })
      remember(res)
      return res
    },
  }
}

const saveProfile = (b: ReturnType<typeof browser>) =>
  b.req('PUT', '/v1/profiles/me', { name: 'Me', data: profile('candidate') })

describe('trying it without an account', () => {
  it('gives a visitor one free film, and their own space', async () => {
    const alice = browser()
    const me = (await alice.req('GET', '/v1/me')).json()
    expect(me).toMatchObject({
      hosted: true,
      signIn: true,
      user: null,
      films: { used: 0, limit: 1 },
      keepsDays: 7,
    })
    expect(alice.jar.has('co_visitor')).toBe(true)

    expect((await saveProfile(alice)).statusCode).toBe(200)
    const first = await alice.req('POST', '/v1/films', { url: 'acme.com', profileId: 'me' })
    expect(first.statusCode).toBe(202)
    const second = await alice.req('POST', '/v1/films', { url: 'globex.com', profileId: 'me' })
    expect(second.statusCode).toBe(429)
    expect(second.json().error.message).toMatch(/Sign in with GitHub to make 2 a day/)

    // someone else sees none of it
    const bob = browser()
    expect((await bob.req('GET', '/v1/films')).json().data).toEqual([])
    expect((await bob.req('GET', '/v1/profiles')).json().data).toEqual([])
    expect((await bob.req('GET', `/v1/films/${first.json().id}`)).statusCode).toBe(404)
    expect((await bob.req('POST', `/v1/films/${first.json().id}/cancel`)).statusCode).toBe(404)
    // and a visitor can't start a batch
    await saveProfile(bob)
    expect(
      (await bob.req('POST', '/v1/batches', { urls: ['a.com', 'b.com'], profileId: 'me' }))
        .statusCode,
    ).toBe(403)
  })

  it('limits résumé drafts, which cost model calls', async () => {
    const carol = browser()
    const draft = () =>
      carol.req('POST', '/v1/profiles/draft', {
        filename: 'cv.md',
        data: Buffer.from('# Carol\n- Cut costs by 20% at Initech').toString('base64'),
        role: 'Analyst',
      })
    expect((await draft()).statusCode).not.toBe(429)
    expect((await draft()).statusCode).toBe(429)
  })

  it('lets the operator in with an API key, seeing only the team space', async () => {
    const res = await app.inject({
      url: '/v1/films',
      headers: { authorization: 'Bearer operator-key' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual([])
  })
})

describe('signing in with GitHub', () => {
  it('keeps what a visitor made, raises the limit, and can delete it all', async () => {
    const dana = browser()
    await saveProfile(dana)
    const film = (
      await dana.req('POST', '/v1/films', { url: 'initech.com', profileId: 'me' })
    ).json()

    const start = await dana.req('GET', '/auth/github')
    expect(start.statusCode).toBe(302)
    const to = new URL(start.headers.location as string)
    expect(to.origin).toBe('https://github.com')
    expect(to.searchParams.get('redirect_uri')).toBe(
      'https://coldopen.example/auth/github/callback',
    )
    const state = to.searchParams.get('state')!

    vi.stubGlobal('fetch', async (url: string) =>
      Response.json(
        String(url).includes('access_token')
          ? { access_token: 'gho_test' }
          : { id: 4242, login: 'dana', name: 'Dana', avatar_url: 'https://avatars.example/d' },
      ),
    )
    // a forged state is refused
    const forged = await dana.req('GET', '/auth/github/callback?code=c&state=wrong')
    expect(forged.headers.location).toMatch(/signin=/)
    const done = await dana.req('GET', `/auth/github/callback?code=c&state=${state}`)
    expect(done.headers.location).toBe('/')
    expect(dana.jar.has('co_session')).toBe(true)

    const me = (await dana.req('GET', '/v1/me')).json()
    expect(me.user).toEqual({ login: 'dana', name: 'Dana', avatar: 'https://avatars.example/d' })
    expect(me.films.limit).toBe(2)
    expect(me.keepsDays).toBe(30)
    // the film made before signing in is still theirs
    expect(
      (await dana.req('GET', '/v1/films')).json().data.map((f: { id: string }) => f.id),
    ).toEqual([film.id])
    expect((await dana.req('GET', '/v1/profiles')).json().data).toHaveLength(1)

    // a tampered session cookie is just a visitor
    const eve = browser()
    eve.jar.set('co_session', dana.jar.get('co_session')!.replace(/.$/, 'A'))
    expect((await eve.req('GET', '/v1/me')).json().user).toBeNull()

    const gone = await dana.req('DELETE', '/v1/me')
    expect(gone.json()).toEqual({ deleted: { films: 1 } })
    expect(dana.jar.has('co_session')).toBe(false)
    const [left] = await sql<
      { n: number }[]
    >`select count(*)::int as n from runs where owner like ${'u:gh:4242'}`
    expect(left!.n).toBe(0)
  })
})
