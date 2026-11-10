import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApi } from '../../src/api/server.ts'
import type { Sql } from '../../src/db/index.ts'
import type { FilmMessages } from '../../src/outreach/writer.ts'
import { freshDb, log, profile, testConfig, tmp } from '../helpers/index.ts'

/**
 * GET /v1/films/:id/messages and the MCP draft_messages tool: the model's drafts when the film
 * has them (step 5 stores them), templates otherwise, with who wrote each and why any was flagged.
 */

let sql: Sql
let app: Awaited<ReturnType<typeof buildApi>>
const filmsDir = tmp('messages-films-')
const auth = { authorization: 'Bearer k1' }

beforeAll(async () => {
  sql = await freshDb()
  app = await buildApi({
    sql,
    cfg: testConfig({
      API_KEYS: 'k1',
      FILMS_DIR: filmsDir,
      PUBLIC_URL: 'https://films.example.com',
    }),
    log,
    slack: null,
  })
  await app.inject({
    method: 'PUT',
    url: '/v1/profiles/alex',
    headers: auth,
    payload: { name: 'Alex', data: profile('candidate') },
  })
})

afterAll(async () => {
  await app?.close()
  await sql?.end()
})

const RESEARCH =
  'Route planning now reroutes trucks around live traffic before a delivery runs late'
const homework = {
  items: [
    {
      kind: 'changelog',
      title: 'Route planning, now with live traffic',
      url: 'https://parcelpine.example/changelog/route-planning',
      date: new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10),
      summary: `${RESEARCH}, for every lane.`,
    },
  ],
  pages: [],
}

/** What step 5's messages step stores for a film the model wrote */
const modelMessages = (o: Partial<FilmMessages> = {}): FilmMessages => ({
  drafts: {
    note: 'Hi [First name], I build dashboards for operations teams and made something for Parcelpine. – Alex',
    afterAccept:
      'Hi [First name],\n\nThanks for connecting. I made a 30-second film for Parcelpine: [film]\n\nCould we find 15 minutes this week?\n\nAlex',
    inmail: {
      subject: 'A film for Parcelpine',
      body: 'Hi [First name],\n\nI made a 30-second film for Parcelpine: [film]\n\nCould we find 15 minutes this week?\n\nAlex',
    },
    email: {
      // the best number in the subject, so it holds for either opener (openerFor goes by the random id)
      subject: 'Parcelpine: 6 open-source AI projects shipped',
      body: [
        'Hi [First name],',
        '',
        'I saw the Operations Analyst role at Parcelpine.',
        '',
        'I made a 30-second film for your Operations Analyst role at Parcelpine:',
        '[film]',
        '',
        `${RESEARCH}.`,
        '',
        'I build the dashboards operations teams use every day.',
        '',
        'Could we find 15 minutes this week?',
        '',
        'Alex Rivera',
        'alex@example.com',
      ].join('\n'),
    },
  },
  writer: { note: 'model', afterAccept: 'model', inmail: 'model', email: 'model' },
  flags: {},
  research: { itemUrl: homework.items[0]!.url, line: RESEARCH },
  model: 'openai/gpt-oss-120b',
  rounds: 1,
  firstTry: ['note', 'afterAccept', 'inmail', 'email'],
  ...o,
})

/** A finished film, as a worker leaves it: with model drafts, or without (made before step 5) */
async function film(messages?: FilmMessages): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/films',
    headers: auth,
    payload: { url: 'parcelpine.example', profileId: 'alex' },
  })
  const id = res.json().id as string
  mkdirSync(join(filmsDir, id), { recursive: true })
  for (const f of ['film-square.mp4', 'poster.jpg', 'preview.gif', 'contact-sheet.jpg'])
    writeFileSync(join(filmsDir, id, f), 'x')
  const output = {
    company: 'Parcelpine',
    host: 'parcelpine.example',
    format: 'square',
    durationSec: 29.2,
    job: { title: 'Operations Analyst' },
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
    homework,
    ...(messages ? { messages } : {}),
    scriptMeta: { model: 'deterministic', rounds: 1, violations: [[]], usedFallback: false },
    qa: { duration: 29.2, issues: [], fonts: [] },
    render: { frames: 876, ms: 50000 },
  }
  await sql`update runs set status = 'succeeded', completed_at = now(), output = ${sql.json(output as never)} where id = ${id}`
  return id
}

const messagesOf = async (id: string) =>
  (await app.inject({ url: `/v1/films/${id}/messages`, headers: auth })).json()

describe('the messages API', () => {
  it("returns the model's drafts with the real link, and says the model wrote them", async () => {
    const id = await film(modelMessages())
    const m = await messagesOf(id)
    expect(m.writer).toMatchObject({
      note: 'model',
      afterAccept: 'model',
      inmail: 'model',
      email: 'model',
      followUp: 'template',
    })
    const link = `https://films.example.com/f/${id}`
    expect(m.email.body).toContain(link)
    expect(m.email.body).toContain('I build the dashboards operations teams use every day.')
    expect(m.afterAccept).toContain(link)
    expect(m.inmail.body).toContain(link)
    expect(JSON.stringify(m)).not.toContain('[film]')
    expect(m.flags).toEqual({})
    expect(m.notes).toEqual({})
    // the fields older clients read keep their names and shapes
    expect(typeof m.linkedin).toBe('string')
    expect(m.checks).toMatchObject({ short: true, oneAsk: true })
    expect(typeof m.followUp).toBe('string')
  })

  it('a draft that fell back in the film comes back as a template with the real link, and why', async () => {
    const why = [{ rule: 'length', ok: false, why: 'The message is 431 of 400 characters' }]
    const id = await film(
      modelMessages({
        writer: { note: 'model', afterAccept: 'model', inmail: 'template', email: 'model' },
        flags: { inmail: why as never },
      }),
    )
    const m = await messagesOf(id)
    expect(m.writer.inmail).toBe('template')
    expect(m.inmail.body).toContain(`https://films.example.com/f/${id}`)
    expect(m.flags.inmail).toEqual(why)
  })

  it('an old film without model drafts gets templates, all marked so, and research when it has homework', async () => {
    const id = await film()
    const res = await app.inject({ url: `/v1/films/${id}/messages`, headers: auth })
    expect(res.statusCode).toBe(200)
    const m = res.json()
    expect(Object.values(m.writer).every((w) => w === 'template')).toBe(true)
    expect(m.flags).toEqual({})
    expect(m.notes).toEqual({})
    expect(m.email.body).toContain('I read that route planning now reroutes trucks')
    expect(m.email.body.toLowerCase().split('route planning')).toHaveLength(2)
    expect(m.email.body).not.toContain('…')
    expect(m.afterAccept).toContain(`https://films.example.com/f/${id}`)
  })

  it('puts a detail saved after the film into the email, and brings the template back when it no longer fits', async () => {
    const id = await film(modelMessages())
    const save = (detail: string) =>
      app.inject({
        method: 'PUT',
        url: `/v1/films/${id}/detail`,
        headers: auth,
        payload: { detail },
      })
    await save('I read your post on live traffic for every lane')
    const m = await messagesOf(id)
    expect(m.writer.email).toBe('model')
    expect(m.email.body).toContain(
      'I saw the Operations Analyst role at Parcelpine.\nI read your post on live traffic for every lane.',
    )
    expect(m.checks.detail).toBe(true)
    // a detail that fits changes nothing worth a note
    expect(m.flags.email).toBeUndefined()
    expect(m.notes.email).toBeUndefined()

    // pad the model's email close to the limit, then save a long detail
    const long = modelMessages()
    long.drafts.email.body = long.drafts.email.body.replace(
      'I build the dashboards operations teams use every day.',
      `I build the dashboards operations teams use every day${', and keep them running for the people on the floor'.repeat(5)}.`,
    )
    await sql`update runs set output = jsonb_set(output, '{messages}', ${sql.json(long as never)}) where id = ${id}`
    await save(
      'the export to CSV dropped every custom field across all of our lanes and depots, so I rebuilt the weekly report by hand for the whole team',
    )
    const back = await messagesOf(id)
    expect(back.writer.email).toBe('template')
    expect(back.email.body).toContain('the export to CSV dropped every custom field')
    // flags: what the model's email failed; notes: that the template came back to keep the detail
    expect(back.flags.email).toEqual([
      { rule: 'length', ok: false, why: expect.stringMatching(/^\d+ of 125 words$/) },
    ])
    expect(back.notes.email).toEqual([
      expect.stringMatching(
        /^With your saved detail the model's email ran to \d+ of 125 words, so this is the template version, which keeps the detail$/,
      ),
    ])
  })

  it('the follow-ups list carries the same drafts', async () => {
    const id = await film(modelMessages())
    await app.inject({
      method: 'PUT',
      url: `/v1/films/${id}/outreach`,
      headers: auth,
      payload: { status: 'sent' },
    })
    const back = new Date(Date.now() - 5 * 86_400_000).toISOString()
    await sql`update runs set outreach = jsonb_set(jsonb_set(outreach, '{sentAt}', to_jsonb(${back}::text)), '{at}', to_jsonb(${back}::text)) where id = ${id}`
    const due = (await app.inject({ url: '/v1/followups', headers: auth }))
      .json()
      .data.find((d: { film: { id: string } }) => d.film.id === id)
    expect(due.message.subject).toBe('Re: Parcelpine: 6 open-source AI projects shipped')
    expect(due.message.linkedin).toContain(`https://films.example.com/f/${id}`)
  })

  it('MCP draft_messages returns the same JSON as the GET', async () => {
    const id = await film(modelMessages())
    const res = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        ...auth,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      payload: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'draft_messages', arguments: { id } },
      },
    })
    expect(res.statusCode).toBe(200)
    const text = res.json().result.content[0].text
    expect(JSON.parse(text)).toEqual(await messagesOf(id))
  })
})
