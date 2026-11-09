import { readFile } from 'node:fs/promises'
import { assertPublicUrl, guardPage } from '../brand/guard.ts'
import { getBrowser } from '../browser.ts'
import { NonRetryableError } from '../runtime/errors.ts'
import {
  cleanTitle,
  homepageFor,
  isJobPage,
  type JobItem,
  type JobPost,
  JobPostSchema,
  jobFromText,
  needsPastedText,
  needsTextMessage,
  pickRequirements,
} from './post.ts'

/** A sign-in page, judged by where it ended up and what it says. */
export function looksLikeLoginWall(finalUrl: string, text: string, hasPassword: boolean): boolean {
  let path = ''
  try {
    path = new URL(finalUrl).pathname
  } catch {}
  if (
    /\/(login|log-in|signin|sign-in|sign_in|authwall|uas\/login|auth\/login|account\/login)\b/i.test(
      path,
    )
  )
    return true
  const asks =
    /\b(sign|log) ?in (to|or (create|join|sign up)) (see|view|continue|apply|read)|join (now )?to (see|view)|you must (sign|log) ?in|please (sign|log) ?in\b/i
  // a real post is long; a wall is a short page with a password box or a sign-in ask
  return text.length < 3000 && (hasPassword || asks.test(text))
}

/**
 * Reads a job post from its page. Works on company careers pages and the usual applicant
 * tracking systems (Greenhouse, Lever, Ashby, Workable), which all render the description
 * as headings followed by lists. LinkedIn, Indeed and Glassdoor job pages need a login, so
 * those fail at once with a NonRetryableError asking for the pasted text, as does any page
 * that turns out to be a sign-in wall.
 */
export async function fetchJob(
  url: string,
  opts: { allowPrivateNetworks?: boolean; timeoutMs?: number } = {},
): Promise<JobPost> {
  // retrying won't log in, so these fail at once, in words the web app can show
  if (needsPastedText(url)) throw new NonRetryableError(needsTextMessage(url))
  if (!opts.allowPrivateNetworks) await assertPublicUrl(url)
  const browser = await getBrowser()
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  try {
    if (!opts.allowPrivateNetworks) await guardPage(page)
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 coldopen/1.0',
    )
    const res = await page
      .goto(url, { waitUntil: 'networkidle2', timeout: opts.timeoutMs ?? 30_000 })
      .catch(async (err: Error) => {
        // a busy page that never goes quiet is still readable once the document is there
        if (!/timeout/i.test(err.message)) throw err
        return null
      })
    if (res && res.status() >= 400) throw new Error(`${url} returned HTTP ${res.status()}`)
    // client-rendered boards (Ashby) fill in after load
    await page
      .waitForFunction(() => document.querySelectorAll('li').length > 3, { timeout: 8000 })
      .catch(() => {})

    const raw = (await page.evaluate(() => {
      const isHeading = (el: Element) => {
        if (/^H[1-6]$/.test(el.tagName)) return true
        const t = (el as HTMLElement).innerText?.trim() ?? ''
        if (!t || t.length > 80) return false
        // "<p><strong>What you'll do</strong></p>" is how many boards mark headings
        if (el.matches('strong, b')) return true
        const only = el.children.length === 1 ? el.children[0]! : null
        return !!only && only.matches('strong, b') && (only as HTMLElement).innerText.trim() === t
      }
      const headingFor = (li: Element): string => {
        let node: Element | null = li.closest('ul, ol')
        for (let depth = 0; node && depth < 6; depth++) {
          let prev = node.previousElementSibling
          while (prev) {
            if (isHeading(prev)) return (prev as HTMLElement).innerText.trim()
            const inner = [...prev.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b')].pop()
            if (inner && (inner as HTMLElement).innerText.trim().length <= 80)
              return (inner as HTMLElement).innerText.trim()
            prev = prev.previousElementSibling
          }
          node = node.parentElement
        }
        return ''
      }
      const items: { heading: string; text: string }[] = []
      for (const li of document.querySelectorAll('li')) {
        if (li.closest('nav, header, footer, [role=navigation]')) continue
        if (li.querySelector('li')) continue // a list of lists: take the inner items
        const text = (li as HTMLElement).innerText.trim()
        if (text) items.push({ heading: headingFor(li), text })
      }
      // the company's own site: job boards link to it from the logo or a "website" link
      const here = location.hostname
      const social =
        /(^|\.)(linkedin|twitter|x|facebook|instagram|youtube|github|glassdoor|crunchbase|tiktok)\.com$|greenhouse\.io$|lever\.co$|ashbyhq\.com$|workable\.com$|google\.com$|apple\.com$/i
      const outward = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')]
        .map((a) => {
          let host = ''
          try {
            host = new URL(a.href).hostname
          } catch {}
          const label = `${a.innerText} ${a.getAttribute('aria-label') ?? ''}`.toLowerCase()
          const score =
            (a.querySelector('img, svg') ? 3 : 0) +
            (/website|homepage|visit|about us/.test(label) ? 3 : 0) +
            (a.closest('header, nav') ? 2 : 0) +
            (a.closest('footer') ? -1 : 0)
          return { href: a.href, host, score }
        })
        .filter((l) => l.host && l.host !== here && !social.test(l.host))
        .sort((a, b) => b.score - a.score)
      const h1 = document.querySelector('h1') as HTMLElement | null
      const og = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
      const site = document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content
      return {
        finalUrl: location.href,
        hasPassword: !!document.querySelector('input[type=password]'),
        title: h1?.innerText.trim() || og || document.title,
        site: site ?? '',
        items,
        text: document.body.innerText.slice(0, 30000),
        company: outward[0] ? new URL(outward[0].href).origin : '',
      }
    })) as {
      finalUrl: string
      hasPassword: boolean
      title: string
      site: string
      items: JobItem[]
      text: string
      company: string
    }
    const title = cleanTitle(raw.title, raw.site || undefined)
    const requirements = pickRequirements(raw.items)
    // nothing to read and it asks to sign in: a login wall, which no retry gets past
    if (requirements.length === 0 && looksLikeLoginWall(raw.finalUrl, raw.text, raw.hasPassword))
      throw new NonRetryableError(needsTextMessage(url))
    // a careers page on the company's own site: its homepage. A job board: the site it links to.
    const own = isJobPage(url) ? homepageFor(url) : null
    const companyUrl = own ?? (raw.company ? `${raw.company}/` : undefined)
    const extra = companyUrl ? { companyUrl } : {}
    // no lists on the page: read the text the way a pasted post is read
    if (requirements.length === 0) return { ...jobFromText(raw.text, title, url), ...extra }
    return JobPostSchema.parse({ url, title, requirements, ...extra })
  } finally {
    await context.close().catch(() => {})
  }
}

/** --job accepts a URL or a text/markdown file with the pasted description. */
export async function readJob(
  source: string,
  opts: { allowPrivateNetworks?: boolean; title?: string } = {},
): Promise<JobPost> {
  if (/^https?:\/\//i.test(source)) return fetchJob(source, opts)
  const text = await readFile(source, 'utf8').catch(() => {
    throw new Error(`--job ${source}: not a URL, and no such file`)
  })
  return jobFromText(text, opts.title)
}
