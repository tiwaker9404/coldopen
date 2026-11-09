import { describe, expect, it } from 'vitest'
import {
  jobBoxNote,
  pasteBody,
  pasteNote,
  pasting,
  walledInList,
} from '../../dashboard/src/pasteJob.ts'
import {
  homepageFor,
  isJobPage,
  needsPastedText,
  needsTextMessage,
  pastedTextProblem,
} from '../../src/job/post.ts'
import { looksLikeLoginWall } from '../../src/job/read.ts'

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

describe('job links that need a login', () => {
  it('knows LinkedIn, Indeed and Glassdoor posts, and nothing else', () => {
    for (const u of [
      'https://www.linkedin.com/jobs/view/4012345678',
      'https://linkedin.com/jobs/view/4012345678/?refId=abc',
      'linkedin.com/jobs/view/4012345678',
      'https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4012345678',
      'https://www.linkedin.com/comm/jobs/view/4012345678',
      'https://uk.linkedin.com/jobs/view/forward-deployed-engineer-at-acme-4012345678',
      'https://lnkd.in/gAbC123',
      'https://www.indeed.com/viewjob?jk=abc123',
      'https://www.indeed.com/m/viewjob?jk=abc123',
      'https://uk.indeed.com/viewjob?jk=abc123',
      'https://www.indeed.com/jobs?q=engineer&vjk=abc123',
      'https://www.glassdoor.com/job-listing/engineer-acme-JV_IC1147401_KO0,8_KE9,13.htm?jl=1',
      'https://www.glassdoor.co.uk/job-listing/engineer-acme-JV_KO0,8.htm',
      'https://www.glassdoor.com/partner/jobListing.htm?jobListingId=1',
    ]) {
      expect(needsPastedText(u), u).toBe(true)
      const full = u.startsWith('http') ? u : `https://${u}`
      expect(isJobPage(full), u).toBe(true)
      expect(homepageFor(full), u).toBeNull()
    }
    for (const u of [
      'https://boards.greenhouse.io/acme/jobs/4012345',
      'https://jobs.lever.co/acme/3f2a-41b0',
      'https://acme.com/careers/forward-deployed-engineer',
      'https://www.linkedin.com/company/acme',
      'https://www.linkedin.com/in/someone',
      'https://www.indeed.com/',
      'https://www.glassdoor.com/Reviews/acme-reviews-E1.htm',
      'acme.com',
      '',
      'two words',
    ])
      expect(needsPastedText(u), u).toBe(false)
  })

  it('says why in one plain sentence, naming the site', () => {
    expect(needsTextMessage('https://www.linkedin.com/jobs/view/1')).toBe(
      'LinkedIn job pages need a login, so paste the job description below.',
    )
    expect(needsTextMessage('https://www.indeed.com/viewjob?jk=1')).toMatch(/^Indeed job pages/)
    expect(needsTextMessage('https://acme.com/careers/1')).toMatch(/^That job page needs a login/)
  })

  it('asks for the text, then the website, before anything is queued', () => {
    const li = 'https://www.linkedin.com/jobs/view/1'
    const text = 'Requirements:\n- Five years building data pipelines that people rely on'
    expect(pastedTextProblem({ url: li })?.code).toBe('job_needs_text')
    expect(pastedTextProblem({ url: 'acme.com', job: { url: li } })?.code).toBe('job_needs_text')
    expect(pastedTextProblem({ url: li, job: { url: li, text } })?.code).toBe('job_needs_site')
    expect(pastedTextProblem({ url: 'acme.com', job: { url: li, text } })).toBeNull()
    expect(pastedTextProblem({ url: 'https://boards.greenhouse.io/acme/jobs/1' })).toBeNull()
    expect(pastedTextProblem({ url: 'acme.com' })).toBeNull()
  })

  it('tells a sign-in wall from a short real post', () => {
    expect(looksLikeLoginWall('https://acme.com/login?next=/jobs/1', 'Welcome back', false)).toBe(
      true,
    )
    expect(looksLikeLoginWall('https://www.linkedin.com/authwall?trk=x', '', false)).toBe(true)
    expect(looksLikeLoginWall('https://acme.com/jobs/1', 'Email Password Sign in', true)).toBe(true)
    expect(looksLikeLoginWall('https://acme.com/jobs/1', 'Sign in to view this job', false)).toBe(
      true,
    )
    expect(
      looksLikeLoginWall(
        'https://acme.com/jobs/1',
        'Engineer. We build tools for ops teams.',
        false,
      ),
    ).toBe(false)
    expect(
      looksLikeLoginWall('https://acme.com/jobs/1', `${'A long post. '.repeat(400)}Sign in`, true),
    ).toBe(false)
  })
})

describe('the composer with a LinkedIn link', () => {
  const link = 'https://www.linkedin.com/jobs/view/4012345678'
  const text = 'What you’ll bring:\n- Experience shipping data products customers use every day'

  it('asks for the description, then the website, and only then is ready', () => {
    expect(pasting({ link })).toBe(true)
    expect(pasting({ link: 'acme.com' })).toBe(false)
    expect(pasting({ link: 'https://boards.greenhouse.io/acme/jobs/1', forced: true })).toBe(true)

    expect(pasteNote({ link, text: '', site: '' })).toBe(
      'LinkedIn job pages need a login, so paste the job description below.',
    )
    expect(pasteBody({ link, text: '', site: 'acme.com' })).toBeNull()
    expect(pasteNote({ link, text, site: '' })).toMatch(/add the company’s website/)
    expect(pasteBody({ link, text, site: 'not a site' })).toBeNull()
    expect(pasteBody({ link, text, site: 'acme.com' })).toEqual({
      url: 'https://acme.com',
      job: { url: link, text },
    })
  })

  it('wants text, not a link, in the job post box, and keeps such links out of lists', () => {
    expect(jobBoxNote(link)).toMatch(/paste the job description here instead of the link/)
    expect(jobBoxNote('https://jobs.lever.co/acme/1')).toBeNull()
    expect(jobBoxNote(text)).toBeNull()
    expect(walledInList(['acme.com', link])).toMatch(/can’t go in a list/)
    expect(walledInList(['acme.com', 'globex.com'])).toBeNull()
  })
})
