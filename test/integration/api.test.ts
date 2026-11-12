import { createHmac } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type KV, handle as shareWorker } from '../../share/worker.ts'
import { buildApi } from '../../src/api/server.ts'
import { makeToken } from '../../src/api/tokens.ts'
import type { Sql } from '../../src/db/index.ts'
import { searchStartups } from '../../src/jobs/startups.ts'
import { ScriptedProvider } from '../../src/llm/scripted.ts'
import { FILM } from '../../src/outreach/writer.ts'
import { publish, SCENE_STILLS } from '../../src/share/client.ts'
import { SlackClient } from '../../src/slack.ts'
import { freshDb, log, profile, testConfig, tmp } from '../helpers/index.ts'

let sql: Sql
let app: Awaited<ReturnType<typeof buildApi>>
let slackServer: Server
const slackCalls: { method: string; body: string }[] = []
const filmsDir = tmp('api-films-')
const auth = { authorization: 'Bearer k1' }
const SIGNING = 'signing-secret'

beforeAll(async () => {
  sql = await freshDb()
  slackServer = createServer(async (req, res) => {
    let body = ''
    for await (const c of req) body += c
    slackCalls.push({ method: req.url!.replace('/api/', ''), body })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, ts: '1.1' }))
  })
  await new Promise<void>((r) => slackServer.listen(0, '127.0.0.1', r))
  const port = (slackServer.address() as { port: number }).port
  const cfg = testConfig({
    API_KEYS: 'k1',
    FILMS_DIR: filmsDir,
    PUBLIC_URL: 'https://films.example.com',
    SLACK_SIGNING_SECRET: SIGNING,
    SLACK_BOT_TOKEN: 'xoxb',
  })
  app = await buildApi({
    sql,
    cfg,
    log,
    slack: new SlackClient('xoxb', `http://127.0.0.1:${port}/api`),
  })
})

afterAll(async () => {
  await app?.close()
  await sql?.end()
  slackServer?.close()
})

const putProfile = () =>
  app.inject({
    method: 'PUT',
    url: '/v1/profiles/maya',
    headers: auth,
    payload: { name: 'Maya at Tessellate', data: profile('sales') },
  })

/** Pretend a worker finished the film: write the run output and the media files. */
async function finish(id: string, company = 'Acme') {
  mkdirSync(join(filmsDir, id), { recursive: true })
  for (const f of ['film-square.mp4', 'poster.jpg', 'preview.gif', 'contact-sheet.jpg', 'kit.json'])
    writeFileSync(join(filmsDir, id, f), 'x')
  const output = {
    company,
    host: 'acme.com',
    format: 'square',
    durationSec: 29.2,
    files: {
      film: `${id}/film-square.mp4`,
      poster: `${id}/poster.jpg`,
      gif: `${id}/preview.gif`,
      sheet: `${id}/contact-sheet.jpg`,
      kit: `${id}/kit.json`,
      storyboard: `${id}/storyboard.json`,
    },
    script: {
      hook: 'Hi Acme team',
      noticed: 'x',
      insight: { factId: 'f1', why: 'y' },
      pitch: { headline: 'h', points: ['a', 'b'] },
      proof: [0],
      cta: 'Talk soon?',
    },
    scriptMeta: { model: 'deterministic', rounds: 1, violations: [[]], usedFallback: false },
    qa: { duration: 29.2, issues: [], fonts: [] },
    render: { frames: 876, ms: 50000 },
  }
  await sql`update runs set status = 'succeeded', completed_at = now(), output = ${sql.json(output as never)} where id = ${id}`
}

describe('auth and profiles', () => {
  it('requires a key on /v1 but not on share pages', async () => {
    expect((await app.inject({ url: '/v1/films' })).statusCode).toBe(401)
    expect((await app.inject({ url: '/v1/films?key=k1' })).statusCode).toBe(401) // keys only via header
    expect((await app.inject({ url: '/v1/films', headers: auth })).statusCode).toBe(200)
  })

  it('needs a profile before making films, then uses it', async () => {
    const none = await app.inject({
      method: 'POST',
      url: '/v1/films',
      headers: auth,
      payload: { url: 'acme.com' },
    })
    expect(none.statusCode).toBe(422)
    expect((await putProfile()).statusCode).toBe(200)
    const list = await app.inject({ url: '/v1/profiles', headers: auth })
    expect(list.json().data[0]).toMatchObject({ id: 'maya', name: 'Maya at Tessellate' })
    const bad = await app.inject({
      method: 'PUT',
      url: '/v1/profiles/x',
      headers: auth,
      payload: { name: 'x', data: { offer: '' } },
    })
    expect(bad.statusCode).toBe(400)
  })

  it('explains a profile it cannot save in plain words, field by field', async () => {
    const data = structuredClone(profile('sales'))
    data.proof[0]!.label = 'x'
    data.proof[0]!.value = 'way more than twelve'
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/profiles/maya',
      headers: auth,
      payload: { name: 'Maya at Tessellate', data },
    })
    expect(res.statusCode).toBe(400)
    const { error } = res.json()
    expect(error.code).toBe('invalid_request')
    expect(error.message).toBe(
      '2 things need fixing. First: the number in result 1 can be at most 12 characters.',
    )
    expect(error.fields).toEqual([
      { path: 'proof.0.value', message: 'The number in result 1 can be at most 12 characters' },
      { path: 'proof.0.label', message: 'What result 1 measures needs at least 3 characters' },
    ])
    expect(error.message).not.toMatch(/body\/|expected|>=/)
  })

  it('keeps the creator line on a profile through save and load', async () => {
    const creator = {
      name: 'coldopen',
      url: 'https://github.com/maya/coldopen',
      line: 'I built the tool that made this film',
    }
    const data = { ...profile('sales'), creator }
    const put = await app.inject({
      method: 'PUT',
      url: '/v1/profiles/maya-made',
      headers: auth,
      payload: { name: 'Maya, maker', data },
    })
    expect(put.statusCode).toBe(200)
    const list = (await app.inject({ url: '/v1/profiles', headers: auth })).json()
    const back = list.data.find((p: { id: string }) => p.id === 'maya-made')
    expect(back.data).toEqual(data)
  })

  it("says a garbled request isn't valid JSON instead of echoing the parser", async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/profiles/maya',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: '{not json',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.message).toBe("That request wasn't valid JSON.")
  })

  it('drafts a profile from an uploaded résumé, leaving excluded employers out', async () => {
    const resume = readFileSync(
      join(import.meta.dirname, '../../fixtures/resumes/marco-marketer.md'),
    )
    const res = await app.inject({
      method: 'POST',
      url: '/v1/profiles/draft',
      headers: auth,
      payload: {
        filename: 'marco.md',
        data: resume.toString('base64'),
        role: 'Lifecycle marketing manager',
        exclude: ['Brightside'],
      },
    })
    expect(res.statusCode).toBe(200)
    const { profile, meta } = res.json()
    expect(meta.model).toBe('deterministic')
    expect(profile.sender).toEqual({ name: 'Marco Ruiz', role: 'Lifecycle marketing manager' })
    // a before and an after is drafted as the change, with what was done
    expect(profile.proof).toContainEqual(
      expect.objectContaining({ value: '$48 → $31', did: 'Rebuilt paid social creative testing' }),
    )
    // the excluded employer's name is gone; its work stays, placed by the role
    expect(JSON.stringify(profile)).not.toMatch(/brightside/i)
    expect(
      profile.proof.some((p: { where?: string }) => p.where === 'Marketing Associate role'),
    ).toBe(true)

    const junk = await app.inject({
      method: 'POST',
      url: '/v1/profiles/draft',
      headers: auth,
      payload: {
        filename: 'cv.txt',
        data: Buffer.from('too short').toString('base64'),
        role: 'PM',
      },
    })
    expect(junk.statusCode).toBe(422)
    expect(junk.json().error.message).toMatch(/almost no text/)
  })
})

describe('films', () => {
  it('queues a film, normalizes the URL and is idempotent', async () => {
    const make = (url: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/films',
        headers: { ...auth, 'idempotency-key': 'crm-row-7' },
        payload: { url, profileId: 'maya' },
      })
    const a = await make('acme.com')
    expect(a.statusCode).toBe(202)
    expect(a.json()).toMatchObject({
      status: 'queued',
      url: 'https://acme.com',
      sender: 'Maya Chen',
      files: null,
      share: null,
    })
    const b = await make('acme.com')
    expect(b.statusCode).toBe(200)
    expect(b.json().id).toBe(a.json().id)
    expect((await make('globex.com')).statusCode).toBe(409)
  })

  it('serves the share page, public media and an email snippet once a film is done', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/films',
      headers: auth,
      payload: { url: 'acme.com' },
    })
    const id = created.json().id as string
    expect((await app.inject({ url: `/f/${id}` })).statusCode).toBe(404)
    await finish(id)

    const detail = (await app.inject({ url: `/v1/films/${id}`, headers: auth })).json()
    expect(detail.share).toBe(`https://films.example.com/f/${id}`)
    expect(detail.embed).toContain(`https://films.example.com/f/${id}/preview.gif`)
    expect(detail.embed).toMatch(new RegExp(`^<a href="https://films.example.com/f/${id}"`))

    const page = await app.inject({ url: `/f/${id}` })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('og:video')
    expect(page.body).toContain('mailto:maya@tessellate.example')
    expect((await app.inject({ url: `/f/${id}/film-square.mp4` })).statusCode).toBe(200)
    expect((await app.inject({ url: `/f/${id}/kit.json` })).statusCode).toBe(404) // research stays private
    expect(
      (await app.inject({ url: `/v1/films/${id}/files/kit.json`, headers: auth })).statusCode,
    ).toBe(200)
    expect(
      (await app.inject({ url: `/v1/films/${id}/files/..%2F..%2Fetc%2Fpasswd`, headers: auth }))
        .statusCode,
    ).toBe(404)
  })

  it('takes a job post to answer, as a link or pasted text', async () => {
    const withText = await app.inject({
      method: 'POST',
      url: '/v1/films',
      headers: auth,
      payload: {
        url: 'hiring-a.example',
        job: {
          text: 'Solutions Engineer\nRequirements:\n- Five years of customer-facing engineering',
        },
      },
    })
    expect(withText.statusCode).toBe(202)
    expect(withText.json().job).toEqual({ title: null, url: null })
    const withUrl = await app.inject({
      method: 'POST',
      url: '/v1/films',
      headers: auth,
      payload: { url: 'hiring-b.example', job: { url: 'https://jobs.example.com/se' } },
    })
    expect(withUrl.json().job).toEqual({ title: null, url: 'https://jobs.example.com/se' })
    const empty = await app.inject({
      method: 'POST',
      url: '/v1/films',
      headers: auth,
      payload: { url: 'hiring-a.example', job: {} },
    })
    expect(empty.statusCode).toBe(400)
  })

  it('counts who watched the share page, not bots, and reports it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/films',
      headers: auth,
      payload: { url: 'globex.com' },
    })
    const id = created.json().id as string
    await finish(id, 'Globex')
    const page = await app.inject({ url: `/f/${id}` })
    expect(page.body).toContain(`https://films.example.com/f/${id}/v`) // the page reports views

    const chrome =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    const beacon = (body: unknown, ua = chrome) =>
      app.inject({
        method: 'POST',
        url: `/f/${id}/v`,
        headers: { 'content-type': 'text/plain', 'user-agent': ua },
        payload: JSON.stringify(body),
      })
    const s = 'session-aaaaaaaa'
    expect(
      (await beacon({ s, e: 'open', t: 0, d: 30, r: 'https://www.linkedin.com/feed/' })).statusCode,
    ).toBe(204)
    await beacon({ s, e: 'play', t: 0, d: 30 })
    await beacon({ s, e: 'progress', t: 12.4, d: 30 })
    await beacon({ s: 'session-bbbbbbbb', e: 'open', t: 0, d: 30 })
    // a link unfurler and garbage are ignored, quietly
    await beacon({ s: 'session-cccccccc', e: 'play', t: 9, d: 30 }, 'Slackbot-LinkExpanding 1.0')
    expect((await beacon('not json')).statusCode).toBe(204)
    // a film that doesn't exist answers the same
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/f/run_00000000000000000000000000/v',
          payload: '{}',
          headers: { 'content-type': 'text/plain', 'user-agent': chrome },
        })
      ).statusCode,
    ).toBe(204)

    const v = (await app.inject({ url: `/v1/films/${id}/views`, headers: auth })).json()
    expect(v.summary).toMatchObject({
      opens: 2,
      viewers: 1,
      plays: 1,
      finishes: 0,
      bestSeconds: 12.4,
    })
    expect(v.sessions[0].referrer ?? v.sessions[1].referrer).toBe('linkedin.com')
    expect(JSON.stringify(v)).not.toContain('127.0.0.1') // no IP address is kept

    const listed = (await app.inject({ url: '/v1/films', headers: auth }))
      .json()
      .data.find((f: { id: string }) => f.id === id)
    expect(listed.views.plays).toBe(1)
    expect((await app.inject({ url: `/v1/films/${id}/views` })).statusCode).toBe(401)
  })

  it('batches a prospect list and exports CRM-ready CSV', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/batches',
      headers: auth,
      payload: { urls: ['initech.com', 'https://umbrella.com', 'initech.com'], profileId: 'maya' },
    })
    expect(res.statusCode).toBe(202)
    const { batch, films } = res.json()
    expect(films).toBe(2) // duplicates collapse
    const list = (await app.inject({ url: `/v1/films?batch=${batch}`, headers: auth })).json().data
    await finish(list.find((f: { url: string }) => f.url === 'https://initech.com').id, 'Initech')

    const csv = await app.inject({ url: `/v1/batches/${batch}/results.csv`, headers: auth })
    expect(csv.headers['content-type']).toContain('text/csv')
    const lines = csv.body.trim().split('\n')
    expect(lines[0]).toBe(
      'url,company,status,share_url,gif_url,video_url,email_snippet,plays,finishes,best_seconds,last_viewed',
    )
    expect(lines[1]).toMatch(
      /^https:\/\/initech\.com,Initech,succeeded,https:\/\/films\.example\.com\/f\/run_/,
    )
    expect(lines[2]).toMatch(/^https:\/\/umbrella\.com,,queued,/)
  })

  it('drafts the messages to send with a film, and tracks whether they replied', async () => {
    const create = (url: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/films',
        headers: auth,
        payload: { url, profileId: 'maya' },
      })
    const a = (await create('replyco.example')).json().id
    const b = (await create('quietco.example')).json().id

    // not finished: nothing to send yet
    const early = await app.inject({
      method: 'PUT',
      url: `/v1/films/${a}/outreach`,
      headers: auth,
      payload: { status: 'sent' },
    })
    expect(early.statusCode).toBe(409)
    await finish(a, 'ReplyCo')
    await finish(b, 'QuietCo')

    const m = (await app.inject({ url: `/v1/films/${a}/messages`, headers: auth })).json()
    expect(m.email.subject).toBeTruthy()
    expect(m.email.body).toContain('https://films.example.com/f/')
    expect(m.linkedin.length).toBeLessThanOrEqual(200)
    expect(m.linkedin).not.toContain('http')
    expect(m.afterAccept).toContain('https://films.example.com/f/')

    const mark = (id: string, status: string | null) =>
      app.inject({
        method: 'PUT',
        url: `/v1/films/${id}/outreach`,
        headers: auth,
        payload: { status },
      })
    const sent = (await mark(a, 'sent')).json().outreach
    expect(sent.status).toBe('sent')
    const replied = (await mark(a, 'interview')).json().outreach
    expect(replied).toMatchObject({ status: 'interview', sentAt: sent.sentAt })
    await mark(b, 'no_reply')
    expect((await mark(b, 'bogus')).statusCode).toBe(400)

    const sum = (await app.inject({ url: '/v1/outreach', headers: auth })).json()
    expect(sum).toEqual({
      sent: 2,
      replied: 1,
      interviews: 1,
      noReply: 1,
      waiting: 0,
      replyRate: 0.5,
    })

    // which opener did better, and the public totals for the landing page
    const op = (await app.inject({ url: '/v1/me/openers', headers: auth })).json()
    expect(op.film.sent + op.proof.sent).toBe(2)
    // a seller's films: the job seeker's pair has no sends
    expect(op.homework).toEqual({ sent: 0, watched: 0, replied: 0 })
    expect(op.question).toEqual({ sent: 0, watched: 0, replied: 0 })
    expect(op.film.replied + op.proof.replied).toBe(1)
    expect(op.leader).toBeNull()
    expect(typeof m.opener).toBe('string')
    const stats = await app.inject({ url: '/v1/stats', headers: auth })
    expect(stats.headers['access-control-allow-origin']).toBe('*')
    expect(stats.json().outreach).toMatchObject({ sent: 2, replied: 1 })

    expect((await mark(b, null)).json().outreach).toBeNull()
    expect((await app.inject({ url: '/v1/outreach', headers: auth })).json().sent).toBe(1)
  })

  /** a finished film to save homework on */
  const homeworkFilm = async (host: string) => {
    const id = (
      await app.inject({ method: 'POST', url: '/v1/films', headers: auth, payload: { url: host } })
    ).json().id as string
    await finish(id, 'Homework Co')
    return id
  }
  const putHomework = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: `/v1/films/${id}/homework`, headers: auth, payload })
  const filmOf = async (id: string) =>
    (await app.inject({ url: `/v1/films/${id}`, headers: auth })).json()

  it("saves a film's homework and returns it", async () => {
    const id = await homeworkFilm('homework-one.example')
    const built = {
      url: 'https://github.com/maya/rates-sync',
      line: 'Syncs their rates into checkout',
    }
    const all = await putHomework(id, {
      detail: 'the rate table took a minute to load on every page',
      question: 'Are most customers calling the API directly, or using the Shopify app?',
      built,
    })
    expect(all.statusCode).toBe(200)
    expect(all.json()).toEqual({
      detail: 'the rate table took a minute to load on every page',
      question: 'Are most customers calling the API directly, or using the Shopify app?',
      built,
    })
    expect(await filmOf(id)).toMatchObject({
      detail: 'the rate table took a minute to load on every page',
      question: 'Are most customers calling the API directly, or using the Shopify app?',
      built,
    })
    // only a question: the detail and the build stay as they were
    const q = await putHomework(id, { question: 'Who owns onboarding for new merchants today?' })
    expect(q.json()).toMatchObject({
      detail: 'the rate table took a minute to load on every page',
      question: 'Who owns onboarding for new merchants today?',
      built,
    })
    // null clears one field and leaves the rest
    const cleared = await putHomework(id, { built: null })
    expect(cleared.json()).toEqual({
      detail: 'the rate table took a minute to load on every page',
      question: 'Who owns onboarding for new merchants today?',
      built: null,
    })
    // the email still opens with the detail
    const m = (await app.inject({ url: `/v1/films/${id}/messages`, headers: auth })).json()
    expect(m.email.body).toContain('the rate table took a minute to load on every page')
  })

  it('keeps the detail route working', async () => {
    const id = await homeworkFilm('homework-two.example')
    await putHomework(id, { question: 'Who owns onboarding for new merchants today?' })
    const r = await app.inject({
      method: 'PUT',
      url: `/v1/films/${id}/detail`,
      headers: auth,
      payload: { detail: 'the CSV export dropped every custom field' },
    })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ detail: 'the CSV export dropped every custom field' })
    // it writes the detail only
    expect(await filmOf(id)).toMatchObject({
      detail: 'the CSV export dropped every custom field',
      question: 'Who owns onboarding for new merchants today?',
      built: null,
    })
  })

  it("rejects a built link that isn't https", async () => {
    const id = await homeworkFilm('homework-three.example')
    const r = await putHomework(id, {
      built: { url: 'http://github.com/maya/rates-sync', line: 'Syncs their rates into checkout' },
    })
    expect(r.statusCode).toBe(400)
    expect(r.json().error.fields).toEqual([
      { path: 'built.url', message: 'The link to what you built with it starts with https://' },
    ])
    expect(r.json().error.message).toBe('The link to what you built with it starts with https://.')
    expect((await filmOf(id)).built).toBeNull()
  })

  it("won't save homework on another owner's film", async () => {
    const id = await homeworkFilm('homework-four.example')
    await sql`update runs set owner = 'u:someone-else' where id = ${id}`
    const r = await putHomework(id, { question: 'Who owns onboarding for new merchants today?' })
    expect(r.statusCode).toBe(404)
    const [row] = await sql<
      { question: string | null }[]
    >`select question from runs where id = ${id}`
    expect(row!.question).toBeNull()
  })

  it('lists films due a follow-up with the message ready, and records each one sent', async () => {
    const id = (
      await app.inject({
        method: 'POST',
        url: '/v1/films',
        headers: auth,
        payload: { url: 'followup.example' },
      })
    ).json().id
    await finish(id, 'Followup Co')
    await app.inject({
      method: 'PUT',
      url: `/v1/films/${id}/outreach`,
      headers: auth,
      payload: { status: 'sent' },
    })
    const list = async () => (await app.inject({ url: '/v1/followups', headers: auth })).json()
    // just sent: nothing due yet
    expect((await list()).data.some((d: { film: { id: string } }) => d.film.id === id)).toBe(false)
    // five days later
    const back = new Date(Date.now() - 5 * 86_400_000).toISOString()
    await sql`update runs set outreach = jsonb_set(jsonb_set(outreach, '{sentAt}', to_jsonb(${back}::text)), '{at}', to_jsonb(${back}::text)) where id = ${id}`
    const due = (await list()).data.find((d: { film: { id: string } }) => d.film.id === id)
    expect(due.next).toMatchObject({ kind: 'follow_up', step: 1, due: true })
    expect(due.message.subject).toMatch(/^Re: /)
    expect(due.message.body).toContain('Bumping this')
    expect(due.film.outreach.next).toMatchObject({ step: 1, due: true })

    const f = await app.inject({ method: 'POST', url: `/v1/films/${id}/followup`, headers: auth })
    expect(f.json().outreach).toMatchObject({ status: 'sent', followUps: 1 })
    expect(f.json().outreach.next).toMatchObject({ step: 2, due: false })
    expect((await list()).data.some((d: { film: { id: string } }) => d.film.id === id)).toBe(false)
    // a reply keeps the follow-up count, and ends the follow-ups
    const r = await app.inject({
      method: 'PUT',
      url: `/v1/films/${id}/outreach`,
      headers: auth,
      payload: { status: 'replied' },
    })
    expect(r.json().outreach).toMatchObject({ status: 'replied', followUps: 1, next: null })
    expect(
      (await app.inject({ method: 'POST', url: `/v1/films/${id}/followup`, headers: auth }))
        .statusCode,
    ).toBe(409)
  })

  it('re-renders a film with edited lines, and keeps numbers honest', async () => {
    const a = (
      await app.inject({
        method: 'POST',
        url: '/v1/films',
        headers: auth,
        payload: { url: 'editco.example', profileId: 'maya' },
      })
    ).json().id
    const edit = (id: string, body: object) =>
      app.inject({ method: 'POST', url: `/v1/films/${id}/edit`, headers: auth, payload: body })

    expect((await edit(a, { hook: 'Hello there' })).statusCode).toBe(409)
    await finish(a, 'Editco')

    // too long for the screen, and a number from nowhere
    const bad = await edit(a, { hook: 'Hello Editco team, we grew 97% last year' })
    expect(bad.statusCode).toBe(422)
    expect(bad.json().error.issues).toEqual([
      'The greeting has 8 words; it fits 6 on screen',
      'The greeting says "97%", which isn\'t in your profile or the film. Numbers have to come from one of those',
    ])

    const ok = await edit(a, { hook: 'Hello Editco team', points: ['first point', 'second point'] })
    expect(ok.statusCode).toBe(202)
    expect(ok.json()).toMatchObject({ status: 'queued', editOf: a, url: 'https://editco.example' })
    const [run] = await sql<
      { input: { script: { hook: string; pitch: { points: string[] } }; editOf: string } }[]
    >`
      select input from runs where id = ${ok.json().id}`
    expect(run!.input.script.hook).toBe('Hello Editco team')
    expect(run!.input.script.pitch.points).toEqual(['first point', 'second point'])

    // an edit of an edit still counts against the first film: 5 in all
    const second = ok.json().id
    await finish(second, 'Editco')
    expect((await edit(second, { cta: 'Talk this week?' })).json().editOf).toBe(a)
    for (let i = 0; i < 3; i++)
      expect((await edit(a, { cta: `Talk soon ${'x'.repeat(i)}?` })).statusCode).toBe(202)
    expect((await edit(a, { cta: 'One more?' })).statusCode).toBe(429)
  })

  it('reviews a finished film scene by scene, and swaps the fact or proof to re-render', async () => {
    const make = async (url: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/v1/films',
          headers: auth,
          payload: { url, profileId: 'maya' },
        })
      ).json().id as string
    const id = await make('reviewco.example')
    const review = () => app.inject({ method: 'GET', url: `/v1/films/${id}/review`, headers: auth })
    expect((await review()).statusCode).toBe(409)

    // a film that quotes a line leaning on nothing, with two facts that read on their own
    await finish(id, 'Reviewco')
    const facts = [
      {
        id: 'f17',
        text: "We'll show it live in 20 minutes.",
        kind: 'stat',
        caption: 'From their homepage',
      },
      {
        id: 'f4',
        text: 'Reviewco cut late deliveries by 38% for its shippers in the first quarter.',
        kind: 'stat',
        caption: 'From their homepage',
      },
      {
        id: 'h1',
        text: 'Reviewco now flags every late carrier before the shopper notices it.',
        kind: 'quote',
        caption: 'From their changelog, Oct 2026',
      },
    ]
    await sql`
      update runs set output = output
        || ${sql.json({
          script: {
            hook: 'Hi Reviewco team',
            noticed: 'Your homepage leads with live pallet tracking',
            insight: { factId: 'f17', why: 'Tessellate shows which features keep shippers' },
            pitch: {
              headline: 'Retention analytics for freight teams',
              points: ['a b c', 'd e f'],
            },
            proof: [0],
            cta: 'Worth a 15-minute look?',
          },
          scriptMeta: {
            model: 'openai/gpt-oss-120b',
            rounds: 1,
            violations: [[]],
            usedFallback: false,
            replaced: [],
          },
          highlights: {
            quote: {
              text: facts[0]!.text,
              source: 'reviewco.example',
              caption: 'From their homepage',
            },
            proof: [],
          },
          facts,
          brand: {
            logo: 'wordmark',
            fallbacks: {},
            fonts: { display: 'Inter', body: 'Inter' },
            contrast: [],
          },
        } as never)}
      where id = ${id}`

    const r = await review()
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(body.ready).toBe(false)
    expect(body.scenes.map((s: { kind: string }) => s.kind)).toEqual([
      'hook',
      'site',
      'insight',
      'pitch',
      'proof',
      'cta',
    ])
    const flag = body.scenes[2].flags[0]
    expect(flag).toMatchObject({ code: 'fact_out_of_context', fix: { kind: 'fact' } })
    expect(flag.fix.options.map((o: { id: string }) => o.id)).toEqual(['f4', 'h1'])
    expect(body.scenes[0].flags[0]).toMatchObject({ code: 'no_logo', fix: { kind: 'wordmark' } })
    // the film itself carries the review, so MCP get_film has the flags too
    const film = (await app.inject({ method: 'GET', url: `/v1/films/${id}`, headers: auth })).json()
    expect(film.review).toEqual(body)

    const edit = (b: object) =>
      app.inject({ method: 'POST', url: `/v1/films/${id}/edit`, headers: auth, payload: b })
    // only facts this film could quote, and only results that are in the profile
    expect((await edit({ factId: 'f99' })).json().error.code).toBe('fact_unknown')
    expect((await edit({ proof: [0, 0] })).json().error.code).toBe('proof_unknown')
    expect((await edit({ proof: [7] })).json().error.code).toBe('proof_unknown')

    // "Use another fact" re-queues the render with that fact, matched by its words
    const swapped = await edit({ factId: 'f4' })
    expect(swapped.statusCode).toBe(202)
    expect(swapped.json()).toMatchObject({ status: 'queued', editOf: id })
    const [a] = await sql<{ input: { script: { insight: { factId: string } }; fact: object } }[]>`
      select input from runs where id = ${swapped.json().id}`
    expect(a!.input.script.insight.factId).toBe('f4')
    expect(a!.input.fact).toEqual({ id: 'f4', text: facts[1]!.text })

    // "Use another proof" and "Use their name as the logo" go the same way
    const proof = await edit({ proof: [2, 1], wordmark: true })
    expect(proof.statusCode).toBe(202)
    const [b] = await sql<{ input: { script: { proof: number[] }; wordmark: boolean } }[]>`
      select input from runs where id = ${proof.json().id}`
    expect(b!.input.script.proof).toEqual([2, 1])
    expect(b!.input.wordmark).toBe(true)

    // the same swap twice makes the same film to render
    const again = await edit({ factId: 'f4' })
    const [c] = await sql<{ input: object }[]>`select input from runs where id = ${again.json().id}`
    expect(c!.input).toEqual(a!.input)

    // someone else's film is not found, for the review and the swaps alike
    const other = await make('notyours.example')
    await finish(other, 'Notyours')
    await sql`update runs set owner = 'u:someone-else' where id = ${other}`
    for (const res of [
      await app.inject({ method: 'GET', url: `/v1/films/${other}/review`, headers: auth }),
      await app.inject({
        method: 'POST',
        url: `/v1/films/${other}/edit`,
        headers: auth,
        payload: { factId: 'f1' },
      }),
    ])
      expect(res.statusCode).toBe(404)
  })

  it('saves downloads under the name asked for', async () => {
    const id = (
      await app.inject({
        method: 'POST',
        url: '/v1/films',
        headers: auth,
        payload: { url: 'nameco.example', profileId: 'maya' },
      })
    ).json().id
    await finish(id, 'Nameco')
    const r = await app.inject({
      url: `/f/${id}/poster.jpg?download=${encodeURIComponent('Nameco - Maya "Chen"')}`,
    })
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-disposition']).toBe('attachment; filename="Nameco - Maya Chen.jpg"')
    expect(
      (await app.inject({ url: `/f/${id}/poster.jpg` })).headers['content-disposition'],
    ).toBeUndefined()
  })

  it('suggests who to send it to, and who you already know there', async () => {
    const id = (
      await app.inject({
        method: 'POST',
        url: '/v1/films',
        headers: auth,
        payload: { url: 'stripe.com', profileId: 'maya' },
      })
    ).json().id
    await finish(id, 'Stripe')

    let people = (await app.inject({ url: `/v1/films/${id}/people`, headers: auth })).json()
    type Group = { id: string; why: string; ask: string; searches: { url: string }[] }
    const groups = people.groups as Group[]
    // Stripe isn't on YC's list, so its size isn't known: warm paths and the manager first
    expect(people.team).toBeNull()
    expect(groups.map((g) => g.id)).not.toContain('warm')
    expect(groups.at(-1)!.id).toBe('founders')
    expect(groups.filter((g) => g.id === 'recruiting')).toHaveLength(1)
    for (const g of groups) expect(g.why && g.ask && g.searches.length).toBeTruthy()
    // the deprecated flat list still holds every search the groups hold, in the same order
    expect(people.searches.map((s: { url: string }) => s.url)).toEqual(
      groups.flatMap((g) => g.searches.map((s) => s.url)),
    )
    expect(people.known).toEqual([])
    expect(people.connections).toBe(0)

    const bad = await app.inject({
      method: 'PUT',
      url: '/v1/connections',
      headers: auth,
      payload: { csv: 'name,email\nx,y' },
    })
    expect(bad.statusCode).toBe(400)
    const up = await app.inject({
      method: 'PUT',
      url: '/v1/connections',
      headers: auth,
      payload: { csv: readFileSync('fixtures/connections.csv', 'utf8') },
    })
    expect(up.json()).toEqual({ count: 5 })

    people = (await app.inject({ url: `/v1/films/${id}/people`, headers: auth })).json()
    expect(people.known.map((c: { name: string }) => c.name)).toEqual([
      'Priya Shah',
      'Ben Ortiz',
      'Ana Lima',
    ])
    expect(people.connections).toBe(5)
    // the people you know there are the warm path, and it goes first at a company this size
    expect(people.groups[0].id).toBe('warm')
    expect(people.groups[0].known.map((c: { name: string }) => c.name)).toEqual([
      'Priya Shah',
      'Ben Ortiz',
      'Ana Lima',
    ])
    expect((await app.inject({ url: '/v1/connections', headers: auth })).json().count).toBe(5)

    const gone = await app.inject({ method: 'DELETE', url: '/v1/connections', headers: auth })
    expect(gone.json()).toEqual({ deleted: 5 })
    people = (await app.inject({ url: `/v1/films/${id}/people`, headers: auth })).json()
    expect(people.known).toEqual([])
  })

  it('opens who to reach on the founders at a small YC startup, and puts the groups in the brief', async () => {
    // a real tiny YC company from the weekly list, so the test follows the data
    const yc = searchStartups({ maxTeam: 10, limit: 50 }).data.find((x) => x.website && x.team)!
    const id = (
      await app.inject({
        method: 'POST',
        url: '/v1/films',
        headers: auth,
        payload: { url: 'tiny.example', profileId: 'maya' },
      })
    ).json().id
    await finish(id, yc.name)
    await sql`update runs set output = jsonb_set(output, '{host}', ${sql.json(new URL(yc.website!).hostname as never)}) where id = ${id}`

    const people = (await app.inject({ url: `/v1/films/${id}/people`, headers: auth })).json()
    expect(people.team).toBe(yc.team)
    expect(people.groups[0].id).toBe('founders')
    expect(people.groups[0].searches[0].url).toBe(
      `https://www.ycombinator.com/companies/${yc.slug}`,
    )
    expect(people.groups.map((g: { id: string }) => g.id)).not.toContain('manager')
    expect(people.searches.length).toBe(
      people.groups.reduce((n: number, g: { searches: unknown[] }) => n + g.searches.length, 0),
    )

    // the call brief carries the same groups, in the same order, with what to ask each
    const brief = (await app.inject({ url: `/v1/films/${id}/brief`, headers: auth })).json()
    expect(brief.reach.map((r: { who: string }) => r.who)).toEqual(
      people.groups.map((g: { label: string }) => g.label),
    )
    expect(brief.reach[0].ask).toBe('What they’re building next and what’s hard about it.')
  })
})

describe('slack', () => {
  const signed = (payload: unknown) => {
    const body = JSON.stringify(payload)
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = `v0=${createHmac('sha256', SIGNING).update(`v0:${ts}:${body}`).digest('hex')}`
    return {
      body,
      headers: {
        'content-type': 'application/json',
        'x-slack-request-timestamp': ts,
        'x-slack-signature': sig,
      },
    }
  }

  it('rejects unsigned requests and answers the URL challenge', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/slack/events',
      payload: { type: 'url_verification', challenge: 'c' },
    })
    expect(bad.statusCode).toBe(401)
    const s = signed({ type: 'url_verification', challenge: 'abc' })
    const ok = await app.inject({
      method: 'POST',
      url: '/slack/events',
      headers: s.headers,
      payload: s.body,
    })
    expect(ok.json()).toEqual({ challenge: 'abc' })
  })

  it('turns a mention into one film even when Slack retries the event', async () => {
    const event = {
      type: 'event_callback',
      event_id: 'Ev1',
      event: {
        type: 'app_mention',
        text: '<@UBOT> <https://hooli.com|hooli.com>',
        channel: 'C9',
        ts: '100.1',
      },
    }
    for (let i = 0; i < 2; i++) {
      const s = signed(event)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/slack/events',
            headers: s.headers,
            payload: s.body,
          })
        ).statusCode,
      ).toBe(200)
    }
    const runs = await sql`select input from runs where input->>'url' = 'https://hooli.com'`
    expect(runs).toHaveLength(1)
    expect(runs[0]!.input).toMatchObject({ slack: { channel: 'C9', threadTs: '100.1' } })
    const replies = slackCalls.filter((c) => c.method === 'chat.postMessage')
    expect(replies).toHaveLength(1)
    expect(JSON.parse(replies[0]!.body)).toMatchObject({ channel: 'C9', thread_ts: '100.1' })
  })
})

describe('network this week', () => {
  type Card = { company: string; site: string; reasons: string[]; score: number }
  const week = async (headers: Record<string, string> = auth) => {
    const r = await app.inject({ url: '/v1/targets', headers })
    expect(r.statusCode).toBe(200)
    return r.json() as { data: Card[]; week: { made: number; target: number }; roles: string[] }
  }
  const sites = (cards: Card[]) => cards.map((c) => c.site)

  it('lists 10 companies with their reasons, owner-scoped, and clears when a film is made', async () => {
    // a job seeker's profile is the newest, so it's the one Network this week reads
    const put = await app.inject({
      method: 'PUT',
      url: '/v1/profiles/alex',
      headers: auth,
      payload: { name: 'Alex', data: { ...profile('candidate'), skills: ['Python'] } },
    })
    expect(put.statusCode).toBeLessThan(300)
    const first = await week()
    expect(first.data).toHaveLength(10)
    expect(first.roles).toEqual(['Forward deployed engineer'])
    expect(first.week.target).toBe(10)
    for (const c of first.data) {
      expect(c.reasons.length).toBeGreaterThan(0)
      expect(c.site).toMatch(/^https?:\/\//)
    }
    const scores = first.data.map((c) => c.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))

    // making a film for the top company takes it off the list, and counts toward the week
    const [top, second, third] = first.data as [Card, Card, Card]
    const made = await app.inject({
      method: 'POST',
      url: '/v1/films',
      headers: auth,
      payload: { url: top.site, profileId: 'alex' },
    })
    expect(made.statusCode).toBe(202)
    const after = await week()
    expect(sites(after.data)).not.toContain(top.site)
    expect(sites(after.data).slice(0, 2)).toEqual([second.site, third.site])
    expect(after.week.made).toBe(first.week.made + 1)

    // "Not for me" hides it from Today and from the Startups warm sort; undo brings it back
    const hide = await app.inject({
      method: 'POST',
      url: '/v1/targets/hide',
      headers: auth,
      payload: { site: second.site },
    })
    expect(hide.statusCode).toBe(200)
    expect(sites((await week()).data)).not.toContain(second.site)
    const warm = (
      await app.inject({ url: '/v1/startups?sort=warm&since=2005&limit=60', headers: auth })
    ).json() as { data: { website: string | null; reasons?: string[] }[] }
    const host = (u: string | null) => new URL(u ?? 'https://x').hostname.replace(/^www\./, '')
    expect(warm.data.map((s) => host(s.website))).not.toContain(host(second.site))
    expect(warm.data[0]!.reasons?.length).toBeGreaterThan(0)
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/targets/hide',
      headers: auth,
      payload: { site: 'nothing' },
    })
    expect(bad.statusCode).toBe(422)
    expect(bad.json().error.code).toBe('bad_site')

    // someone else's hides and films don't touch this list, and they see their own
    const other = await makeToken(sql, 'u:another-sender', 'test')
    const them = { authorization: `Bearer ${other.token}` }
    await app.inject({
      method: 'POST',
      url: '/v1/targets/hide',
      headers: them,
      payload: { site: third.site },
    })
    await sql`insert into runs (id, agent, input, owner) values ('run_other_target', 'film', ${sql.json({ url: third.site } as never)}, 'u:another-sender')`
    expect(sites((await week()).data)).toContain(third.site)
    const theirs = await app.inject({ url: '/v1/targets', headers: them })
    expect(theirs.statusCode).toBe(200)
    expect(theirs.json().week.made).toBe(1)

    await app.inject({
      method: 'POST',
      url: '/v1/targets/unhide',
      headers: auth,
      payload: { site: second.site },
    })
    expect(sites((await week()).data)).toContain(second.site)
  })
})

describe('"Write it again" on the hosted app', () => {
  // the hosted app, where daily limits hold; a stand-in model that can be down
  let hosted: Awaited<ReturnType<typeof buildApi>>
  let down = false
  let calls = 0
  const llm = new ScriptedProvider(() => {
    calls++
    if (down) throw new Error('HTTP 503 from the model')
    return JSON.stringify({
      note: "I've been using Parcelpine, and the per-zone view saved me a spreadsheet. Curious how most Parcelpine customers use it.",
      afterAccept: `Thanks for connecting. I put what I'd try next with Parcelpine into a 30-second film: ${FILM} What's the hardest part of what Parcelpine is building right now?`,
      inmail: {
        subject: 'Notes from using Parcelpine',
        body: `I put what I'd try next with Parcelpine into a 30-second film: ${FILM} What's the hardest part of what Parcelpine is building right now?`,
      },
      email: {
        subject: 'Notes from using Parcelpine',
        opening: "I've been reading about what Parcelpine is building.",
        tease: `I put what I'd try next with Parcelpine into a 30-second film: ${FILM}`,
        creator: null,
        question: "What's the hardest part of what Parcelpine is building right now?",
        offer: "If you ever have 15 minutes, I'd love to hear how you think about it.",
      },
    })
  }, [0, 1])
  let n = 0
  /** a finished film owned by `owner`, from the given profile */
  const finished = async (owner: string, preset: 'candidate' | 'sales') => {
    const id = `run_01REWR1TE${String(n++).padStart(17, '0')}`
    const output = {
      company: 'Parcelpine',
      host: 'parcelpine.example',
      format: 'square',
      durationSec: 29.2,
      files: {
        film: `${id}/film-square.mp4`,
        poster: `${id}/poster.jpg`,
        gif: `${id}/preview.gif`,
        sheet: `${id}/contact-sheet.jpg`,
        kit: `${id}/kit.json`,
        storyboard: `${id}/storyboard.json`,
      },
      highlights: {
        quote: { text: 'Returns that keep the customer', source: 'their homepage' },
        proof: [{ value: '6', label: 'open-source AI projects shipped' }],
      },
      script: {
        hook: 'Hi Parcelpine team',
        noticed: 'x',
        insight: { factId: 'f1', why: 'y' },
        pitch: { headline: 'h', points: ['a', 'b'] },
        proof: [0],
        cta: 'Talk soon?',
      },
      scriptMeta: { model: 'deterministic', rounds: 1, violations: [[]], usedFallback: false },
      qa: { duration: 29.2, issues: [], fonts: [] },
      render: { frames: 876, ms: 50000 },
      profile: profile(preset),
    }
    await sql`
      insert into runs (id, agent, input, owner, status, output, completed_at)
      values (${id}, 'film', ${sql.json({ url: 'https://parcelpine.example', profile: profile(preset) } as never)},
        ${owner}, 'succeeded', ${sql.json(output as never)}, now())`
    return id
  }

  beforeAll(async () => {
    hosted = await buildApi({
      sql,
      cfg: testConfig({
        HOSTED: 'true',
        SESSION_SECRET: 'x'.repeat(40),
        PUBLIC_URL: 'https://coldopen.example',
        FILMS_DIR: tmp('rewrite-films-'),
        // résumé drafts have their own, smaller limit: rewrites don't touch it
        DAILY_DRAFTS: '1',
      }),
      log,
      slack: null,
      llm,
    })
  })
  afterAll(async () => {
    await hosted?.close()
  })

  it('has its own limit, 10 a day per owner, for job seekers only', async () => {
    const { token } = await makeToken(sql, 'u:rewriter', 'test')
    const me = { authorization: `Bearer ${token}` }
    const id = await finished('u:rewriter', 'candidate')
    const rewrite = (film = id, headers = me) =>
      hosted.inject({ method: 'POST', url: `/v1/films/${film}/messages/rewrite`, headers })

    // an attempt the model couldn't finish isn't counted
    down = true
    expect((await rewrite()).statusCode).toBe(503)
    down = false

    for (let i = 0; i < 10; i++) {
      const r = await rewrite()
      expect(r.statusCode, r.body).toBe(200)
      expect(r.json().writer.email).toBe('model')
    }
    const eleventh = await rewrite()
    expect(eleventh.statusCode).toBe(429)
    expect(eleventh.json().error).toEqual({
      code: 'daily_limit',
      message:
        "That's 10 rewrites today. The template drafts are still here, or come back tomorrow.",
    })
    expect(calls).toBe(11)

    // its own key: résumé drafts are untouched, and another owner has all 10
    const usage = await sql<{ key: string; n: number }[]>`
      select key, n from usage where key in ('rewrites:u:rewriter', 'drafts:u:rewriter')`
    expect(usage).toEqual([{ key: 'rewrites:u:rewriter', n: 11 }])
    const other = await makeToken(sql, 'u:rewriter-two', 'test')
    const theirs = await finished('u:rewriter-two', 'candidate')
    expect((await rewrite(theirs, { authorization: `Bearer ${other.token}` })).statusCode).toBe(200)

    // a seller's drafts are never offered again, and it costs them nothing
    const sales = await finished('u:rewriter-two', 'sales')
    const no = await rewrite(sales, { authorization: `Bearer ${other.token}` })
    expect(no.statusCode).toBe(409)
    expect(no.json().error.code).toBe('no_model_drafts')
  })
})

describe('scene stills go with the film', () => {
  beforeAll(async () => {
    await putProfile()
  })

  /** the share worker on a real port, with Workers KV in memory: no R2, its existing store */
  async function shareServer() {
    const kv = new Map<string, ArrayBuffer | string>()
    const FILMS: KV = {
      get: (async (key: string, type: string) => {
        const v = kv.get(key)
        if (v === undefined) return null
        if (type === 'json') return JSON.parse(String(v))
        if (type === 'text') return String(v)
        return v
      }) as KV['get'],
      put: async (key, value) => void kv.set(key, value),
      delete: async (key) => void kv.delete(key),
      list: async ({ prefix }) => ({
        keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
      }),
    }
    const env = { FILMS, VIEWS: {} as never, SHARE_TOKEN: 'share-tok' }
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const body = chunks.length ? Buffer.concat(chunks) : undefined
      const r = await shareWorker(
        new Request(`http://${req.headers.host}${req.url}`, {
          method: req.method!,
          headers: req.headers as Record<string, string>,
          ...(body && req.method !== 'GET' ? { body } : {}),
        }),
        env,
        { waitUntil: () => {} },
      )
      res.writeHead(r.status, Object.fromEntries(r.headers))
      res.end(Buffer.from(await r.arrayBuffer()))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    return { server, url, kv }
  }

  it('uploads the six stills with the film, and the Review tab reads them from there', async () => {
    const { server, url, kv } = await shareServer()
    try {
      const id = (
        await app.inject({
          method: 'POST',
          url: '/v1/films',
          headers: auth,
          payload: { url: 'stillsco.example', profileId: 'maya' },
        })
      ).json().id as string
      await finish(id, 'Stillsco')
      const dir = join(filmsDir, id)
      for (const [i, f] of SCENE_STILLS.entries()) writeFileSync(join(dir, f), `still ${i}`)
      const shareId = `stillsco-${id.slice(-10).toLowerCase()}`
      const shared = await publish(
        { url, token: 'share-tok' },
        {
          id: shareId,
          view: {
            company: 'Stillsco',
            format: 'square',
            from: 'Maya',
            firstName: 'Maya',
            ctaLine: 'Talk soon?',
            contact: 'maya@example.com',
            film: 'film-square.mp4',
          },
          dir,
        },
      )
      // every still sits next to the film in the worker's store
      for (const f of SCENE_STILLS) expect(kv.has(`file:${shareId}:${f}`), f).toBe(true)
      expect(kv.has(`file:${shareId}:film-square.mp4`)).toBe(true)

      await sql`
        update runs set output = output || ${sql.json({
          shared,
          files: {
            film: `${id}/film-square.mp4`,
            poster: `${id}/poster.jpg`,
            gif: `${id}/preview.gif`,
            sheet: `${id}/contact-sheet.jpg`,
            kit: `${id}/kit.json`,
            storyboard: `${id}/storyboard.json`,
            scenes: SCENE_STILLS.map((f) => `${id}/${f}`),
          },
        } as never)}
        where id = ${id}`
      const detail = (await app.inject({ url: `/v1/films/${id}`, headers: auth })).json()
      expect(detail.scenes).toEqual(SCENE_STILLS.map((f) => `${shared.link}/${f}`))
      // the server's own copy is the fallback, for films published before stills went with them
      expect(detail.scenesOnDisk).toEqual(SCENE_STILLS.map((f) => `/f/${id}/${f}`))
      const got = await fetch(detail.scenes[3])
      expect(got.status).toBe(200)
      expect(got.headers.get('content-type')).toBe('image/jpeg')
      expect(await got.text()).toBe('still 3')
      const disk = await app.inject({ url: detail.scenesOnDisk[3] })
      expect(disk.statusCode).toBe(200)
      expect(disk.body).toBe('still 3')
    } finally {
      server.close()
    }
  })

  it('reads stills from its own disk when the film is not published anywhere', async () => {
    const id = (
      await app.inject({
        method: 'POST',
        url: '/v1/films',
        headers: auth,
        payload: { url: 'localstills.example', profileId: 'maya' },
      })
    ).json().id as string
    await finish(id, 'Localstills')
    await sql`
      update runs set output = jsonb_set(output, '{files,scenes}', ${sql.json(
        SCENE_STILLS.map((f) => `${id}/${f}`) as never,
      )})
      where id = ${id}`
    const detail = (await app.inject({ url: `/v1/films/${id}`, headers: auth })).json()
    expect(detail.scenes).toEqual(SCENE_STILLS.map((f) => `/f/${id}/${f}`))
    expect(detail.scenesOnDisk).toEqual(detail.scenes)
  })
})
