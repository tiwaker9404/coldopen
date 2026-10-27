import { type ChildProcess, spawn } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Sql } from '../../src/db/index.ts'
import { FilmInputSchema } from '../../src/film.ts'
import { createRun, getLog, getRun, getSteps } from '../../src/runtime/store.ts'
import { fixtureServer, freshDb, profile, TEST_DB, tmp } from '../helpers/index.ts'

/**
 * The real thing: a worker process renders a film, gets SIGKILLed partway through the
 * render, and a fresh worker finishes it. Finished scenes must not be rendered again.
 */
let sql: Sql
const procs: ChildProcess[] = []
const filmsDir = tmp('crash-films-')

beforeAll(async () => {
  sql = await freshDb()
})
afterAll(async () => {
  for (const p of procs) p.kill('SIGKILL')
  await sql.end()
  ;(await fixtureServer()).close()
})

function worker(): ChildProcess {
  const p = spawn(process.execPath, ['src/main.ts', 'worker'], {
    cwd: join(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      DATABASE_URL: TEST_DB,
      FILMS_DIR: filmsDir,
      LEASE_MS: '3000',
      POLL_INTERVAL_MS: '200',
      ALLOW_PRIVATE_NETWORKS: 'true',
      LOG_LEVEL: 'error',
    },
    stdio: 'ignore',
  })
  procs.push(p)
  return p
}

describe('crash during render', () => {
  it('a new worker finishes the film without re-rendering finished scenes', async () => {
    const { url } = await fixtureServer()
    const input = FilmInputSchema.parse({ url: `${url}/northwind/`, profile: profile('sales') })
    const { run } = await createRun(sql, { agent: 'film', input })

    const first = worker()
    // wait until at least two scenes are rendered, then kill -9
    for (let i = 0; ; i++) {
      const done = (await getSteps(sql, run.id)).filter(
        (s) => s.key.startsWith('render:') && s.status === 'completed',
      )
      if (done.length >= 2) break
      if (i > 600) throw new Error('first worker never got to the render stage')
      await sleep(200)
    }
    first.kill('SIGKILL')

    worker()
    for (let i = 0; ; i++) {
      const r = await getRun(sql, run.id)
      if (r?.status === 'succeeded') break
      if (r?.status === 'failed') throw new Error(`film failed: ${r.error}`)
      if (i > 900) throw new Error('second worker never finished the film')
      await sleep(200)
    }

    const final = (await getRun(sql, run.id))!
    expect(final.attempts).toBe(2)
    const steps = await getSteps(sql, run.id)
    const replayed = steps.filter((s) => s.replays > 0).map((s) => s.key)
    expect(replayed).toEqual(
      expect.arrayContaining(['research', 'script', 'compose', 'render:0', 'render:1']),
    )
    // every scene was rendered exactly once across both workers
    for (const s of steps.filter((x) => x.key.startsWith('render:'))) expect(s.attempts).toBe(1)
    const timeline = (await getLog(sql, run.id)).map((l) => l.kind)
    expect(timeline).toEqual(expect.arrayContaining(['worker_lost', 'replayed', 'succeeded']))
  }, 300_000)
})
