import { describe, expect, it } from 'vitest'
import { homepageFor, isJobPage } from '../../src/job/post.ts'

describe('telling a job link from a website', () => {
  it('knows job boards and careers pages', () => {
    for (const u of [
      'https://boards.greenhouse.io/acme/jobs/4012345',
      'https://job-boards.greenhouse.io/acme/jobs/4012345',
      'https://jobs.lever.co/acme/3f2a-41b0',
      'https://jobs.ashbyhq.com/acme/5b1c',
      'https://apply.workable.com/acme/j/ABC123/',
      'https://acme.com/careers/forward-deployed-engineer',
      'https://acme.com/jobs/123',
      'https://www.linkedin.com/jobs/view/123',
    ])
      expect(isJobPage(u), u).toBe(true)
    for (const u of [
      'https://acme.com/',
      'https://acme.com/careers',
      'https://jobs.lever.co/acme',
      'https://acme.com/blog/hiring',
      'not a url',
    ])
      expect(isJobPage(u), u).toBe(false)
  })

  it('finds the homepage of a careers page on the company site, not on a board', () => {
    expect(homepageFor('https://careers.acme.com/jobs/1')).toBe('https://acme.com/')
    expect(homepageFor('https://www.acme.com/careers/eng')).toBe('https://www.acme.com/')
    expect(homepageFor('https://jobs.lever.co/acme/1')).toBeNull()
  })
})
