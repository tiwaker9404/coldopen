import { afterAll, describe, expect, it } from 'vitest'
import { closeBrowser } from '../../src/browser.ts'
import { fetchJob } from '../../src/job/read.ts'
import { fixtureServer } from '../helpers/index.ts'

afterAll(async () => {
  await closeBrowser()
  ;(await fixtureServer()).close()
})

describe('reading job posts from their pages', () => {
  it('reads a Greenhouse-style page: bold-paragraph headings, nav and benefits left out', async () => {
    const { url } = await fixtureServer()
    const job = await fetchJob(`${url}/jobs/greenhouse.html`, { allowPrivateNetworks: true })
    expect(job.title).toBe('Forward Deployed Engineer')
    expect(job.requirements.slice(0, 3)).toEqual([
      '3+ years shipping production software in Python or TypeScript',
      'Experience putting AI agents with evals in front of real customers',
      'Comfort learning a new codebase quickly and shipping in your first weeks',
    ])
    expect(job.requirements).toContain(
      'Turn messy shipment data from customer ERPs into reliable pipelines',
    )
    const all = job.requirements.join(' ')
    expect(all).not.toMatch(/dental|401|equal opportunity|Back to jobs|Privacy/i)
  })

  it('waits for a client-rendered board (Ashby-style) and skips the company blurb', async () => {
    const { url } = await fixtureServer()
    const job = await fetchJob(`${url}/jobs/ashby.html`, { allowPrivateNetworks: true })
    expect(job.title).toBe('Senior Data Analyst, Growth')
    expect(job.requirements[0]).toBe(
      '4+ years of SQL and data modeling for product or finance teams',
    )
    expect(job.requirements.join(' ')).not.toMatch(/remote-first|stipend|retreat/)
  })

  it('points LinkedIn users to pasting the text', async () => {
    await expect(fetchJob('https://www.linkedin.com/jobs/view/123')).rejects.toThrow(
      /paste|--job job.txt/i,
    )
  })
})

describe('finding the company behind a job link', () => {
  it('follows the logo on a job board, past social links', async () => {
    const { url } = await fixtureServer()
    const job = await fetchJob(`${url}/board/post.html`, { allowPrivateNetworks: true })
    expect(job.companyUrl).toBe('https://northwind.example/')
    expect(job.title).toBe('Forward Deployed Engineer')
  })

  it('uses the same site for a careers page on the company domain', async () => {
    const { url } = await fixtureServer()
    const job = await fetchJob(`${url}/jobs/greenhouse.html`, { allowPrivateNetworks: true })
    expect(job.companyUrl).toBe(`${url}/`)
  })
})
