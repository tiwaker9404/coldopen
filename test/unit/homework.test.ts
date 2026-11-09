import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  decode,
  feedLinks,
  type Homework,
  parseFeed,
  pickResearch,
  readHomework,
  sectionLinks,
  summaryOf,
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

  it('tries the usual feed addresses when the homepage announces none', async () => {
    const hw = await readHomework('https://quiet.example/', {
      allowPrivateNetworks: true,
      now: NOW,
      fetch: fakeFetch({
        'https://quiet.example/': '<html><body><a href="/docs">Docs</a></body></html>',
        // a single-page app answers every path with its page: not a feed, so skipped
        'https://quiet.example/changelog/rss.xml': '<!doctype html><html></html>',
        'https://quiet.example/rss/changelog.xml': RSS,
      }),
    })
    expect(hw.items.map((i) => [i.kind, i.title])).toEqual([
      ['changelog', 'How we cut routing time by 38%'],
    ])
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

const PARCELPINE = readFileSync(
  join(import.meta.dirname, '../../fixtures/sites/parcelpine/changelog.xml'),
  'utf8',
)

describe('homework: what each post says', () => {
  it('turns a long HTML description into one clean sentence', () => {
    const rss = `<rss><channel><item><title>Faster dispatch</title>
<link>https://acme.example/blog/dispatch</link><pubDate>Tue, 27 Oct 2026 09:00:00 GMT</pubDate>
<description><![CDATA[<p>We rebuilt the <strong>dispatch board</strong> so a planner can move 40 stops in one drag &amp; drop.</p>
<p>Here is how we did it, and what we learned along the way.</p><img src="x.png">]]></description></item>
</channel></rss>`
    expect(parseFeed(rss, 'https://acme.example/')[0]!.summary).toBe(
      'We rebuilt the dispatch board so a planner can move 40 stops in one drag & drop.',
    )
  })

  it('reads an Atom <summary type="html"> whose HTML arrives escaped', () => {
    const [live] = parseFeed(PARCELPINE, 'http://127.0.0.1/parcelpine/changelog.xml')
    expect(live).toEqual({
      title: 'Route planning, now with live traffic',
      url: 'http://127.0.0.1/parcelpine/changelog/live-traffic',
      date: '2026-10-28',
      summary:
        'Route planning now reroutes trucks around live traffic before a delivery runs late, for every lane.',
    })
  })

  it('leaves the summary out of a title-only feed, and when it only repeats the title', () => {
    // the test feed above has no descriptions at all
    expect(parseFeed(RSS, 'https://acme.example/').every((i) => !('summary' in i))).toBe(true)
    // "Dark mode for dispatch." says nothing the title doesn't
    const dark = parseFeed(PARCELPINE, 'http://127.0.0.1/').find((i) => i.title.startsWith('Dark'))
    expect(dark).toBeDefined()
    expect(dark!.summary).toBeUndefined()
    expect(summaryOf('Too short.', 'Anything')).toBeUndefined()
  })

  it('cuts a sentence over 200 characters at a word, never mid-word', () => {
    const long = `${'Dispatchers '.repeat(30)}finally rest.`
    const s = summaryOf(long, 'A long one')!
    expect(s.length).toBeLessThanOrEqual(200)
    expect(s.endsWith('Dispatchers…')).toBe(true)
  })

  it('carries the summary through readHomework', async () => {
    const hw = await readHomework('https://pp.example/', {
      allowPrivateNetworks: true,
      now: NOW,
      fetch: fakeFetch({
        'https://pp.example/': `<html><head><link rel="alternate" type="application/atom+xml" href="/changelog.xml"></head></html>`,
        'https://pp.example/changelog.xml': PARCELPINE,
      }),
    })
    expect(hw.items[0]!.summary).toMatch(/^Route planning now reroutes trucks/)
  })
})

describe('pickResearch: the one post an email should mention', () => {
  const changelog = parseFeed(PARCELPINE, 'http://127.0.0.1/').map((i) => ({
    kind: 'changelog' as const,
    ...i,
  }))
  const podcast = {
    kind: 'podcast' as const,
    title: 'Episode 12: our founders on the road',
    url: 'http://127.0.0.1/podcast/12',
    date: '2026-11-01',
  }
  const hw: Homework = { items: [podcast, ...changelog], pages: [] }
  const ops = {
    role: 'Operations Analyst',
    requirements: ['Improve route planning and delivery times', 'SQL'],
  }

  it('picks the changelog entry about route planning over a newer podcast episode', () => {
    expect(pickResearch(hw, ops, NOW)?.title).toBe('Route planning, now with live traffic')
  })

  it('prefers a researchable kind even when nothing shares words, newest first', () => {
    expect(pickResearch(hw, { role: 'Chef' }, NOW)?.title).toBe(
      'Route planning, now with live traffic',
    )
    expect(pickResearch({ items: [podcast], pages: [] }, { role: 'Chef' }, NOW)?.url).toBe(
      podcast.url,
    )
  })

  it('breaks ties by recency', () => {
    const a = {
      kind: 'blog' as const,
      title: 'Warehouse notes',
      url: 'http://x/a',
      date: '2026-10-01',
    }
    const b = { ...a, url: 'http://x/b', date: '2026-10-20' }
    expect(pickResearch({ items: [a, b], pages: [] }, {}, NOW)?.url).toBe('http://x/b')
  })

  it('returns null when every item is older than 90 days', () => {
    expect(pickResearch(hw, ops, Date.parse('2027-06-01T00:00:00Z'))).toBeNull()
    expect(pickResearch({ items: [], pages: [] }, ops, NOW)).toBeNull()
  })
})
