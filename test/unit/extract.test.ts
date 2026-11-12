import { afterAll, describe, expect, it } from 'vitest'
import { contrast, parseColor } from '../../src/brand/color.ts'
import { FALLBACK_FONTS, fallbackFont, navigate, READ_TIMEOUT_MS } from '../../src/brand/extract.ts'
import type { BrandKit } from '../../src/brand/types.ts'
import { closeBrowser } from '../../src/browser.ts'
import { compose, type Format } from '../../src/render/composition.ts'
import { openComposition } from '../../src/render/render.ts'
import { buildTheme } from '../../src/render/theme.ts'
import { buildStoryboard } from '../../src/script/storyboard.ts'
import { deterministicScript } from '../../src/script/writer.ts'
import { fixtureServer, kitFor, profile } from '../helpers/index.ts'

/**
 * What the extract eval missed on real sites, fixed: no logo (resend.com, framer.com,
 * bbc.co.uk) gets their name as a wordmark, a font the film can't embed (Apple's) gets the
 * closest free one, and a slow site (retellai.com) gets 90 seconds and one more try.
 */

afterAll(async () => {
  await closeBrowser()
  ;(await fixtureServer()).close()
})

const FORMATS: Format[] = ['square', 'landscape', 'portrait']

describe('a site with no logo', () => {
  async function film(kit: BrandKit, format: Format, wordmark = false) {
    const p = profile('candidate')
    const board = buildStoryboard(kit, p, deterministicScript(kit, p))
    const theme = await buildTheme(kit, p, { allowPrivateNetworks: true })
    return {
      html: compose({ board, kit, theme, format, screenshotDataUrl: null, wordmark }),
      theme,
    }
  }

  it('shows their name in their font and color, sized like a logo, in every format', async () => {
    const { kit: home } = await kitFor('parcelpine')
    const kit = { ...home, logo: null }
    for (const format of FORMATS) {
      const { html, theme } = await film(kit, format)
      // the hook and the ask both carry the chip, and neither is empty
      expect(html.match(/class="chip in named"/g), format).toHaveLength(2)
      expect(html).toContain(`<span class="wordmark display"`)
      expect(html).toContain(`>${kit.name}</span>`)
      const c = await openComposition(html, format)
      try {
        expect(c.report.issues, format).toEqual([])
        const box = await c.page.evaluate(() => {
          const el = document.querySelector('.hook .chip .wordmark') as HTMLElement
          const r = el.getBoundingClientRect()
          return { w: r.width, h: r.height, color: getComputedStyle(el).color }
        })
        // as tall as a header logo, never a blank chip
        expect(box.w, format).toBeGreaterThan(40)
        expect(box.h, format).toBeGreaterThan(18)
        // their accent on the chip's light background: large text, AA at 3:1
        const [r, g, b] = box.color.match(/\d+/g)!.map(Number)
        expect(
          contrast({ r: r!, g: g!, b: b! }, parseColor(theme.light.bg)!),
        ).toBeGreaterThanOrEqual(3)
      } finally {
        await c.close()
      }
    }
  })

  it('keeps their logo when there is one, unless the sender chose their name instead', async () => {
    const { kit } = await kitFor('parcelpine')
    if (!kit.logo) return
    expect((await film(kit, 'square')).html).not.toContain('class="chip in named"')
    expect((await film(kit, 'square', true)).html).toContain('class="chip in named"')
  })
})

describe('a font the film cannot embed', () => {
  it('records the closest free font of the same class in the brand kit', () => {
    expect(fallbackFont('-apple-system', 'sans', 0)).toBe('Inter')
    expect(fallbackFont('SF Pro Display', 'sans', 3)).toBe('Inter')
    expect(fallbackFont('Tiempos Headline', 'serif', 0)).toBe(FALLBACK_FONTS.serif)
    expect(fallbackFont('Berkeley Mono', 'mono', 0)).toBe(FALLBACK_FONTS.mono)
    // their own files are there: the film embeds them
    expect(fallbackFont('Söhne', 'sans', 2)).toBeNull()
  })

  it('swaps it for that font in the film, and says so', async () => {
    const { kit: home } = await kitFor('parcelpine')
    const gone = { src: 'url(http://127.0.0.1:9/missing.woff2)', weight: '600', style: 'normal' }
    const kit: BrandKit = {
      ...home,
      fonts: {
        display: { family: 'SF Pro Display', category: 'sans', weight: 600, faces: [gone] },
        body: { family: 'SF Pro Display', category: 'sans', weight: 400, faces: [gone] },
      },
    }
    const theme = await buildTheme(kit, profile('candidate'), {
      allowPrivateNetworks: true,
      fontTimeoutMs: 2000,
    })
    expect(theme.fontsEmbedded.display).toBe(false)
    expect(theme.fallbacks).toEqual({ display: 'Inter', body: 'Inter' })
    // Inter takes the brand font's place, so the film never falls to a browser default
    expect(theme.fontCss).toMatch(/font-family:'Brand Display';src:url\(data:font\/woff2;base64,/)
    expect(theme.display.family.startsWith("'Brand Display'")).toBe(true)
  })

  it('reports nothing swapped when the brand font embeds', async () => {
    const { kit } = await kitFor('parcelpine')
    const theme = await buildTheme(kit, profile('candidate'), { allowPrivateNetworks: true })
    if (theme.fontsEmbedded.display) expect(theme.fallbacks.display).toBeUndefined()
    for (const c of theme.contrast) expect(c.ratio).toBeGreaterThanOrEqual(c.min)
  })
})

describe('a slow site', () => {
  const timeout = () => new Error('Navigation timeout of 90000 ms exceeded')

  it('waits 90 seconds, then tries once more before giving up', async () => {
    expect(READ_TIMEOUT_MS).toBe(90_000)
    let tries = 0
    const page = {
      goto: async () => {
        tries++
        if (tries === 1) throw timeout()
        return { status: () => 200 }
      },
      evaluate: async () => 'loading',
    }
    await expect(navigate(page as never, 'https://slow.example', 90_000)).resolves.toEqual({
      status: 200,
    })
    expect(tries).toBe(2)
  })

  it('says how long it waited when the second try times out too', async () => {
    let tries = 0
    const page = {
      goto: async () => {
        tries++
        throw timeout()
      },
      evaluate: async () => 'loading',
    }
    await expect(navigate(page as never, 'https://slow.example', 90_000)).rejects.toThrow(
      'https://slow.example did not load within 90s',
    )
    expect(tries).toBe(2)
  })

  it('keeps a page that loaded but never went quiet, without a second try', async () => {
    let tries = 0
    const page = {
      goto: async () => {
        tries++
        throw timeout()
      },
      evaluate: async () => 'interactive',
    }
    await expect(navigate(page as never, 'https://chatty.example', 90_000)).resolves.toEqual({
      status: 200,
    })
    expect(tries).toBe(1)
  })
})
