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
      GOOGLE_CLIENT_ID: 'go-client',
      GOOGLE_CLIENT_SECRET: 'go-secret',
      PUBLIC_URL: 'https://coldopen.example',
      FILMS_DIR: tmp('hosted-films-'),
      ANON_DAILY_FILMS: '1',
      USER_DAILY_FILMS: '2',
      IP_DAILY_FILMS: '10',
      GLOBAL_DAILY_FILMS: '100',
      DAILY_DRAFTS: '1',
      API_KEYS: 'operator-key',
      UNLIMITED_GITHUB_USERS: 'Boss',
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
    // change the signature's last character (to a different one, so it's always a change)
    const real = dana.jar.get('co_session')!
    eve.jar.set('co_session', real.slice(0, -1) + (real.endsWith('A') ? 'B' : 'A'))
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

describe('signing in with Google', () => {
  it("offers Google first, and keeps a visitor's films, job search and keys", async () => {
    const sam = browser()
    expect((await sam.req('GET', '/v1/me')).json().providers).toEqual(['google', 'github'])
    await saveProfile(sam)
    const film = (await sam.req('POST', '/v1/films', { url: 'globex.com', profileId: 'me' })).json()
    await sam.req('PUT', '/v1/jobs/search', { roles: ['Solutions Engineer'] })

    const start = await sam.req('GET', '/auth/google')
    expect(start.statusCode).toBe(302)
    const to = new URL(start.headers.location as string)
    expect(to.origin).toBe('https://accounts.google.com')
    expect(to.searchParams.get('scope')).toBe('openid email profile')
    expect(to.searchParams.get('redirect_uri')).toBe(
      'https://coldopen.example/auth/google/callback',
    )
    const state = to.searchParams.get('state')!

    const seen: { url: string; body: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), body: String(init?.body ?? '') })
      return Response.json(
        String(url).includes('oauth2.googleapis.com/token')
          ? { access_token: 'ya29.test', id_token: 'x' }
          : {
              sub: '1087',
              email: 'Sam@Example.com',
              email_verified: true,
              name: 'Sam Lee',
              picture: 'https://lh3.example/s',
            },
      )
    })
    // pressing Cancel on Google's page just comes back
    expect(
      (await sam.req('GET', '/auth/google/callback?error=access_denied')).headers.location,
    ).toBe('/')
    const forged = await sam.req('GET', '/auth/google/callback?code=c&state=wrong')
    expect(forged.headers.location).toMatch(/signin=/)
    const done = await sam.req('GET', `/auth/google/callback?code=c&state=${state}`)
    expect(done.headers.location).toBe('/')
    expect(seen[0]!.body).toContain('grant_type=authorization_code')
    expect(seen[0]!.body).toContain('client_secret=go-secret')

    const me = (await sam.req('GET', '/v1/me')).json()
    expect(me.user).toEqual({
      login: 'sam@example.com',
      name: 'Sam Lee',
      avatar: 'https://lh3.example/s',
    })
    expect(me.keepsDays).toBe(30)
    expect(
      (await sam.req('GET', '/v1/films')).json().data.map((f: { id: string }) => f.id),
    ).toEqual([film.id])
    expect((await sam.req('GET', '/v1/jobs/search')).json().roles).toEqual(['Solutions Engineer'])
    const [row] = await sql<{ id: string }[]>`select id from users where login = 'sam@example.com'`
    expect(row!.id).toBe('go:1087')
  })

  it('refuses an unverified Google email', async () => {
    const kim = browser()
    const state = new URL(
      (await kim.req('GET', '/auth/google')).headers.location as string,
    ).searchParams.get('state')!
    vi.stubGlobal('fetch', async (url: string) =>
      Response.json(
        String(url).includes('/token')
          ? { access_token: 't' }
          : { sub: '9', email: 'kim@example.com', email_verified: false },
      ),
    )
    const r = await kim.req('GET', `/auth/google/callback?code=c&state=${state}`)
    expect(r.headers.location).toMatch(/signin=/)
    expect((await kim.req('GET', '/v1/me')).json().user).toBeNull()
  })
})

describe('the public totals', () => {
  it('serves the landing page counter to anyone, with no cookie set', async () => {
    const r = await app.inject({ url: '/v1/stats' })
    expect(r.statusCode).toBe(200)
    expect(r.headers['set-cookie']).toBeUndefined()
    expect(r.headers['access-control-allow-origin']).toBe('*')
    expect(r.json().outreach).toMatchObject({ sent: expect.any(Number) })
  })
})

describe('the owner', () => {
  it('shows the funnel to the operator only, counting each visitor once a day', async () => {
    const visit = await app.inject({ url: '/v1/me' })
    const cookie = String(visit.headers['set-cookie']).split(';')[0]!
    await app.inject({ url: '/v1/me', headers: { cookie } })
    expect(visit.json().stats).toBe(false)
    expect((await app.inject({ url: '/v1/funnel', headers: { cookie } })).statusCode).toBe(403)

    const f = await app.inject({
      url: '/v1/funnel?days=7',
      headers: { authorization: 'Bearer operator-key' },
    })
    expect(f.statusCode).toBe(200)
    const body = f.json()
    expect(body.visitors).toBeGreaterThanOrEqual(1)
    const [{ n }] = (await sql`
      select count(*)::int as n from usage where key = ${`visit:${cookie.split('=')[1]}`}`) as unknown as [
      { n: number },
    ]
    expect(n).toBeLessThanOrEqual(1)
    for (const k of ['signups', 'makers', 'films', 'sent', 'watched', 'replied', 'failures'])
      expect(body).toHaveProperty(k)
  })

  it('has no daily limits once signed in with a listed GitHub account', async () => {
    const boss = browser()
    const start = await boss.req('GET', '/auth/github')
    const state = new URL(start.headers.location as string).searchParams.get('state')!
    vi.stubGlobal('fetch', async (url: string) =>
      Response.json(
        String(url).includes('access_token')
          ? { access_token: 'gho_boss' }
          : { id: 7, login: 'boss', name: 'Boss', avatar_url: null },
      ),
    )
    await boss.req('GET', `/auth/github/callback?code=c&state=${state}`)
    const me = (await boss.req('GET', '/v1/me')).json()
    expect(me.films).toBeNull()
    expect(me.keepsDays).toBeNull()

    await saveProfile(boss)
    // past the per-user limit of 2, one at a time and as a batch
    for (const u of ['a1.example', 'a2.example', 'a3.example'])
      expect((await boss.req('POST', '/v1/films', { url: u, profileId: 'me' })).statusCode).toBe(
        202,
      )
    const batch = await boss.req('POST', '/v1/batches', {
      urls: ['b1.example', 'b2.example', 'b3.example'],
      profileId: 'me',
    })
    expect(batch.statusCode).toBe(202)
  })

  it('deletes what it said it would: visitors after 7 days, accounts after 30, never the owner', async () => {
    const at = (days: number) => sql`now() - make_interval(days => ${days})`
    const row = async (owner: string, id: string, days: number, status = 'succeeded') => {
      await sql`insert into runs (id, agent, input, status, owner, created_at)
        values (${id}, 'film', '{}'::jsonb, ${status}, ${owner}, ${at(days)})`
      await sql`insert into profiles (owner, id, name, data, updated_at)
        values (${owner}, ${id}, 'x', '{}'::jsonb, ${at(days)})`
      await sql`insert into connections (owner, name, company, company_key, added_at)
        values (${owner}, 'A Person', 'Acme', 'acme', ${at(days)})`
    }
    await row('a:old', 'run_old_visitor', 8)
    await row('a:new', 'run_new_visitor', 6)
    await row('a:busy', 'run_busy_visitor', 9, 'running')
    await row('u:gh:41', 'run_old_account', 31)
    await row('u:gh:42', 'run_new_account', 29)
    await row('u:gh:7', 'run_owner', 400) // "boss", in UNLIMITED_GITHUB_USERS

    const { purgeExpired } = await import('../../src/api/accounts.ts')
    const cfg = { UNLIMITED_GITHUB_USERS: ['boss'] } as never
    await purgeExpired(sql, cfg)

    const left = async (table: 'runs' | 'profiles' | 'connections') =>
      (
        await sql<{ owner: string }[]>`select distinct owner from ${sql(table)}
        where owner in ('a:old', 'a:new', 'a:busy', 'u:gh:41', 'u:gh:42', 'u:gh:7')`
      )
        .map((r) => r.owner)
        .sort()
    // a film still being made is kept whatever its age; everything else goes by age
    expect(await left('runs')).toEqual(['a:busy', 'a:new', 'u:gh:42', 'u:gh:7'])
    expect(await left('profiles')).toEqual(['a:new', 'u:gh:42', 'u:gh:7'])
    expect(await left('connections')).toEqual(['a:new', 'u:gh:42', 'u:gh:7'])
  })

  it('serves a privacy page that states the real retention', async () => {
    const r = await app.inject({ url: '/privacy' })
    expect(r.statusCode).toBe(200)
    expect(r.body).toContain('Kept 7 days after your last edit, or 30 days if you sign in')
    expect(r.body).toContain('Groq')
  })
})

describe('only coldopen’s maker can say he built it', () => {
  const claim = {
    ...profile('candidate'),
    creator: {
      name: 'coldopen',
      url: 'https://tiwaker9404.github.io/coldopen/',
      line: 'Open-source outreach films',
    },
  }
  const signIn = async (id: number, login: string) => {
    const b = browser()
    const start = await b.req('GET', '/auth/github')
    const state = new URL(start.headers.location as string).searchParams.get('state')!
    vi.stubGlobal('fetch', async (url: string) =>
      Response.json(
        String(url).includes('access_token')
          ? { access_token: `gho_${login}` }
          : { id, login, name: login, avatar_url: null },
      ),
    )
    await b.req('GET', `/auth/github/callback?code=c&state=${state}`)
    vi.unstubAllGlobals()
    return b
  }

  it('refuses a profile from anyone else that claims coldopen, pointing at the field', async () => {
    for (const b of [browser(), await signIn(41, 'mallory')]) {
      const r = await b.req('PUT', '/v1/profiles/me', { name: 'Me', data: claim })
      expect(r.statusCode).toBe(422)
      expect(r.json().error).toMatchObject({
        code: 'not_the_maker',
        fields: [{ path: 'creator.name' }],
      })
      // a project that is coldopen counts too, by name or link
      const project = {
        ...profile('candidate'),
        projects: [
          { name: 'My agent', url: 'https://github.com/tiwaker9404/coldopen', line: 'Films' },
        ],
      }
      const p = await b.req('PUT', '/v1/profiles/me', { name: 'Me', data: project })
      expect(p.json().error.fields).toEqual([expect.objectContaining({ path: 'projects.0.name' })])
      // something they built themselves is fine
      const own = {
        ...profile('candidate'),
        creator: { name: 'shipkit', url: 'https://shipkit.example', line: 'A kit I wrote' },
      }
      expect((await b.req('PUT', '/v1/profiles/me', { name: 'Me', data: own })).statusCode).toBe(
        200,
      )
    }
  })

  it('refuses the claim however it is worded, not only by name', async () => {
    const b = await signIn(43, 'mallory3')
    const reworded = {
      ...profile('candidate'),
      creator: {
        name: 'FilmTool',
        url: 'https://filmtool.example',
        line: 'I built the tool that made this film',
      },
    }
    const r = await b.req('PUT', '/v1/profiles/me', { name: 'Me', data: reworded })
    expect(r.statusCode).toBe(422)
    expect(r.json().error).toMatchObject({
      code: 'not_the_maker',
      fields: [{ path: 'creator.line' }],
    })
  })

  it('tells the web app who the maker is, by the same rule the save uses', async () => {
    const mallory = await signIn(44, 'mallory4')
    expect((await mallory.req('GET', '/v1/me')).json().maker).toBe(false)
    expect((await browser().req('GET', '/v1/me')).json().maker).toBe(false)
    const boss = await signIn(8, 'boss')
    expect((await boss.req('GET', '/v1/me')).json().maker).toBe(true)
    const reworded = {
      ...profile('candidate'),
      creator: {
        name: 'coldopen',
        url: 'https://coldopen.example',
        line: 'I built the tool that made this film',
      },
    }
    expect(
      (await boss.req('PUT', '/v1/profiles/me', { name: 'Me', data: reworded })).statusCode,
    ).toBe(200)
  })

  it('makes their film without the claim when it comes with the film or was saved before', async () => {
    const mallory = await signIn(42, 'mallory2')
    const r = await mallory.req('POST', '/v1/films', { url: 'claims.example', profile: claim })
    expect(r.statusCode).toBe(202)
    const [run] = await sql<{ input: { profile: { creator?: unknown } } }[]>`
      select input from runs where id = ${r.json().id}`
    expect(run!.input.profile.creator).toBeUndefined()
  })

  it('lets the maker save it, and keeps it on his films', async () => {
    const boss = await signIn(7, 'boss')
    expect((await boss.req('PUT', '/v1/profiles/me', { name: 'Me', data: claim })).statusCode).toBe(
      200,
    )
    const r = await boss.req('POST', '/v1/films', { url: 'mine.example', profileId: 'me' })
    const [run] = await sql<{ input: { profile: { creator?: { name: string } } } }[]>`
      select input from runs where id = ${r.json().id}`
    expect(run!.input.profile.creator?.name).toBe('coldopen')
  })
})
