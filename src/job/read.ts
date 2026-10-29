import { readFile } from 'node:fs/promises'
import { assertPublicUrl, guardPage } from '../brand/guard.ts'
import { getBrowser } from '../browser.ts'
import {
  cleanTitle,
  type JobItem,
  type JobPost,
  JobPostSchema,
  jobFromText,
  pickRequirements,
} from './post.ts'

/**
 * Reads a job post from its page. Works on company careers pages and the usual applicant
 * tracking systems (Greenhouse, Lever, Ashby, Workable), which all render the description
 * as headings followed by lists. LinkedIn job pages need a login, so paste those as text.
 */
export async function fetchJob(
  url: string,
  opts: { allowPrivateNetworks?: boolean; timeoutMs?: number } = {},
): Promise<JobPost> {
  if (/linkedin\.com\/jobs/i.test(url))
    throw new Error(
      'LinkedIn job pages need a login. Copy the job description into a text file and pass that instead: --job job.txt',
    )
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
      const h1 = document.querySelector('h1') as HTMLElement | null
      const og = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
      const site = document.querySelector<HTMLMetaElement>('meta[property="og:site_name"]')?.content
      return {
        title: h1?.innerText.trim() || og || document.title,
        site: site ?? '',
        items,
        text: document.body.innerText.slice(0, 30000),
      }
    })) as { title: string; site: string; items: JobItem[]; text: string }

    const title = cleanTitle(raw.title, raw.site || undefined)
    const requirements = pickRequirements(raw.items)
    // no lists on the page: read the text the way a pasted post is read
    if (requirements.length === 0) return jobFromText(raw.text, title, url)
    return JobPostSchema.parse({ url, title, requirements })
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
