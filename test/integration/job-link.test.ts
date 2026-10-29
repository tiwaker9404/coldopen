import { afterAll, describe, expect, it, vi } from 'vitest'
import { closeBrowser } from '../../src/browser.ts'
import { createFilmAgent } from '../../src/film.ts'
import { LocalContext } from '../../src/runtime/local.ts'
import { fixtureServer, profile, tmp } from '../helpers/index.ts'

/**
 * A job link pasted where the website goes: the post is read first, and the film is made for
 * the company it links to. Job boards can't be reached from tests, so reading the post is
 * stubbed; reading the company's site and making the film are real.
 */
const posts = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../../src/job/read.ts', () => ({
  fetchJob: async (url: string) => {
    const post = posts.get(url)
    if (!post) throw new Error('HTTP 404')
    return post
  },
}))

afterAll(async () => {
  await closeBrowser()
  ;(await fixtureServer()).close()
})

describe('pasting a job link instead of a website', () => {
  it('reads the post, then films the company it links to, answering the post', async () => {
    const { url } = await fixtureServer()
    const link = 'https://jobs.lever.co/parcelpine/3f2a-41b0'
    posts.set(link, {
      url: link,
      title: 'Operations Analyst',
      companyUrl: `${url}/parcelpine/`,
      requirements: [
        'Experience building dashboards that operations teams use every day',
        'Strong SQL and spreadsheet modeling',
      ],
    })
    const agent = createFilmAgent({
      filmsDir: tmp('films-'),
      llmModel: null,
      allowPrivateNetworks: true,
    })
    const ctx = new LocalContext({ runId: 'run_joblink' })
    const r = await agent.run(ctx, { url: link, profile: profile('candidate'), format: 'square' })
    expect(r.company).toBe('Parcelpine')
    expect(r.host).toBe('parcelpine.example')
    expect(r.job).toEqual({ title: 'Operations Analyst', url: link })
    expect(r.highlights?.quote.source).toMatch(/Operations Analyst/)
  })

  it('says what to do when the post doesn’t link to the company', async () => {
    const link = 'https://boards.greenhouse.io/mystery/jobs/1'
    posts.set(link, { url: link, title: 'Engineer', requirements: ['Ship software'] })
    const agent = createFilmAgent({ filmsDir: tmp('films-'), llmModel: null })
    await expect(
      agent.run(new LocalContext({ runId: 'run_nosite' }), {
        url: link,
        profile: profile('candidate'),
        format: 'square',
      }),
    ).rejects.toThrow(/couldn't find the company's website.*Answer a job post/)
  })
})
