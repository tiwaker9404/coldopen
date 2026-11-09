import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildApi } from '../../src/api/server.ts'
import { closeBrowser } from '../../src/browser.ts'
import type { Sql } from '../../src/db/index.ts'
import { createFilmAgent } from '../../src/film.ts'
import { LocalContext } from '../../src/runtime/local.ts'
import { fixtureServer, freshDb, log, profile, testConfig, tmp } from '../helpers/index.ts'

/**
 * A job link pasted where the website goes: the post is read first, and the film is made for
 * the company it links to. Job boards can't be reached from tests, so reading the post is
 * stubbed; reading the company's site and making the film are real.
 */
const posts = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../../src/job/read.ts', () => ({
  fetchJob: async (url: string) => {
    const post = posts.get(url)
    if (!post) throw new Error('HTTP 404')
    return post
  },
}))

afterAll(async () => {
  await closeBrowser()
  ;(await fixtureServer()).close()
})

describe('pasting a job link instead of a website', () => {
  it('reads the post, then films the company it links to, answering the post', async () => {
    const { url } = await fixtureServer()
    const link = 'https://jobs.lever.co/parcelpine/3f2a-41b0'
    posts.set(link, {
      url: link,
      title: 'Operations Analyst',
      companyUrl: `${url}/parcelpine/`,
      requirements: [
        'Experience building dashboards that operations teams use every day',
        'Strong SQL and spreadsheet modeling',
      ],
    })
    const agent = createFilmAgent({
      filmsDir: tmp('films-'),
      llmModel: null,
      allowPrivateNetworks: true,
    })
    const ctx = new LocalContext({ runId: 'run_joblink' })
    const r = await agent.run(ctx, { url: link, profile: profile('candidate'), format: 'square' })
    expect(r.company).toBe('Parcelpine')
    expect(r.host).toBe('parcelpine.example')
    expect(r.job).toEqual({ title: 'Operations Analyst', url: link })
    expect(r.highlights?.quote.source).toMatch(/Operations Analyst/)
  })

  it('says what to do when the post doesn’t link to the company', async () => {
    const link = 'https://boards.greenhouse.io/mystery/jobs/1'
    posts.set(link, { url: link, title: 'Engineer', requirements: ['Ship software'] })
    const agent = createFilmAgent({ filmsDir: tmp('films-'), llmModel: null })
    await expect(
      agent.run(new LocalContext({ runId: 'run_nosite' }), {
        url: link,
        profile: profile('candidate'),
        format: 'square',
      }),
    ).rejects.toThrow(/couldn't find the company's website.*Answer a job post/)
  })
})

describe('a LinkedIn job link, from the web app', () => {
  let sql: Sql
  let app: Awaited<ReturnType<typeof buildApi>>
  const auth = { authorization: 'Bearer k1' }
  const link = 'https://www.linkedin.com/jobs/view/4012345678'
  const text = [
    'Operations Analyst',
    'What you’ll bring:',
    '- Experience building dashboards that operations teams use every day',
    '- Strong SQL and spreadsheet modeling',
  ].join('\n')

  beforeAll(async () => {
    sql = await freshDb()
    app = await buildApi({
      sql,
      cfg: testConfig({ API_KEYS: 'k1', FILMS_DIR: tmp('jl-') }),
      log,
      slack: null,
    })
    await app.inject({
      method: 'PUT',
      url: '/v1/profiles/me',
      headers: auth,
      payload: { name: 'Me', data: profile('candidate') },
    })
  })
  afterAll(async () => {
    await app?.close()
    await sql?.end()
  })

  const queued = async () =>
    (await sql<{ n: number }[]>`select count(*)::int as n from runs where agent = 'film'`)[0]!.n

  it('asks for the description up front and queues nothing', async () => {
    const before = await queued()
    for (const payload of [
      { url: link, profileId: 'me' },
      { url: 'parcelpine.example', profileId: 'me', job: { url: link } },
    ]) {
      const r = await app.inject({ method: 'POST', url: '/v1/films', headers: auth, payload })
      expect(r.statusCode).toBe(422)
      expect(r.json().error).toEqual({
        code: 'job_needs_text',
        message: 'LinkedIn job pages need a login, so paste the job description below.',
      })
    }
    const noSite = await app.inject({
      method: 'POST',
      url: '/v1/films',
      headers: auth,
      payload: { url: link, profileId: 'me', job: { url: link, text } },
    })
    expect(noSite.statusCode).toBe(422)
    expect(noSite.json().error.code).toBe('job_needs_site')
    const batch = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: auth,
      payload: { jobs: [{ url: 'https://jobs.lever.co/acme/1' }, { url: link }], profileId: 'me' },
    })
    expect(batch.statusCode).toBe(422)
    expect(batch.json().error.code).toBe('job_needs_text')
    expect(await queued()).toBe(before)
  })

  it('with the pasted description and the website, queues a film that answers it', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/films',
      headers: auth,
      payload: { url: 'parcelpine.example', profileId: 'me', job: { url: link, text } },
    })
    expect(r.statusCode).toBe(202)
    expect(r.json()).toMatchObject({ url: 'https://parcelpine.example', job: { url: link } })
    const [run] = await sql<{ input: { job: { url: string; text: string } } }[]>`
      select input from runs where id = ${r.json().id}`
    expect(run!.input.job).toMatchObject({ url: link, text })

    const b = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: auth,
      payload: { jobs: [{ url: link, site: 'https://parcelpine.example', text }], profileId: 'me' },
    })
    expect(b.statusCode).toBe(202)
  })

  it('films the pasted post, not the LinkedIn page', async () => {
    const { url } = await fixtureServer()
    const agent = createFilmAgent({
      filmsDir: tmp('films-'),
      llmModel: null,
      allowPrivateNetworks: true,
    })
    const r = await agent.run(new LocalContext({ runId: 'run_pasted' }), {
      url: `${url}/parcelpine/`,
      job: { url: link, text },
      profile: profile('candidate'),
      format: 'square',
    })
    expect(r.company).toBe('Parcelpine')
    expect(r.job).toEqual({ title: 'Operations Analyst', url: link })
    expect(r.highlights?.quote.source).toMatch(/Operations Analyst/)
  })
})

describe('a login-walled job link that reaches the worker anyway', () => {
  it('fails once, without retrying, in the words the web app shows', async () => {
    const link = 'https://www.linkedin.com/jobs/view/99'
    posts.delete(link)
    const real =
      await vi.importActual<typeof import('../../src/job/read.ts')>('../../src/job/read.ts')
    await expect(real.fetchJob(link)).rejects.toMatchObject({
      code: 'non_retryable',
      message: 'LinkedIn job pages need a login, so paste the job description below.',
    })
  })
})
