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
    const n = calls.length
    expect(n).toBe(r.companies)
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
    expect(s.roles).toEqual(['FDE', 'Solutions Engineer'])
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
})
