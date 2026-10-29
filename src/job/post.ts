import { z } from 'zod'
import { tidy } from '../brand/text.ts'

/**
 * A job post, reduced to what a film can answer: the role's title and the requirements,
 * word for word, most important first. Pure text handling; the browser part is in read.ts.
 */
export const JobPostSchema = z.object({
  url: z.string().optional(),
  /** the company's own website, when the post links to it (job boards usually do) */
  companyUrl: z.string().optional(),
  title: z.string().min(2).max(80),
  requirements: z.array(z.string().min(10).max(400)).min(1).max(12),
})
export type JobPost = z.infer<typeof JobPostSchema>

/** One list item and the heading it sits under. */
export interface JobItem {
  heading: string
  text: string
}

// what a section is, judged by its heading
const ASKS =
  /requirement|qualifications?|you('|’)?ll (need|bring|have)|you (have|bring|are|might be)|about you|who you are|looking for|what (we|you)('|’)?re looking|must[- ]haves?|skills|experience|ideal candidate|you may be a (good )?fit|what you bring|preferred|nice[- ]to[- ]haves?|bonus|plus/i
const DOES =
  /responsibilit|you('|’)?ll do|what you('|’)?ll (do|work on|own)|the role|day[- ]to[- ]day|in this role|your impact|what you will|you will|the job|role overview/i
const SKIP =
  /benefit|perks?|compensation|salary|pay (range|transparency)|equal opportunity|eeo|accommodation|about (us|the company)|our (values|culture|mission)|why join|what we offer|we offer|privacy|how to apply|interview process|life at/i
// items that are about the employer's offer, not the job
const SKIP_ITEM =
  /\b(401\(?k\)?|health(care)?|dental|vision|insurance|pto|paid time off|parental leave|stipend|equity|salary|base pay|\$\s?\d{2,3}[,k]|visa sponsorship|relocation|wellness|gym|lunch|snacks|holidays?)\b/i

/** Higher is more worth answering; negative is not a requirement at all. */
export function sectionWeight(heading: string): number {
  if (SKIP.test(heading)) return -1
  if (/nice[- ]to[- ]haves?|bonus|preferred|plus\b/i.test(heading)) return 2
  if (ASKS.test(heading)) return 3
  if (DOES.test(heading)) return 2
  return 0
}

/**
 * Picks the requirements to answer: what they ask for, then what the job does, then anything
 * else that reads like a requirement. Benefits, legal text and company blurbs are dropped.
 */
export function pickRequirements(items: JobItem[], max = 10): string[] {
  const seen = new Set<string>()
  const scored = items
    .map((it, i) => ({
      text: tidy(it.text)
        .replace(/^[-•*·▪◦●–]\s*/, '')
        .replace(/\s*;$/, '.'),
      w: sectionWeight(it.heading),
      i,
    }))
    .filter((x) => {
      if (x.w < 0 || x.text.length < 15 || x.text.length > 400) return false
      if (SKIP_ITEM.test(x.text)) return false
      const key = x.text.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  // a page with real sections: use only those; otherwise every list item is a candidate
  const sectioned = scored.some((x) => x.w > 0) ? scored.filter((x) => x.w > 0) : scored
  return sectioned
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .slice(0, max)
    .map((x) => x.text)
}

const BULLET = /^\s*(?:[-•*·▪◦●–]|\d{1,2}[.)])\s+/

/**
 * A pasted job description: headings are short lines without a full stop (often ending in a
 * colon), requirements are the bullets or lines under them.
 */
export function itemsFromText(text: string): JobItem[] {
  const items: JobItem[] = []
  let heading = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const bullet = BULLET.test(line)
    const body = line.replace(BULLET, '').trim()
    const looksHeading =
      !bullet &&
      body.length <= 70 &&
      !/[.!?]$/.test(body) &&
      (/:$/.test(body) || /^#{1,6}\s/.test(line) || body.split(/\s+/).length <= 7)
    if (looksHeading) {
      heading = body.replace(/^#+\s*/, '').replace(/:$/, '')
      continue
    }
    if (bullet || sectionWeight(heading) > 0) items.push({ heading, text: body })
  }
  return items
}

/** "Forward Deployed Engineer - Enterprise (NYC) | Deel" -> "Forward Deployed Engineer" */
export function cleanTitle(raw: string, company?: string): string {
  let t = tidy(raw)
    .replace(/\s*[|·•–—]\s*.*$/, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/^job application for\s+/i, '')
    .replace(/\s+at\s+[\w .&-]+$/i, '')
    .replace(
      /,\s*(remote|hybrid|on-?site|us|usa|united states|new york|san francisco|sf|nyc|london)\b.*$/i,
      '',
    )
    .trim()
  if (company)
    t = t
      .replace(new RegExp(`\\s*${company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '')
      .trim()
  return t.slice(0, 80) || 'this role'
}

/** A job post from pasted text (a file, or the web app's text box). */
export function jobFromText(text: string, title?: string, url?: string): JobPost {
  const firstLine = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean)
  const requirements = pickRequirements(itemsFromText(text))
  if (requirements.length === 0)
    throw new Error(
      "couldn't find requirements in that job post; paste the part with the bullet points (what you'll do, what they're looking for)",
    )
  return JobPostSchema.parse({
    ...(url ? { url } : {}),
    title: cleanTitle(title ?? firstLine ?? 'this role'),
    requirements,
  })
}

/** Job boards that host many companies' posts on their own domain. */
const BOARDS =
  /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|bamboohr\.com|recruitee\.com|workdayjobs\.com|myworkdayjobs\.com|jobvite\.com|breezy\.hr|teamtailor\.com|rippling-ats\.com|wellfound\.com)$/i

export function isBoardHost(host: string): boolean {
  return BOARDS.test(host)
}

/**
 * True for a link to one job post: on a job board, or a company's own careers page with a
 * specific opening ("/careers/123", "/jobs/forward-deployed-engineer"). A homepage is not.
 */
export function isJobPage(url: string): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (/linkedin\.com$/i.test(u.hostname) && /^\/jobs\//.test(u.pathname)) return true
  if (isBoardHost(u.hostname)) return u.pathname.split('/').filter(Boolean).length >= 2
  return /\/(careers?|jobs?|positions?|openings?|roles?)\/[^/]+/i.test(u.pathname)
}

/** A careers page on the company's own site: its homepage is the same origin. */
export function homepageFor(url: string): string | null {
  const u = new URL(url)
  if (isBoardHost(u.hostname) || /linkedin\.com$/i.test(u.hostname)) return null
  return `${u.protocol}//${u.host.replace(/^(careers|jobs)\./i, '')}/`
}
