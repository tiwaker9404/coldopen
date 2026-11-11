import { overlap } from '../script/checks.ts'
import { assertPublicUrl } from './guard.ts'
import type { Fact } from './types.ts'

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
  /**
   * the first sentence of what the post says (its description or summary), tags stripped, at
   * most 200 characters. Absent when the feed gives none, or it only repeats the title.
   */
  summary?: string
}

export interface Homework {
  /** recent posts, release notes and episodes, newest first */
  items: HomeworkItem[]
  /** their pages worth knowing about, found on the homepage (docs, blog, changelog...) */
  pages: { kind: HomeworkKind; url: string }[]
  /** the first real sentence on the docs page they link, when there is one */
  docs?: { url: string; text: string }
  /** when it was read (ISO): what "recent" is measured from, so a replayed film picks the same */
  readAt?: string
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

const SUMMARY_MAX = 200

/**
 * The first sentence of a feed item's description, as plain text. Feeds send HTML either in
 * CDATA or escaped (Atom's type="html"), so tags are stripped again once entities are decoded.
 * Long sentences are cut at a word, never mid-word. Returns undefined when what's left is too
 * short to say anything, or says nothing the title doesn't.
 */
export function summaryOf(raw: string, title: string): string | undefined {
  // block tags (raw or escaped) end a sentence's run of text: keep a space where they were,
  // or two paragraphs glue together ("…every lane.Turn it on")
  const spaced = raw.replace(
    /(?:<|&lt;)\/?(?:p|div|li|ul|ol|br|h[1-6]|blockquote|figure|section)\b[\s\S]*?(?:>|&gt;)/gi,
    ' ',
  )
  let text = decode(spaced)
  if (/<\/?[a-z][^>]*>/i.test(text)) text = decode(text)
  // the first sentence: ends at . ! or ? followed by a space and a capital, digit or quote
  const first = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“‘'])/)[0]?.trim() ?? ''
  let s = first
  if (s.length > SUMMARY_MAX) {
    const cut = s.slice(0, SUMMARY_MAX - 1)
    s = `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : cut.length).replace(/[\s,;:–—-]+$/, '')}…`
  }
  if (s.length < 20) return undefined
  if (overlap(s, title) >= 1) return undefined
  return s
}

/** items from an RSS or Atom feed */
export function parseFeed(
  xml: string,
  base: string,
): { title: string; url: string; date?: string; summary?: string }[] {
  const out: { title: string; url: string; date?: string; summary?: string }[] = []
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
    // RSS <description>, Atom <summary>, then the full <content> (or content:encoded) as a last resort
    const body =
      b.match(/<(description|summary)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2] ??
      b.match(/<(content:encoded|content)\b[^>]*>([\s\S]*?)<\/\1>/i)?.[2]
    const summary = body ? summaryOf(body, title) : undefined
    out.push({
      title: title.length > 140 ? `${title.slice(0, 139)}…` : title,
      url,
      ...(Number.isFinite(t) ? { date: new Date(t).toISOString().slice(0, 10) } : {}),
      ...(summary ? { summary } : {}),
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
  const readAt = new Date(now).toISOString()
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
  // their docs: one page, read last so feeds come first when the request budget runs short
  const docsPage = pages.find((p) => p.kind === 'docs')
  const page = docsPage ? await read(docsPage.url) : null
  const text = page ? docsSentence(page.text) : null
  return {
    items: kept.slice(0, 8),
    pages,
    ...(page && text ? { docs: { url: page.url, text } } : {}),
    readAt,
  }
}

/**
 * The first real sentence of a docs page: from its first paragraph that reads as prose (not the
 * nav, header, footer, a code block or a cookie banner), 6 to 30 words, ending in a full stop.
 */
export function docsSentence(html: string): string | null {
  const body = html
    .replace(
      /<(script|style|nav|header|footer|aside|pre|code|noscript|svg|form)\b[\s\S]*?<\/\1>/gi,
      ' ',
    )
    .replace(/<!--[\s\S]*?-->/g, ' ')
  for (const m of body.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = decode(m[1]!)
    const first = text.split(/(?<=[.!])\s+(?=[A-Z0-9"“‘'])/)[0]?.trim() ?? ''
    const n = first.split(/\s+/).filter(Boolean).length
    if (n < 6 || n > 30 || !/[.!]$/.test(first) || /cookie|javascript|browser/i.test(first))
      continue
    return first
  }
  return null
}

/** a short, stable id from a url, so a fact keeps its id when the feed adds a newer post */
const idOf = (prefix: string, url: string) => {
  let h = 0x811c9dc5
  for (const ch of url) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${prefix}${h.toString(36).slice(0, 6)}`
}

/** a title that's already a sentence ("Refunds now land in two days.") can be quoted as is */
const isSentence = (t: string) => /[.!]$/.test(t.trim()) && t.trim().split(/\s+/).length >= 6

/** how far back a post may be and still be quoted as what they're doing now */
export const FACT_DAYS = 120
const MAX_FACTS = 6
const PER_KIND = 2

/**
 * What they've published, as facts the film can quote: each recent post's first sentence (or
 * its title, when the title is a full sentence), newest first, at most two of each kind so a
 * busy changelog doesn't crowd out the rest, plus the first sentence of their docs. A number
 * makes it a stat. Podcast episodes are quoted from their notes only, never their title.
 * At most 6, each with where it's from. `now` is the day the homework was read (readAt), so
 * the same homework always gives the same facts. Whether a fact stands alone is checked later.
 */
export function homeworkFacts(homework: Homework, now?: number): Fact[] {
  const at = now ?? (homework.readAt ? Date.parse(homework.readAt) : Number.NaN)
  const cutoff = Number.isFinite(at) ? at - FACT_DAYS * 86_400_000 : -Infinity
  const until = Number.isFinite(at) ? at + 86_400_000 : Infinity
  const per = new Map<HomeworkKind, number>()
  const out: Fact[] = []
  const room = homework.docs ? MAX_FACTS - 1 : MAX_FACTS
  const items = [...homework.items]
    .filter((i) => i.kind !== 'docs' && i.date)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  for (const i of items) {
    if (out.length >= room) break
    const t = Date.parse(i.date!)
    if (!(t >= cutoff && t <= until)) continue
    const text = i.summary ?? (i.kind !== 'podcast' && isSentence(i.title) ? i.title : undefined)
    if (!text || out.some((f) => f.text === text)) continue
    const n = (per.get(i.kind) ?? 0) + 1
    if (n > PER_KIND) continue
    per.set(i.kind, n)
    out.push({
      id: idOf('h', i.url),
      text,
      kind: /\d/.test(text) ? 'stat' : 'quote',
      source: {
        kind: i.kind as Exclude<HomeworkKind, 'docs'>,
        title: i.title,
        url: i.url,
        ...(i.date ? { date: i.date } : {}),
      },
    })
  }
  if (homework.docs)
    out.push({
      id: idOf('d', homework.docs.url),
      text: homework.docs.text,
      kind: /\d/.test(homework.docs.text) ? 'stat' : 'quote',
      source: { kind: 'docs', url: homework.docs.url },
    })
  return out
}

/**
 * The facts a film's script and storyboard see: everything on their homepage (and the job post),
 * then what they've published elsewhere. The script only offers the ones that stand alone
 * (script/checks.ts quotableFacts); the rest stay so the homepage scene can still point at them.
 */
export function withHomework<K extends { facts: Fact[] }>(
  kit: K,
  homework: Homework,
  now?: number,
): K {
  const extra = homeworkFacts(homework, now).filter(
    (f) => !kit.facts.some((k) => k.text === f.text),
  )
  return extra.length ? { ...kit, facts: [...kit.facts, ...extra] } : kit
}

/** kinds that say what a company built or learned, so they make a research line about the work */
const RESEARCHABLE: HomeworkKind[] = ['changelog', 'engineering', 'blog']

/**
 * The one item an email's research line should be about: recent, ideally a changelog,
 * engineering or blog post that shares words with the role, its requirements and the sender's
 * points. Ranked in tiers (the right kind and on topic, then on topic, then the right kind,
 * then anything recent), then by how much it shares, then newest first. Null when nothing is
 * from the last 90 days, so the email drops the line rather than citing something stale.
 */
export function pickResearch(
  homework: Homework,
  about: { role?: string; requirements?: string[]; points?: string[] },
  now = Date.now(),
): HomeworkItem | null {
  const cutoff = now - RECENT_DAYS * 86_400_000
  const topic = [about.role ?? '', ...(about.requirements ?? []), ...(about.points ?? [])].join(' ')
  const ranked = homework.items
    .filter((i) => {
      const t = i.date ? Date.parse(i.date) : Number.NaN
      return Number.isFinite(t) && t >= cutoff && t <= now + 86_400_000
    })
    .map((i) => {
      const share = topic.trim() ? overlap(`${i.title} ${i.summary ?? ''}`, topic) : 0
      const kind = RESEARCHABLE.includes(i.kind)
      const tier = kind && share > 0 ? 0 : share > 0 ? 1 : kind ? 2 : 3
      return { i, tier, share }
    })
    .sort(
      (a, b) =>
        a.tier - b.tier || b.share - a.share || (b.i.date ?? '').localeCompare(a.i.date ?? ''),
    )
  return ranked[0]?.i ?? null
}
