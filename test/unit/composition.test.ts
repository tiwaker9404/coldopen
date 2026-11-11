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
