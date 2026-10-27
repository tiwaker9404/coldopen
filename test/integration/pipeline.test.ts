import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { closeBrowser } from '../../src/browser.ts'
import { createFilmAgent, type FilmResult } from '../../src/film.ts'
import { LocalContext } from '../../src/runtime/local.ts'
import { fixtureServer, profile, tmp } from '../helpers/index.ts'

afterAll(async () => {
  await closeBrowser()
  ;(await fixtureServer()).close()
})

describe('film pipeline (no database)', () => {
  it('makes a complete film, then resumes from the journal without redoing work', async () => {
    const { url } = await fixtureServer()
    const filmsDir = tmp('films-')
    const agent = createFilmAgent({ filmsDir, llmModel: null, allowPrivateNetworks: true })
    const input = {
      url: `${url}/parcelpine/`,
      profile: profile('candidate'),
      format: 'portrait' as const,
    }
    const journalFile = join(filmsDir, 'run_test', '.journal.json')

    const progress: string[] = []
    const first = new LocalContext({
      runId: 'run_test',
      journalFile,
      onProgress: (p) => progress.push(String(p.stage)),
    })
    const t0 = Date.now()
    const r: FilmResult = await agent.run(first, input)
    const firstMs = Date.now() - t0

    expect(r.company).toBe('Parcelpine')
    expect(r.qa.issues).toEqual([])
    for (const f of Object.values(r.files)) expect(existsSync(join(filmsDir, f)), f).toBe(true)
    expect(new Set(progress)).toEqual(new Set(['research', 'script', 'design', 'render', 'encode']))

    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'stream=width,height:format=duration',
          '-of',
          'json',
          join(filmsDir, r.files.film),
        ],
        { encoding: 'utf8' },
      ),
    )
    expect(probe.streams[0]).toMatchObject({ width: 1080, height: 1920 })
    expect(Number(probe.format.duration)).toBeCloseTo(r.durationSec, 0)
    expect(statSync(join(filmsDir, r.files.gif)).size).toBeLessThan(3_000_000)

    // same id again: everything replays from the journal, nothing is re-rendered
    const second = new LocalContext({ runId: 'run_test', journalFile })
    expect(await second.load()).toBeGreaterThanOrEqual(10)
    const t1 = Date.now()
    const again = await agent.run(second, input)
    expect(Date.now() - t1).toBeLessThan(firstMs / 5)
    expect(second.replayed).toEqual(
      expect.arrayContaining(['research', 'script', 'compose', 'render:0', 'render:5', 'encode']),
    )
    expect(again.files).toEqual(r.files)
  })

  it('stops with a clear, non-retryable error when a site cannot be read', async () => {
    const { url } = await fixtureServer()
    const agent = createFilmAgent({
      filmsDir: tmp('films-'),
      llmModel: null,
      allowPrivateNetworks: true,
    })
    const ctx = new LocalContext({ runId: 'run_missing' })
    await expect(
      agent.run(ctx, {
        url: `${url}/does-not-exist/`,
        profile: profile('sales'),
        format: 'square',
      }),
    ).rejects.toThrow(/could not read .* HTTP 404/)
  })
})
