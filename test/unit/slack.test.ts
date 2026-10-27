import { createHmac } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SlackClient, urlFromMention, verifySlackSignature } from '../../src/slack.ts'
import { tmp } from '../helpers/index.ts'

const secret = 'shhh'
const sign = (ts: string, body: string) =>
  `v0=${createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')}`

describe('slack signatures', () => {
  const now = 1_800_000_000_000
  const ts = String(now / 1000)
  it('accepts a valid request and rejects tampering or replays', () => {
    const body = '{"type":"event_callback"}'
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: ts,
        signature: sign(ts, body),
        rawBody: body,
        now,
      }),
    ).toBe(true)
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: ts,
        signature: sign(ts, body),
        rawBody: `${body} `,
        now,
      }),
    ).toBe(false)
    expect(
      verifySlackSignature({
        signingSecret: 'other',
        timestamp: ts,
        signature: sign(ts, body),
        rawBody: body,
        now,
      }),
    ).toBe(false)
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: ts,
        signature: sign(ts, body),
        rawBody: body,
        now: now + 10 * 60_000,
      }),
    ).toBe(false)
    expect(
      verifySlackSignature({
        signingSecret: secret,
        timestamp: undefined,
        signature: undefined,
        rawBody: body,
        now,
      }),
    ).toBe(false)
  })
})

describe('urlFromMention', () => {
  it.each([
    ['<@U123> <https://acme.com|acme.com>', 'https://acme.com'],
    ['<@U123> make one for <https://www.globex.io/about>', 'https://www.globex.io/about'],
    ['<@U123> initech.com please', 'https://initech.com'],
    ['<@U123> hello', null],
  ])('%s', (text, url) => {
    expect(urlFromMention(text)).toBe(url)
  })
})

describe('SlackClient', () => {
  it('runs the files.uploadV2 flow into a thread', async () => {
    const seen: { path: string; body: string; auth?: string }[] = []
    const server = createServer(async (req, res) => {
      let body = ''
      for await (const c of req) body += c
      seen.push({
        path: req.url!,
        body,
        ...(req.headers.authorization ? { auth: req.headers.authorization } : {}),
      })
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/files.getUploadURLExternal') {
        res.end(
          JSON.stringify({
            ok: true,
            upload_url: `http://127.0.0.1:${port}/upload`,
            file_id: 'F1',
          }),
        )
      } else if (req.url === '/upload') res.end('ok')
      else res.end(JSON.stringify({ ok: true, ts: '1.2' }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const file = join(tmp(), 'film.mp4')
    writeFileSync(file, 'not really a video')
    try {
      const slack = new SlackClient('xoxb-test', `http://127.0.0.1:${port}/api`)
      await slack.uploadFile({
        channel: 'C1',
        threadTs: '9.9',
        file,
        title: 'Acme film',
        comment: 'here',
      })
      expect(seen.map((s) => s.path)).toEqual([
        '/api/files.getUploadURLExternal',
        '/upload',
        '/api/files.completeUploadExternal',
      ])
      expect(seen[0]!.body).toContain('filename=film.mp4')
      expect(seen[0]!.auth).toBe('Bearer xoxb-test')
      expect(JSON.parse(seen[2]!.body)).toMatchObject({
        channel_id: 'C1',
        thread_ts: '9.9',
        files: [{ id: 'F1', title: 'Acme film' }],
      })
    } finally {
      server.close()
    }
  })
})
