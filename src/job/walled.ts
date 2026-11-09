/**
 * Job pages that only show the post to someone signed in: LinkedIn, Indeed and Glassdoor.
 * coldopen can't read them, so the post has to be pasted. No imports, so the web app can use
 * the same check the API does and the two can't disagree.
 */

const SITES: { name: string; host: RegExp; path: RegExp }[] = [
  // linkedin.com/jobs/view/123, /jobs/collections/…?currentJobId=, /comm/jobs/view/123
  { name: 'LinkedIn', host: /(^|\.)linkedin\.com$/i, path: /^\/(comm\/)?jobs(\/|$)/i },
  // LinkedIn's short links: shared jobs from the app are almost always these
  { name: 'LinkedIn', host: /^lnkd\.in$/i, path: /^\/[^/]+/ },
  // indeed.com/viewjob?jk=, /m/viewjob, /rc/clk, /jobs?vjk=, and country sites like uk.indeed.com
  {
    name: 'Indeed',
    host: /(^|\.)indeed\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i,
    path: /^\/(m\/)?(viewjob|rc\/clk|pagead\/clk|jobs|cmp\/[^/]+\/jobs)/i,
  },
  // glassdoor.com/job-listing/…, /Job/…, /partner/jobListing.htm, and glassdoor.co.uk etc.
  {
    name: 'Glassdoor',
    host: /(^|\.)glassdoor\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i,
    path: /^\/(job-listing|job|jobs|partner\/joblisting)/i,
  },
]

function parse(url: string): URL | null {
  const t = url.trim()
  if (!t || /\s/.test(t)) return null
  try {
    return new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
  } catch {
    return null
  }
}

/** The site's name when this is a job link that needs a login, else null. */
export function walledSite(url: string): string | null {
  const u = parse(url)
  if (!u) return null
  return SITES.find((s) => s.host.test(u.hostname) && s.path.test(u.pathname))?.name ?? null
}

/** True for a job link coldopen can't read without a login, so its text must be pasted. */
export function needsPastedText(url: string): boolean {
  return walledSite(url) !== null
}

/** What to say when a job link needs its description pasted. */
export function needsTextMessage(url: string): string {
  const site = walledSite(url)
  return `${site ? `${site} job pages need` : 'That job page needs'} a login, so paste the job description below.`
}

/** What to say when the link names no company (LinkedIn links don't), so the website is needed. */
export function needsSiteMessage(url: string): string {
  return `${walledSite(url) ?? 'Job'} links don’t say which company it is, so add the company’s website too.`
}

export interface PastedTextProblem {
  code: 'job_needs_text' | 'job_needs_site'
  message: string
}

/**
 * What's missing before a film can be queued for a login-walled job link, or null when nothing
 * is. `url` is what was pasted as the website, `job` the post it should answer. A walled link
 * needs its text, and since such links don't name the company, a website besides.
 */
export function pastedTextProblem(req: {
  url: string
  job?: { url?: string; text?: string }
}): PastedTextProblem | null {
  const link = [req.url, req.job?.url].find((u) => u && needsPastedText(u))
  if (!link) return null
  if (!req.job?.text?.trim()) return { code: 'job_needs_text', message: needsTextMessage(link) }
  if (needsPastedText(req.url)) return { code: 'job_needs_site', message: needsSiteMessage(link) }
  return null
}
