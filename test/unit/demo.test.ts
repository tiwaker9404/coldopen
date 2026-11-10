import { describe, expect, it } from 'vitest'
import { ApiError } from '../../dashboard/src/api.ts'
import { answerFor, demoApi, READ_ONLY } from '../../dashboard/src/demo/api.ts'
import recorded from '../../dashboard/src/demo/fixtures.json' with { type: 'json' }
import {
  back,
  markDone,
  next,
  SEEN_KEY,
  STOPS,
  shouldStart,
} from '../../dashboard/src/demo/tour.ts'

type FilmList = { data: { id: string; files: { film: string } | null; company: string }[] }

describe('the demo account', () => {
  it('answers every read the app makes from the recorded API', async () => {
    const films = await demoApi<FilmList>('/v1/films?limit=120')
    expect(films.data).toHaveLength(3)
    for (const f of films.data) {
      for (const part of ['', '/messages', '/views', '/people', '/brief'])
        await expect(demoApi(`/v1/films/${f.id}${part}`)).resolves.toBeTruthy()
    }
    const jobs = await demoApi<{ data: unknown[] }>('/v1/jobs/suggested?limit=24')
    expect(jobs.data.length).toBeGreaterThan(10)
  })

  it('serves a filtered startups page from the recorded one, and a plain 404 for anything else', async () => {
    expect(answerFor('/v1/startups?q=ai&hiring=hiring&limit=30&offset=0')).toBeTruthy()
    const e = await demoApi<never>('/v1/nothing-here').catch((x: ApiError) => x)
    expect(e).toBeInstanceOf(ApiError)
    expect(e.status).toBe(404)
  })

  it('turns every write down in plain words, and saves nothing', async () => {
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const e = await demoApi<never>('/v1/films', { method, body: '{}' }).catch((x: ApiError) => x)
      expect(e).toBeInstanceOf(ApiError)
      expect(e.message).toBe(READ_ONLY)
    }
    expect(READ_ONLY).toMatch(/^This is the demo\. Nothing is saved/)
  })

  it('hands out copies, so a screen editing its data cannot change the next answer', async () => {
    const a = await demoApi<FilmList>('/v1/films?limit=120')
    a.data[0]!.company = 'changed'
    const b = await demoApi<FilmList>('/v1/films?limit=120')
    expect(b.data[0]!.company).not.toBe('changed')
  })

  it('carries no local addresses or paths from the machine that recorded it', () => {
    const text = JSON.stringify(recorded)
    expect(text).not.toMatch(/127\.0\.0\.1|localhost|\/tmp\//)
  })
})

describe('the demo tour', () => {
  it('runs five stops in order, ending on the films', () => {
    expect(STOPS.map((s) => s.place)).toEqual(['today', 'jobs', 'films', 'films', 'films'])
    let i: number | null = 0
    const seen: number[] = []
    while (i !== null) {
      seen.push(i)
      i = next(i)
    }
    expect(seen).toEqual([0, 1, 2, 3, 4])
    expect(back(0)).toBe(0)
    expect(back(3)).toBe(2)
  })

  it('shows once per browser, and still works when storage is blocked', () => {
    const store = new Map<string, string>()
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    }
    expect(shouldStart(storage)).toBe(true)
    markDone(storage)
    expect(store.get(SEEN_KEY)).toBe('done')
    expect(shouldStart(storage)).toBe(false)

    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(shouldStart(blocked)).toBe(true)
    expect(() => markDone(blocked)).not.toThrow()
    expect(shouldStart(null)).toBe(true)
  })
})
