import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { contrast, parseColor } from '../../src/brand/color.ts'
import { type Homework, parseFeed, withHomework } from '../../src/brand/homework.ts'
import { closeBrowser } from '../../src/browser.ts'
import { compose, type Format } from '../../src/render/composition.ts'
import { openComposition, seek } from '../../src/render/render.ts'
import { buildTheme } from '../../src/render/theme.ts'
import { buildStoryboard } from '../../src/script/storyboard.ts'
import { deterministicScript } from '../../src/script/writer.ts'
import { fixtureServer, kitFor, profile } from '../helpers/index.ts'

/**
 * The fact scene's caption: under the quote, it says where the line is from ("From their
 * podcast, episode notes, Sep 2026"), in the scene's own text color, and fits every format.
 */

afterAll(async () => {
  await closeBrowser()
  ;(await fixtureServer()).close()
})

const root = join(import.meta.dirname, '../..')
const feed = (file: string, kind: 'changelog' | 'podcast') =>
  parseFeed(
    readFileSync(join(root, 'fixtures/sites/parcelpine', file), 'utf8'),
    'https://parcelpine.example/',
  ).map((i) => ({ kind, ...i }))
/** Parcelpine's changelog and podcast, read directly on a pinned day */
const HOMEWORK: Homework = {
  items: [...feed('changelog.xml', 'changelog'), ...feed('podcast.xml', 'podcast')],
  pages: [],
  readAt: '2026-11-03T12:00:00.000Z',
}

const FORMATS: Format[] = ['square', 'landscape', 'portrait']

async function filmWith(pick: (text: string) => boolean) {
  const { kit: home, dir } = await kitFor('parcelpine')
  const kit = withHomework(home, HOMEWORK)
  const p = profile('candidate')
  const fact = kit.facts.find((f) => pick(f.text))!
  expect(fact).toBeDefined()
  const script = {
    ...deterministicScript(kit, p),
    insight: { ...deterministicScript(kit, p).insight, factId: fact.id },
  }
  const board = buildStoryboard(kit, p, script)
  const theme = await buildTheme(kit, p, { allowPrivateNetworks: true })
  const shot = `data:image/jpeg;base64,${readFileSync(join(dir, kit.screenshot.file)).toString('base64')}`
  return { kit, board, theme, shot }
}

describe('the fact scene says where the quote is from', () => {
  it('puts the caption under the quote, and the host above it, in the html', async () => {
    const { kit, board, theme, shot } = await filmWith((t) => t.startsWith('When a shopper'))
    const html = compose({ board, kit, theme, format: 'square', screenshotDataUrl: shot })
    const scene = html.slice(
      html.indexOf('class="scene insight"'),
      html.indexOf('class="scene pitch"'),
    )
    expect(scene).toContain('<p class="source in"')
    expect(scene).toContain('From their changelog, Oct 2026')
    // the caption comes after the quote, before the why line
    expect(scene.indexOf('From their changelog')).toBeGreaterThan(
      scene.indexOf('class="display quote"'),
    )
    expect(scene.indexOf('From their changelog')).toBeLessThan(scene.indexOf('class="why'))
    expect(scene).toContain(`>${kit.host}</p>`)
  })

  it.each(FORMATS)(
    'fits square, wide and tall with AA contrast on their colors: %s',
    async (format) => {
      // the longest caption there is, on the longest quote the fixtures have
      const { kit, board, theme, shot } = await filmWith((t) =>
        t.startsWith('Our team walks through'),
      )
      const c = await openComposition(
        compose({ board, kit, theme, format, screenshotDataUrl: shot }),
        format,
      )
      try {
        expect(c.report.issues).toEqual([])
        const start = board.scenes.slice(0, 2).reduce((a, s) => a + s.dur, 0)
        await seek(c.page, start + 3)
        const got = await c.page.evaluate(() => {
          const el = document.querySelector('.scene.insight .source') as HTMLElement
          const scene = el.closest('.scene') as HTMLElement
          const r = el.getBoundingClientRect()
          const s = scene.getBoundingClientRect()
          return {
            text: el.textContent,
            color: getComputedStyle(el).color,
            bg: getComputedStyle(scene).backgroundColor,
            inside: r.left >= s.left && r.right <= s.right && r.bottom <= s.bottom && r.width > 0,
            wraps: el.scrollWidth > el.clientWidth + 1,
          }
        })
        expect(got.text).toBe('From their podcast, episode notes, Sep 2026')
        expect(got.inside).toBe(true)
        expect(got.wraps).toBe(false)
        expect(contrast(parseColor(got.color)!, parseColor(got.bg)!)).toBeGreaterThanOrEqual(4.5)
      } finally {
        await c.close()
      }
    },
  )

  it('says "From their homepage" when the film quotes the homepage', async () => {
    const { kit, board, theme, shot } = await filmWith((t) => t.startsWith('61%'))
    const html = compose({ board, kit, theme, format: 'square', screenshotDataUrl: shot })
    expect(html).toContain('>From their homepage</p>')
  })
})

/**
 * The proof card: the number, what changed, then what they did in a smaller line, and where.
 * The longest card the schema allows still fits square, wide and tall; a card without "did"
 * is the card it always was.
 */
describe('the proof card says what they did', () => {
  // the limits: value 12, label 60, did 90, where 40 characters
  const LONG = [
    {
      value: '3.1% → 4.6%',
      label: 'trial sign-up conversion on paid landing pages, 3.1% to 4.6%',
      did: 'Built containerized ETL workflows using Docker and PostgreSQL for three enterprise clients',
      where: 'Enterprise B2B Integration Gateway, Inc',
    },
    {
      value: '6h → 45m',
      label: 'daily client data sync cycles, from 6 hours to 45 minutes',
      did: "Migrated a Tier-1 bank's core operational database from legacy Oracle to a hybrid cloud",
      where: 'Deloitte',
    },
    {
      value: '100,000+',
      label: 'webhook payloads a day at 99.9% uptime',
      did: 'Built a serverless gateway on AWS Lambda',
      where: 'B2B Integration Gateway',
    },
  ]

  async function proofFilm(
    stats: typeof LONG | { value: string; label: string; where?: string }[],
  ) {
    const { kit: home, dir } = await kitFor('parcelpine')
    const kit = withHomework(home, HOMEWORK)
    const p = { ...profile('candidate'), proof: stats }
    const script = { ...deterministicScript(kit, p), proof: [0, 1, 2] }
    const board = buildStoryboard(kit, p, script)
    const theme = await buildTheme(kit, p, { allowPrivateNetworks: true })
    const shot = `data:image/jpeg;base64,${readFileSync(join(dir, kit.screenshot.file)).toString('base64')}`
    return { kit, board, theme, shot }
  }

  it.each(FORMATS)('fits the longest cards with AA contrast: %s', async (format) => {
    const { kit, board, theme, shot } = await proofFilm(LONG)
    const c = await openComposition(
      compose({ board, kit, theme, format, screenshotDataUrl: shot }),
      format,
    )
    try {
      expect(c.report.issues).toEqual([])
      const i = board.scenes.findIndex((s) => s.kind === 'proof')
      const start = board.scenes.slice(0, i).reduce((a, s) => a + s.dur, 0)
      await seek(c.page, start + 3.5)
      const cards = await c.page.evaluate(() =>
        [...document.querySelectorAll('.scene.proof .stat')].map((stat) => {
          const scene = stat.closest('.scene') as HTMLElement
          const s = scene.getBoundingClientRect()
          const part = (cls: string) => stat.querySelector(`.${cls}`) as HTMLElement
          const box = (el: HTMLElement) => el.getBoundingClientRect()
          const did = part('did')
          return {
            order: [...stat.children].map((x) => x.className.replace(/\s.*$/, '')),
            did: did.textContent,
            inside: ['value', 'label', 'did', 'where'].every((k) => {
              const r = box(part(k))
              return (
                r.left >= s.left && r.right <= s.right + 1 && r.bottom <= s.bottom && r.width > 0
              )
            }),
            smaller:
              parseFloat(getComputedStyle(did).fontSize) <
              parseFloat(getComputedStyle(part('label')).fontSize),
            color: getComputedStyle(did).color,
            bg: getComputedStyle(scene).backgroundColor,
          }
        }),
      )
      expect(cards).toHaveLength(3)
      for (const [j, card] of cards.entries()) {
        expect(card.order).toEqual(['display', 'label', 'did', 'where'])
        expect(card.did).toBe(LONG[j]!.did)
        expect(card.inside).toBe(true)
        expect(card.smaller).toBe(true)
        expect(contrast(parseColor(card.color)!, parseColor(card.bg)!)).toBeGreaterThanOrEqual(4.5)
      }
    } finally {
      await c.close()
    }
  })

  it('shows a card without "did" exactly as before: the number, the label, where', async () => {
    const old = LONG.map(({ did: _, ...rest }) => rest)
    const { kit, board, theme, shot } = await proofFilm(old)
    const html = compose({ board, kit, theme, format: 'square', screenshotDataUrl: shot })
    const scene = html.slice(html.indexOf('class="scene proof"'), html.indexOf('class="scene cta"'))
    expect(scene).not.toContain('class="did"')
    expect(scene.match(/class="(display value|label|where)"/g)).toHaveLength(9)
  })
})

describe('the end card says who built the tool that made it', () => {
  // the longest name the profile allows (40 characters)
  const CREATOR = {
    name: 'coldopen, the open-source outreach films',
    url: 'https://tiwaker9404.github.io/coldopen/',
    line: 'Paste a company website, get a 30-second film made for them',
  }

  async function endCard(creator?: typeof CREATOR, preset: 'candidate' | 'sales' = 'candidate') {
    const { kit: home, dir } = await kitFor('parcelpine')
    const kit = withHomework(home, HOMEWORK)
    const p = { ...profile(preset), ...(creator ? { creator } : {}) }
    const board = buildStoryboard(kit, p, deterministicScript(kit, p))
    const theme = await buildTheme(kit, p, { allowPrivateNetworks: true })
    const shot = `data:image/jpeg;base64,${readFileSync(join(dir, kit.screenshot.file)).toString('base64')}`
    return { kit, board, theme, shot }
  }

  it('leaves it out when the profile has no creator, and for sellers', async () => {
    for (const film of [await endCard(), await endCard(CREATOR, 'sales')]) {
      const end = film.board.scenes.find((s) => s.kind === 'cta')!
      expect(end.kind === 'cta' && end.made).toBeUndefined()
      const html = compose({ ...film, format: 'square', screenshotDataUrl: film.shot })
      expect(html).not.toContain('class="made-with')
    }
  })

  it.each(FORMATS)(
    'the end card shows the creator line when set and it fits: %s',
    async (format) => {
      const { kit, board, theme, shot } = await endCard(CREATOR)
      const html = compose({ board, kit, theme, format, screenshotDataUrl: shot })
      const end = html.slice(html.indexOf('cta-wrap'))
      // under the ask and the contact
      expect(end.indexOf('class="made-with')).toBeGreaterThan(end.indexOf('class="contact'))
      const c = await openComposition(html, format)
      try {
        expect(c.report.issues).toEqual([])
        const start = board.scenes.slice(0, -1).reduce((a, s) => a + s.dur, 0)
        await seek(c.page, start + 3)
        const got = await c.page.evaluate(() => {
          const el = document.querySelector('.scene.cta .made-with') as HTMLElement
          const scene = el.closest('.scene') as HTMLElement
          const r = el.getBoundingClientRect()
          const s = scene.getBoundingClientRect()
          const line = (document.querySelector('.scene.cta .cta-line') as HTMLElement) ?? el
          return {
            text: el.textContent,
            color: getComputedStyle(el).color,
            bg: getComputedStyle(scene).backgroundColor,
            inside:
              r.left >= s.left && r.right <= s.right + 1 && r.bottom <= s.bottom && r.width > 0,
            wraps: el.scrollWidth > el.clientWidth + 1,
            smaller:
              parseFloat(getComputedStyle(el).fontSize) <
              parseFloat(getComputedStyle(line).fontSize),
          }
        })
        expect(got.text).toBe(`Made with ${CREATOR.name}, which I built`)
        expect(got.inside).toBe(true)
        expect(got.wraps).toBe(false)
        expect(got.smaller).toBe(true)
        expect(contrast(parseColor(got.color)!, parseColor(got.bg)!)).toBeGreaterThanOrEqual(4.5)
      } finally {
        await c.close()
      }
    },
  )
})
