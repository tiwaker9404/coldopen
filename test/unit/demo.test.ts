import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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

const SITE = join(import.meta.dirname, '../../site')
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
    // Today's Network this week: 10 companies, each with a reason, none of the demo's films
    const week = await demoApi<{
      data: { site: string; reasons: string[] }[]
      week: { made: number; target: number }
    }>('/v1/targets?limit=10')
    expect(week.data).toHaveLength(10)
    for (const t of week.data) expect(t.reasons.length).toBeGreaterThan(0)
    const filmed = films.data.map((f) => f.company)
    expect(week.data.map((t) => t.site).join()).not.toMatch(/\.example/)
    expect(filmed).toHaveLength(3)
    expect(week.week).toEqual({ made: 3, target: 10 })
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

  it("shows today's product: a review with real flags, people groups, warm drafts and the share page", async () => {
    type Detail = {
      company: string
      share: string
      scenes: string[] | null
      highlights: { quote: { caption?: string } }
      review: { ready: boolean; scenes: { kind: string; flags: { code: string }[] }[] } | null
    }
    const films = await demoApi<FilmList>('/v1/films?limit=120')
    let flagged = 0
    for (const f of films.data) {
      const d = await demoApi<Detail>(`/v1/films/${f.id}`)
      // recorded since reviews: six scenes, with stills published beside the film
      expect(d.review?.scenes.map((s) => s.kind)).toEqual([
        'hook',
        'site',
        'insight',
        'pitch',
        'proof',
        'cta',
      ])
      flagged += d.review!.scenes.flatMap((s) => s.flags).length
      expect(d.scenes).toEqual(
        Array.from({ length: 6 }, (_, i) => `../media/demo/${f.id}/scene-${i}.jpg`),
      )
      expect(d.highlights.quote.caption).toMatch(/^From their /)
      // a share link opens the film's page, published with the demo
      expect(d.share).toBe(`https://tiwaker9404.github.io/coldopen/media/demo/${f.id}`)
      // who to reach, in groups, each saying what to ask
      const people = await demoApi<{
        groups: { label: string; ask: string; searches: unknown[] }[]
      }>(`/v1/films/${f.id}/people`)
      expect(people.groups.length).toBeGreaterThanOrEqual(3)
      for (const g of people.groups) {
        expect(g.ask.length).toBeGreaterThan(10)
        expect(g.searches.length).toBeGreaterThan(0)
      }
      expect(people.groups.map((g) => g.label)).toContain('Founders')
    }
    expect(flagged).toBeGreaterThan(0)
    // the warm email: their work first, the creator line, one question and thanks, no job words
    const msgs = await Promise.all(
      films.data.map((f) => demoApi<{ email: { body: string } }>(`/v1/films/${f.id}/messages`)),
    )
    const withHomework = msgs.find((m) => m.email.body.includes('I tried a size swap'))
    expect(withHomework?.email.body).toContain('I built the tool that made it, coldopen.')
    for (const m of msgs) {
      expect(m.email.body).toContain('Thanks for reading,')
      expect(m.email.body).not.toMatch(/\b(role|position|hiring|apply|résumé|job)\b/i)
    }
  })

  it('publishes each film with its share page, which says who sent it and counts nothing', () => {
    const films = (recorded.answers['/v1/films?limit=120'] as FilmList).data
    for (const f of films) {
      const page = readFileSync(join(SITE, 'media/demo', f.id, 'index.html'), 'utf8')
      expect(page).toContain('<section class="sender" aria-label="Who sent it">')
      expect(page).toContain('<img src="../alex.jpg"')
      expect(page).toContain(', which I built</p>')
      expect(page).toMatch(
        /<meta property="og:title" content="A 30-second film for [^"]+, from Alex Rivera">/,
      )
      expect(page).not.toContain('sendBeacon')
      expect(page).not.toMatch(/localhost|127\.0\.0\.1/)
      for (const file of ['poster.jpg', 'film-square.mp4', 'scene-0.jpg', 'scene-5.jpg'])
        expect(existsSync(join(SITE, 'media/demo', f.id, file)), file).toBe(true)
    }
    // the landing page's hero plays one of them
    for (const file of ['hero.mp4', 'hero.jpg', 'alex.jpg'])
      expect(existsSync(join(SITE, 'media/demo', file)), file).toBe(true)
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

  it("starts whenever the link asks for it, as the landing page's button does", () => {
    const seen = { getItem: () => 'done' }
    expect(shouldStart(seen)).toBe(false)
    expect(shouldStart(seen, '?tour&ref=site')).toBe(true)
    expect(shouldStart(seen, '?ref=site&tour=1')).toBe(true)
    expect(shouldStart(seen, '?tourist=1')).toBe(false)
  })
})
