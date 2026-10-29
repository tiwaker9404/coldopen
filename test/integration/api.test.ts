import { createHmac } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApi } from '../../src/api/server.ts'
import type { Sql } from '../../src/db/index.ts'
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
    expect(profile.proof.map((p: { value: string }) => p.value)).toContain('$31')
    expect(JSON.stringify(profile)).not.toMatch(/brightside/i)

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
    expect(m.linkedin.length).toBeLessThanOrEqual(300)

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

    expect((await mark(b, null)).json().outreach).toBeNull()
    expect((await app.inject({ url: '/v1/outreach', headers: auth })).json().sent).toBe(1)
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
