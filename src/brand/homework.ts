import { assertPublicUrl } from './guard.ts'

/**
 * Homework: what a company has said lately, beyond its homepage. Their blog, changelog, news,
 * engineering and podcast pages, read through the RSS or Atom feeds they publish (dated, and
 * the same thing their own readers subscribe to), plus where their docs live. Only their own
 * site and the feeds it links to are read: no search engine, nothing that costs money.
 *
 * Best effort by design: a site with no feeds still makes a film, it just has less homework.
 */

export type HomeworkKind = 'blog' | 'changelog' | 'news' | 'engineering' | 'podcast' | 'docs'

export interface HomeworkItem {
  kind: HomeworkKind
  /** as the company titled it */
  title: string
  url: string
  /** ISO date, when the feed gives one */
  date?: string
}

export interface Homework {
  /** recent posts, release notes and episodes, newest first */
  items: HomeworkItem[]
  /** their pages worth knowing about, found on the homepage (docs, blog, changelog...) */
  pages: { kind: HomeworkKind; url: string }[]
}

const KINDS: [HomeworkKind, RegExp][] = [
  ['changelog', /change-?log|release-?notes|releases\b|what'?s-?new|product-?updates|\bupdates\b/i],
  ['engineering', /engineering|tech-?blog|\/eng\b/i],
  ['podcast', /podcast|episodes|podcasts\.apple\.com|open\.spotify\.com\/show/i],
  ['news', /newsroom|\bnews\b|\bpress\b|announcements/i],
  ['blog', /\bblog\b|\barticles\b|\bposts\b|\bstories\b|\binsights\b|\bresources\/blog/i],
  ['docs', /\bdocs?\b|documentation|developers?\.|\/developers?\b|\bapi-?reference/i],
]

const MAX_BYTES = 1_500_000
const MAX_REQUESTS = 16

/**
 * Where sites usually keep their feeds, tried on their own domain when the homepage announces
 * none (feeds are often linked only from menus that load later, like linear.app's changelog).
 */
export const COMMON_FEEDS = [
  '/rss/changelog.xml',
  '/changelog/rss.xml',
  '/changelog.xml',
  '/rss/blog.xml',
  '/blog/rss.xml',
  '/blog/feed',
  '/rss.xml',
  '/feed',
  '/atom.xml',
]
const RECENT_DAYS = 90

export interface HomeworkOptions {
  allowPrivateNetworks?: boolean
  timeoutMs?: number
  now?: number
  fetch?: typeof fetch
}

/** decode the handful of entities feeds and pages use in titles */
export function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

const attr = (tag: string, name: string) =>
  tag
    .match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
    ?.slice(2)
    .find(Boolean)

/** the feeds a page announces in its <head> */
export function feedLinks(html: string, base: string): string[] {
  const out: string[] = []
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const type = attr(tag, 'type') ?? ''
    const rel = attr(tag, 'rel') ?? ''
    const href = attr(tag, 'href')
    if (!href || !/alternate/i.test(rel) || !/(rss|atom)\+xml|feed\+json/i.test(type)) continue
    if (/json/i.test(type)) continue
    try {
      out.push(new URL(decode(href), base).toString())
    } catch {}
  }
  return [...new Set(out)]
}

/** links on the homepage that lead to their blog, changelog, docs... (their own site, or a podcast host) */
export function sectionLinks(html: string, base: string): { kind: HomeworkKind; url: string }[] {
  const site = new URL(base)
  const root = site.hostname.replace(/^www\./, '')
  const found = new Map<HomeworkKind, string>()
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1]!, 'href')
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue
    let u: URL
    try {
      u = new URL(decode(href), base)
    } catch {
      continue
    }
    const host = u.hostname.replace(/^www\./, '')
    const own = host === root || host.endsWith(`.${root}`)
    const text = decode(m[2]!).slice(0, 60)
    const hay = `${u.hostname}${u.pathname} ${text}`
    for (const [kind, re] of KINDS) {
      if (found.has(kind) || !re.test(hay)) continue
      // only a podcast may live on another site (Apple Podcasts, Spotify)
      if (!own && kind !== 'podcast') continue
      // a link to one post is not the blog
      if (own && u.pathname.split('/').filter(Boolean).length > 2) continue
      u.hash = ''
      found.set(kind, u.toString())
      break
    }
  }
  return [...found].map(([kind, url]) => ({ kind, url }))
}

/** items from an RSS or Atom feed */
export function parseFeed(
  xml: string,
  base: string,
): { title: string; url: string; date?: string }[] {
  const out: { title: string; url: string; date?: string }[] = []
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? []
  for (const b of blocks.slice(0, 40)) {
    const title = decode(b.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    const rssLink = b.match(/<link>([\s\S]*?)<\/link>/i)?.[1]
    const atomLink = (b.match(/<link\b[^>]*rel=["']alternate["'][^>]*>/i) ??
      b.match(/<link\b[^>]*href=[^>]*>/i))?.[0]
    const href = rssLink ? decode(rssLink) : atomLink ? attr(atomLink, 'href') : undefined
    const when = b.match(/<(pubDate|published|updated|dc:date)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2]
    if (!title || !href || title.length < 4) continue
    let url: string
    try {
      url = new URL(decode(href), base).toString()
    } catch {
      continue
    }
    const t = when ? Date.parse(decode(when)) : Number.NaN
    out.push({
      title: title.length > 140 ? `${title.slice(0, 139)}…` : title,
      url,
      ...(Number.isFinite(t) ? { date: new Date(t).toISOString().slice(0, 10) } : {}),
    })
  }
  return out
}

/** the kind a feed is about, from where it lives */
function kindOf(url: string, fallback: HomeworkKind): HomeworkKind {
  for (const [kind, re] of KINDS) if (kind !== 'docs' && re.test(url)) return kind
  return fallback
}

export async function readHomework(site: string, opts: HomeworkOptions = {}): Promise<Homework> {
  const get = opts.fetch ?? fetch
  const now = opts.now ?? Date.now()
  let budget = MAX_REQUESTS

  /** one page, guarded: public hosts only (each redirect checked), size-capped, time-boxed */
  async function read(url: string): Promise<{ text: string; url: string } | null> {
    let at = url
    for (let hop = 0; hop < 4; hop++) {
      if (budget-- <= 0) return null
      try {
        if (!opts.allowPrivateNetworks) await assertPublicUrl(at)
        const res = await get(at, {
          redirect: 'manual',
          signal: AbortSignal.timeout(opts.timeoutMs ?? 6000),
          headers: {
            accept:
              'text/html,application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.5',
            'user-agent': 'coldopen (+https://github.com/tiwaker9404/coldopen)',
          },
        })
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location')
          if (!loc) return null
          at = new URL(loc, at).toString()
          continue
        }
        if (!res.ok || !res.body) return null
        const reader = res.body.getReader()
        const chunks: Uint8Array[] = []
        let size = 0
        while (size < MAX_BYTES) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          size += value.length
        }
        await reader.cancel().catch(() => {})
        return { text: Buffer.concat(chunks).toString('utf8'), url: at }
      } catch {
        return null
      }
    }
    return null
  }

  const home = await read(site)
  if (!home) return { items: [], pages: [] }
  const pages = sectionLinks(home.text, home.url)

  // feeds: the ones the homepage announces, then the ones each news-like section announces
  const feeds = new Map<string, HomeworkKind>()
  for (const f of feedLinks(home.text, home.url)) feeds.set(f, kindOf(f, 'blog'))
  for (const p of pages) {
    if (p.kind === 'docs' || feeds.size >= 4) continue
    if (!new URL(p.url).hostname.endsWith(new URL(home.url).hostname.replace(/^www\./, '')))
      continue
    const page = await read(p.url)
    if (!page) continue
    for (const f of feedLinks(page.text, page.url)) if (!feeds.has(f)) feeds.set(f, p.kind)
  }

  // none announced: try the usual places on their own domain, keeping what is really a feed
  const fetched = new Map<string, { text: string; url: string }>()
  if (feeds.size === 0) {
    const origin = new URL(home.url).origin
    for (const path of COMMON_FEEDS) {
      if (feeds.size >= 2 || budget <= 1) break
      const url = `${origin}${path}`
      const got = await read(url)
      if (!got || !/<(rss|feed)\b/i.test(got.text.slice(0, 4000))) continue
      fetched.set(url, got)
      feeds.set(url, kindOf(path, 'blog'))
    }
  }

  const cutoff = now - RECENT_DAYS * 86_400_000
  const items: HomeworkItem[] = []
  for (const [url, kind] of [...feeds].slice(0, 4)) {
    const feed = fetched.get(url) ?? (await read(url))
    if (!feed) continue
    // a podcast feed's episodes are episodes, whatever page linked it
    const k = /<itunes:/i.test(feed.text) ? 'podcast' : kind
    for (const it of parseFeed(feed.text, feed.url)) {
      if (!it.date || Date.parse(it.date) < cutoff || Date.parse(it.date) > now + 86_400_000)
        continue
      if (items.some((x) => x.url === it.url || x.title === it.title)) continue
      items.push({ kind: k, ...it })
    }
  }
  items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  // a mix beats a wall of one kind: at most four of each
  const per = new Map<HomeworkKind, number>()
  const kept = items.filter((i) => {
    const n = (per.get(i.kind) ?? 0) + 1
    per.set(i.kind, n)
    return n <= 4
  })
  return { items: kept.slice(0, 8), pages }
}
