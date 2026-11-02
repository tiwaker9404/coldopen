import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApi } from '../../src/api/server.ts'
import type { Sql } from '../../src/db/index.ts'
import { freshDb, log, profile, testConfig, tmp } from '../helpers/index.ts'

let sql: Sql
let app: Awaited<ReturnType<typeof buildApi>>
const auth = { authorization: 'Bearer k1' }
const calls: string[] = []
let down = false

const recent = new Date(Date.now() - 2 * 86_400_000).toISOString()
/** stands in for the three public APIs: Anthropic and Ramp list roles, the rest list none */
const fakeFetch = async (url: string) => {
  calls.push(url)
  if (down) return new Response('busy', { status: 503 })
  // one Greenhouse job, with its description
  if (url.endsWith('/boards/anthropic/jobs/11'))
    return Response.json({
      id: 11,
      content:
        '&lt;p&gt;&lt;strong&gt;What you will do&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Ship production agents with customers, with evals&lt;/li&gt;&lt;li&gt;Turn messy customer data into pipelines&lt;/li&gt;&lt;li&gt;Fluent in Kubernetes and Terraform&lt;/li&gt;&lt;/ul&gt;',
    })
  if (url.includes('/boards/anthropic/'))
    return Response.json({
      jobs: [
        {
          id: 11,
          title: 'Forward Deployed Engineer',
          absolute_url: 'https://job-boards.greenhouse.io/anthropic/jobs/11',
          location: { name: 'San Francisco, CA' },
          first_published: recent,
        },
        {
          id: 12,
          title: 'Recruiter',
          absolute_url: 'https://job-boards.greenhouse.io/anthropic/jobs/12',
          location: { name: 'San Francisco, CA' },
        },
      ],
    })
  if (url.includes('/job-board/ramp'))
    return Response.json({
      jobs: [
        {
          id: 'r1',
          title: 'Solutions Engineer',
          jobUrl: 'https://jobs.ashbyhq.com/ramp/r1',
          location: 'Remote (US)',
          isRemote: true,
          publishedAt: recent,
          descriptionHtml:
            '<h2>Requirements</h2><ul><li><p>Ten years of iOS development in Swift</p></li><li><p>Clinical trial design experience</p></li><li><p>Fluent Japanese for client calls</p></li></ul>',
        },
      ],
    })
  if (url.includes('/postings/acme-labs'))
    return Response.json([
      {
        id: 'a1',
        text: 'Forward Deployed Engineer',
        hostedUrl: 'https://jobs.lever.co/acme-labs/a1',
        categories: { location: 'Oakland, CA' },
      },
    ])
  if (url.includes('greenhouse')) return Response.json({ jobs: [] })
  if (url.includes('lever')) return Response.json([])
  return Response.json({ jobs: [] })
}

beforeAll(async () => {
  sql = await freshDb()
  app = await buildApi({
    sql,
    cfg: testConfig({ API_KEYS: 'k1', FILMS_DIR: tmp('jobs-films-') }),
    log,
    slack: null,
    jobsFetch: fakeFetch as never,
  })
  const p = profile('candidate')
  await app.inject({
    method: 'PUT',
    url: '/v1/profiles/me',
    headers: auth,
    payload: {
      name: 'Me',
      data: { ...p, sender: { ...p.sender, role: 'Forward Deployed Engineer' } },
    },
  })
})
afterAll(async () => {
  await app?.close()
  await sql?.end()
})

const suggested = async () => {
  const r = await app.inject({ method: 'GET', url: '/v1/jobs/suggested', headers: auth })
  expect(r.statusCode).toBe(200)
  return r.json()
}

describe('suggested jobs', () => {
  it('starts from the profile role, and reads every board once', async () => {
    const s = await (
      await app.inject({ method: 'GET', url: '/v1/jobs/search', headers: auth })
    ).json()
    expect(s).toMatchObject({ roles: ['Forward Deployed Engineer'], suggested: true, boards: [] })

    const r = await suggested()
    expect(
      r.data.map((j: { title: string; company: string }) => `${j.title} @ ${j.company}`),
    ).toEqual(['Forward Deployed Engineer @ Anthropic'])
    expect(r.data[0]).toMatchObject({
      site: 'https://www.anthropic.com/',
      url: 'https://job-boards.greenhouse.io/anthropic/jobs/11',
      why: ['Forward Deployed Engineer', 'New this week'],
    })
    expect(r.companies).toBeGreaterThan(50)
    expect(r.failed).toEqual([])
    // every board once, plus the one Greenhouse post read for its requirements
    const n = calls.length
    expect(calls.filter((u) => !u.endsWith('/jobs/11'))).toHaveLength(r.companies)
    // cached: a second look fetches nothing
    await suggested()
    expect(calls.length).toBe(n)
  })

  it('searches the roles, places and boards they set', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/v1/jobs/search',
      headers: auth,
      payload: {
        roles: ['FDE', 'Solutions Engineer'],
        locations: ['Bay Area'],
        remote: true,
        boards: ['https://jobs.lever.co/acme-labs/a1'],
      },
    })
    expect(put.statusCode).toBe(200)
    expect(put.json().boards).toEqual([{ ats: 'lever', token: 'acme-labs', name: 'Acme Labs' }])
    const r = await suggested()
    expect(
      r.data.map((j: { company: string; why: string[] }) => `${j.company}: ${j.why.join(', ')}`),
    ).toEqual([
      'Anthropic: FDE, San Francisco, CA, New this week',
      'Ramp: Solutions Engineer, Remote, New this week',
      'Acme Labs: FDE, Oakland, CA',
    ])
  })

  it('says how well each job fits the record, and reads each post once', async () => {
    const r = await suggested()
    const by = (c: string) => r.data.find((j: { company: string }) => j.company === c)
    expect(by('Anthropic').fit).toEqual({
      level: 'strong',
      answered: 2,
      of: 3,
      best: {
        requirement: 'Turn messy customer data into pipelines',
        with: 'Turns messy customer data into working pipelines',
      },
    })
    expect(by('Acme Labs').fit).toBeUndefined()
    const reads = calls.filter((u) => u.endsWith('/jobs/11')).length
    expect(reads).toBe(1)
    await suggested()
    expect(calls.filter((u) => u.endsWith('/jobs/11')).length).toBe(1)
  })

  it('puts a strong fit above a stretch with the same title', async () => {
    await app.inject({
      method: 'PUT',
      url: '/v1/jobs/search',
      headers: auth,
      payload: { roles: ['Solutions Engineer', 'Forward Deployed Engineer'], remote: true },
    })
    const r = await suggested()
    const ramp = r.data.find((j: { company: string }) => j.company === 'Ramp')
    expect(ramp.fit.level).toBe('stretch')
    // both are new this week; the fit decides
    expect(r.data[0].company).toBe('Anthropic')
  })

  it('refuses links that are not careers boards', async () => {
    const r = await app.inject({
      method: 'PUT',
      url: '/v1/jobs/search',
      headers: auth,
      payload: { roles: ['FDE'], boards: ['https://acme.com/careers'] },
    })
    expect(r.statusCode).toBe(422)
    expect(r.json().error.code).toBe('bad_board')
  })

  it('marks jobs that already have a film, and hides dismissed ones', async () => {
    const f = await app.inject({
      method: 'POST',
      url: '/v1/films',
      headers: auth,
      payload: {
        url: 'https://www.anthropic.com/',
        job: { url: 'https://job-boards.greenhouse.io/anthropic/jobs/11' },
      },
    })
    expect(f.statusCode).toBe(202)
    let r = await suggested()
    expect(r.data.find((j: { company: string }) => j.company === 'Anthropic').filmId).toBe(
      f.json().id,
    )

    const ramp = r.data.find((j: { company: string }) => j.company === 'Ramp')
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/jobs/${encodeURIComponent(ramp.id)}/hide`,
          headers: auth,
        })
      ).statusCode,
    ).toBe(200)
    r = await suggested()
    expect(r.data.some((j: { company: string }) => j.company === 'Ramp')).toBe(false)
    // hiding keeps their search as it was
    const s = await (
      await app.inject({ method: 'GET', url: '/v1/jobs/search', headers: auth })
    ).json()
    expect(s.roles).toEqual(['Solutions Engineer', 'Forward Deployed Engineer'])
  })

  it('says which boards it could never read', async () => {
    down = true
    const put = await app.inject({
      method: 'PUT',
      url: '/v1/jobs/search',
      headers: auth,
      payload: { roles: ['FDE'], boards: ['jobs.ashbyhq.com/brand-new'] },
    })
    expect(put.statusCode).toBe(200)
    const r = await suggested()
    down = false
    expect(r.failed).toEqual(['Brand New'])
  })

  it('keeps the last listing when a board is down', async () => {
    await sql`update job_boards set fetched_at = now() - interval '1 day'`
    down = true
    const r = await suggested()
    down = false
    expect(r.data.some((j: { company: string }) => j.company === 'Anthropic')).toBe(true)
    // only the board that was never read counts as failed
    expect(r.failed).toEqual(['Brand New'])
    expect(r.data.some((j: { company: string }) => j.company === 'Ramp')).toBe(false)
    const [b] = await sql`select ok, error from job_boards where board = 'greenhouse:anthropic'`
    expect(b).toMatchObject({ ok: false })
  })
  it('makes one film per job post in a batch, answering each post', async () => {
    const b = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: auth,
      payload: {
        jobs: [
          { url: 'https://jobs.ashbyhq.com/ramp/r1', site: 'https://ramp.com/' },
          { url: 'https://jobs.lever.co/acme-labs/a1' },
          { url: 'https://jobs.ashbyhq.com/ramp/r1', site: 'https://ramp.com/' },
        ],
      },
    })
    expect(b.statusCode).toBe(202)
    expect(b.json().films).toBe(2)
    const runs = await sql<{ input: { url: string; job?: { url: string }; batch: string } }[]>`
      select input from runs where input->>'batch' = ${b.json().batch} order by id`
    expect(runs.map((r) => [r.input.url, r.input.job?.url ?? null])).toEqual([
      ['https://ramp.com/', 'https://jobs.ashbyhq.com/ramp/r1'],
      // no website known: the job link is the film's link, and names the company
      ['https://jobs.lever.co/acme-labs/a1', null],
    ])
    const both = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: auth,
      payload: { urls: ['acme.com'], jobs: [{ url: 'https://jobs.lever.co/acme-labs/a1' }] },
    })
    expect(both.statusCode).toBe(400)
  })
})
