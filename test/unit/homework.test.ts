import { describe, expect, it } from 'vitest'
import {
  decode,
  feedLinks,
  parseFeed,
  readHomework,
  sectionLinks,
} from '../../src/brand/homework.ts'

const NOW = Date.parse('2026-11-03T12:00:00Z')

const HOME = `<!doctype html><html><head>
<link rel="alternate" type="application/rss+xml" href="/blog/rss.xml" title="Blog">
</head><body>
<nav><a href="/blog">Blog</a> <a href="/changelog">Changelog</a> <a href="https://docs.acme.example/">Docs</a>
<a href="https://podcasts.apple.com/us/podcast/acme-radio/id1">Podcast</a>
<a href="https://twitter.com/acme">X</a> <a href="/blog/2026/10/one-post">A post</a></nav>
</body></html>`

const CHANGELOG = `<html><head><link rel="alternate" type="application/atom+xml" href="https://acme.example/changelog/atom.xml"></head></html>`

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[How we cut routing time by 38%]]></title><link>https://acme.example/blog/routing</link><pubDate>Tue, 27 Oct 2026 09:00:00 GMT</pubDate></item>
<item><title>Q2 recap &amp; what&#39;s next</title><link>https://acme.example/blog/q2</link><pubDate>Mon, 01 Jun 2026 09:00:00 GMT</pubDate></item>
<item><title>Undated note</title><link>https://acme.example/blog/undated</link></item>
</channel></rss>`

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>Dock scheduling, now in every plan</title><link rel="alternate" href="/changelog/dock"/><updated>2026-10-30T00:00:00Z</updated></entry>
</feed>`

function fakeFetch(pages: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    const body = pages[url]
    return body === undefined
      ? new Response('not found', { status: 404 })
      : new Response(body, { status: 200 })
  }) as typeof fetch
}

describe('homework: what a company published lately', () => {
  it('finds the feeds and sections a homepage links to', () => {
    expect(feedLinks(HOME, 'https://acme.example/')).toEqual(['https://acme.example/blog/rss.xml'])
    const kinds = Object.fromEntries(
      sectionLinks(HOME, 'https://acme.example/').map((p) => [p.kind, p.url]),
    )
    expect(kinds).toEqual({
      blog: 'https://acme.example/blog',
      changelog: 'https://acme.example/changelog',
      docs: 'https://docs.acme.example/',
      podcast: 'https://podcasts.apple.com/us/podcast/acme-radio/id1',
    })
  })

  it('reads RSS and Atom, decoding titles', () => {
    const rss = parseFeed(RSS, 'https://acme.example/blog/rss.xml')
    expect(rss[0]).toEqual({
      title: 'How we cut routing time by 38%',
      url: 'https://acme.example/blog/routing',
      date: '2026-10-27',
    })
    expect(rss[1]!.title).toBe("Q2 recap & what's next")
    const atom = parseFeed(ATOM, 'https://acme.example/changelog/atom.xml')
    expect(atom[0]!.url).toBe('https://acme.example/changelog/dock')
    expect(decode('<b>Bold</b> &amp; <i>brave</i>')).toBe('Bold & brave')
  })

  it('keeps only dated items from the last 90 days, newest first', async () => {
    const hw = await readHomework('https://acme.example/', {
      allowPrivateNetworks: true,
      now: NOW,
      fetch: fakeFetch({
        'https://acme.example/': HOME,
        'https://acme.example/blog/rss.xml': RSS,
        'https://acme.example/changelog': CHANGELOG,
        'https://acme.example/changelog/atom.xml': ATOM,
      }),
    })
    expect(hw.items.map((i) => [i.kind, i.title])).toEqual([
      ['changelog', 'Dock scheduling, now in every plan'],
      ['blog', 'How we cut routing time by 38%'],
    ])
    expect(hw.pages.find((p) => p.kind === 'docs')?.url).toBe('https://docs.acme.example/')
  })

  it('returns nothing, without failing, when the site is unreachable', async () => {
    const hw = await readHomework('https://down.example/', {
      allowPrivateNetworks: true,
      fetch: fakeFetch({}),
    })
    expect(hw).toEqual({ items: [], pages: [] })
  })

  it('never reads a private address', async () => {
    let called = false
    const hw = await readHomework('http://127.0.0.1:9/', {
      fetch: (async () => {
        called = true
        return new Response('')
      }) as typeof fetch,
    })
    expect(called).toBe(false)
    expect(hw.items).toEqual([])
  })
})
