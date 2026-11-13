import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApi } from '../../src/api/server.ts'
import type { Sql } from '../../src/db/index.ts'
import { SHARE_READ_MS } from '../../src/share/client.ts'
import { freshDb, log, profile, TEST_DB, testConfig, tmp } from '../helpers/index.ts'

/**
 * The hosted app keeps answering when the share worker doesn't (13 Nov: two health-check
 * restarts, then a process that logged "shutting down" and never exited): /healthz answers
 * while a share call hangs, views show as not loaded, and SIGTERM ends the process.
 */

let sql: Sql
let hanging: Server
let shareUrl: string
const held: { destroy(): void }[] = []

beforeAll(async () => {
  sql = await freshDb()
  // a share worker that takes every request and never answers
  hanging = createServer((req) => held.push(req.socket))
  await new Promise<void>((r) => hanging.listen(0, '127.0.0.1', r))
  shareUrl = `http://127.0.0.1:${(hanging.address() as AddressInfo).port}`
  for (let i = 0; i < 3; i++) {
    const id = `run_01HOSTING${String(i).padStart(17, '0')}`
    const output = {
      company: 'Parcelpine',
      host: 'parcelpine.example',
      format: 'square',
      durationSec: 29.2,
      files: {
        film: `${id}/film-square.mp4`,
        poster: `${id}/poster.jpg`,
        gif: `${id}/preview.gif`,
      },
      shared: { id: `parcelpine-hosting${i}`, link: `${shareUrl}/f/parcelpine-hosting${i}` },
    }
    await sql`
      insert into runs (id, agent, input, owner, status, output, completed_at)
      values (${id}, 'film', ${sql.json({ url: 'https://parcelpine.example', profile: profile('candidate') } as never)},
        'team', 'succeeded', ${sql.json(output as never)}, now())`
  }
})
afterAll(async () => {
  for (const s of held) s.destroy()
  hanging?.close()
  await sql?.end()
})

const api = () =>
  buildApi({
    sql,
    cfg: testConfig({ SHARE_URL: shareUrl, SHARE_TOKEN: 'tok', FILMS_DIR: tmp('hosting-films-') }),
    log,
    slack: null,
  })

describe('a share worker that never answers', () => {
  it('leaves /healthz answering in under 100 ms while a share call hangs', async () => {
    const app = await api()
    try {
      const list = app.inject({ url: '/v1/films' })
      await new Promise((r) => setTimeout(r, 200)) // the views call is out, waiting
      const t = performance.now()
      const health = await app.inject({ url: '/healthz' })
      const ms = performance.now() - t
      expect(health.statusCode).toBe(200)
      expect(health.json()).toEqual({ ok: true })
      expect(ms).toBeLessThan(100)
      await list
    } finally {
      await app.close()
    }
  })

  it('lists films with views not loaded after a few seconds, then without waiting', async () => {
    const app = await api()
    try {
      const t = performance.now()
      const res = await app.inject({ url: '/v1/films' })
      const ms = performance.now() - t
      expect(res.statusCode).toBe(200)
      const films = res.json().data as { viewsLoaded: boolean; views: unknown }[]
      expect(films).toHaveLength(3)
      for (const f of films) expect(f.viewsLoaded).toBe(false)
      expect(ms).toBeGreaterThanOrEqual(SHARE_READ_MS - 100)
      expect(ms).toBeLessThan(SHARE_READ_MS + 2000)

      // the share worker just failed: the next page doesn't wait on it again
      const t2 = performance.now()
      const again = await app.inject({ url: '/v1/films' })
      expect(performance.now() - t2).toBeLessThan(1000)
      expect(again.json().data[0].viewsLoaded).toBe(false)
      const one = await app.inject({ url: `/v1/films/${again.json().data[0].id}/views` })
      expect(one.statusCode).toBe(200)
      expect(one.json()).toMatchObject({ loaded: false, sessions: [] })
    } finally {
      await app.close()
    }
  }, 20_000)
})

describe('SIGTERM', () => {
  it('ends the process within 15 s while a request waits on the share worker', async () => {
    const port = 39_000 + Math.floor(Math.random() * 1000)
    const p = spawn(process.execPath, ['src/main.ts', 'api'], {
      cwd: join(import.meta.dirname, '../..'),
      env: {
        ...process.env,
        DATABASE_URL: TEST_DB,
        PORT: String(port),
        HOST: '127.0.0.1',
        API_KEYS: '',
        HOSTED: 'false',
        SHARE_URL: shareUrl,
        SHARE_TOKEN: 'tok',
        FIT_SEMANTIC: 'off',
        FILMS_DIR: tmp('hosting-proc-'),
        LOG_LEVEL: 'error',
      },
      stdio: 'ignore',
    })
    const exited = new Promise<number | null>((r) => p.on('exit', (code) => r(code)))
    try {
      for (let i = 0; ; i++) {
        const ok = await fetch(`http://127.0.0.1:${port}/healthz`).then(
          (r) => r.ok,
          () => false,
        )
        if (ok) break
        if (i > 150) throw new Error('the API never started')
        await new Promise((r) => setTimeout(r, 200))
      }
      // a page that waits on the share worker, still open when Render sends SIGTERM
      const open = fetch(`http://127.0.0.1:${port}/v1/films/run_01HOSTING${'0'.repeat(17)}`).catch(
        () => null,
      )
      await new Promise((r) => setTimeout(r, 300))
      const t = Date.now()
      p.kill('SIGTERM')
      const code = await Promise.race([
        exited,
        new Promise<'still running'>((r) => setTimeout(r, 15_000, 'still running')),
      ])
      expect(code).not.toBe('still running')
      expect(Date.now() - t).toBeLessThan(15_000)
      await open
    } finally {
      p.kill('SIGKILL')
    }
  }, 60_000)
})
