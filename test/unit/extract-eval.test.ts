import { describe, expect, it } from 'vitest'
import {
  FIELDS,
  lumaSpread,
  type SiteResult,
  scoreColors,
  scoreExact,
  scoreFonts,
  scoreHeadlineBox,
  scoreHero,
  scoreLogo,
  siteFailed,
  summarize,
} from '../../evals/extract/score.ts'
import type { BrandKit } from '../../src/brand/types.ts'
import { deriveFields } from '../../src/render/theme.ts'
import { profile } from '../helpers/index.ts'

const face = { src: 'url(https://example.com/a.woff2)', weight: '400', style: 'normal' }

function kit(over: Partial<BrandKit> = {}): BrandKit {
  return {
    url: 'https://example.com/',
    host: 'example.com',
    name: 'Example',
    title: 'Example',
    description: '',
    headline: 'Ship faster with Example',
    subheads: [],
    nav: [],
    facts: [],
    colors: {
      background: '#ffffff',
      text: '#1a1a1a',
      primary: '#2f6bff',
      accent: '#ff6b2c',
      dark: '#0b1530',
      swatches: [{ hex: '#2f6bff', weight: 1 }],
    },
    fonts: {
      display: { family: 'Instrument Sans Variable', category: 'sans', weight: 600, faces: [face] },
      body: { family: 'Inter', category: 'sans', weight: 400, faces: [face] },
    },
    logo: { dataUrl: 'data:image/png;base64,AA==', width: 120, height: 32 },
    screenshot: {
      file: 'site.jpg',
      width: 1440,
      height: 900,
      headlineBox: { x: 120, y: 240, w: 800, h: 140 },
    },
    extractedAt: '2026-11-09T00:00:00.000Z',
    ...over,
  }
}

const filmFields = (k: BrandKit) => {
  const f = deriveFields(k, profile('sales'))
  return [f.dark, f.light, f.brand]
}

describe('extract eval: colors', () => {
  it('passes a saturated primary with readable film text', () => {
    const k = kit()
    expect(scoreColors(k, [], filmFields(k))).toMatchObject({ pass: true })
  })

  it('fails a grey primary, unless a dark site uses it as a color that stands out', () => {
    const grey = kit({ colors: { ...kit().colors, primary: '#8a8a8a' } })
    const r = scoreColors(grey, [], filmFields(grey))
    expect(r.pass).toBe(false)
    expect(r.reason).toMatch(/near-grey/)

    // Vercel: white on black is the brand
    const mono = kit({ colors: { ...kit().colors, background: '#000000', primary: '#ffffff' } })
    expect(scoreColors(mono, ['dark'], filmFields(mono)).pass).toBe(true)
    expect(scoreColors(mono, [], filmFields(mono)).pass).toBe(false)
  })

  it('fails when the film would paint text below 4.5:1', () => {
    const r = scoreColors(kit(), [], [{ fg: '#777777', bg: '#888888' }])
    expect(r.pass).toBe(false)
    expect(r.reason).toMatch(/:1/)
  })
})

describe('extract eval: fonts', () => {
  it('passes the site’s own font, embedded', () => {
    expect(scoreFonts(kit(), true)).toMatchObject({
      pass: true,
      reason: 'Instrument Sans Variable',
    })
  })

  it('fails a fallback family, a font with no @font-face, and one that could not be embedded', () => {
    for (const family of ['sans-serif', 'Arial', 'Helvetica', 'system-ui', 'Times', 'serif']) {
      const k = kit({ fonts: { ...kit().fonts, display: { ...kit().fonts.display, family } } })
      expect(scoreFonts(k, true).reason, family).toMatch(/fallback/)
    }
    const noFaces = kit({
      fonts: { ...kit().fonts, display: { ...kit().fonts.display, faces: [] } },
    })
    expect(scoreFonts(noFaces, true)).toMatchObject({ pass: false })
    expect(scoreFonts(kit(), false).reason).toMatch(/couldn't be embedded/)
  })
})

describe('extract eval: logo', () => {
  it('passes a header wordmark', () => {
    expect(scoreLogo(kit().logo).pass).toBe(true)
  })

  it('fails a missing logo and a favicon-sized one, and passes small wordmarks and square marks', () => {
    expect(scoreLogo(null).reason).toBe('no logo captured')
    expect(scoreLogo({ dataUrl: 'x', width: 90, height: 14 }).reason).toMatch(/14 px/)
    expect(scoreLogo({ dataUrl: 'x', width: 16, height: 16 }).reason).toMatch(/favicon/)
    // Figma's 19 px wordmark and GitHub's 32 px Octocat are real logos
    expect(scoreLogo({ dataUrl: 'x', width: 70, height: 19 }).pass).toBe(true)
    expect(scoreLogo({ dataUrl: 'x', width: 32, height: 32 }).pass).toBe(true)
  })
})

describe('extract eval: hero', () => {
  it('passes a screenshot with real content and fails a blank one', () => {
    const busy = Uint8Array.from({ length: 1600 }, (_, i) => (i * 37) % 256)
    expect(scoreHero(busy).pass).toBe(true)
    const blank = new Uint8Array(1600).fill(250)
    expect(lumaSpread(blank)).toBe(0)
    expect(scoreHero(blank).reason).toMatch(/blank/)
    expect(scoreHero(null).reason).toBe('no hero screenshot')
  })
})

describe('extract eval: headline box', () => {
  it('passes a visible headline box with text', () => {
    expect(scoreHeadlineBox(kit()).pass).toBe(true)
  })

  it('fails a null, off-screen or tiny box, and an empty headline', () => {
    const shot = kit().screenshot
    expect(scoreHeadlineBox(kit({ screenshot: { ...shot, headlineBox: null } })).reason).toBe(
      'no headline box',
    )
    const off = { ...shot, headlineBox: { x: 100, y: 820, w: 600, h: 200 } }
    expect(scoreHeadlineBox(kit({ screenshot: off })).reason).toMatch(/off-screen/)
    const tiny = { ...shot, headlineBox: { x: 100, y: 100, w: 100, h: 20 } }
    expect(scoreHeadlineBox(kit({ screenshot: tiny })).reason).toMatch(/% of the screen/)
    expect(scoreHeadlineBox(kit({ headline: '  ' })).reason).toMatch(/empty/)
  })
})

describe('extract eval: exact match', () => {
  it('matches a hand-checked color within OKLab 0.03 and the same family', () => {
    expect(
      scoreExact(kit(), { primary: '#3070ff', display: 'instrument sans variable' }).pass,
    ).toBe(true)
    const r = scoreExact(kit(), { primary: '#ff0000', display: 'Inter' })
    expect(r.pass).toBe(false)
    expect(r.reason).toMatch(/expected #ff0000.*expected Inter/)
  })
})

describe('extract eval: summary', () => {
  const pass = { pass: true, reason: '' }
  const fail = { pass: false, reason: 'x' }
  const site = (url: string, tags: string[], failing: string[] = []): SiteResult => ({
    url,
    tags,
    seconds: 1,
    fields: Object.fromEntries(
      FIELDS.map((f) => [f, failing.includes(f) ? fail : pass]),
    ) as SiteResult['fields'],
  })

  it('turns a site that threw into a fail on every field, with the first line of the error', () => {
    const r = siteFailed('https://x.com', ['big'], new Error('x.com blocked the request\nstack'), 3)
    for (const f of FIELDS) {
      expect(r.fields[f].pass).toBe(false)
      expect(r.fields[f].reason).toBe("couldn't read the site: x.com blocked the request")
    }
  })

  it('counts pass rates per field and per tag', () => {
    const s = summarize([
      site('https://a.com', ['startup', 'dark'], ['logo']),
      site('https://b.com', ['startup']),
      siteFailed('https://c.com', ['big'], new Error('timeout'), 60),
    ])
    expect(s.sites).toBe(3)
    expect(s.fields.colors).toEqual({ pass: 2, n: 3 })
    expect(s.fields.logo).toEqual({ pass: 1, n: 3 })
    const startup = s.tags.find((t) => t.tag === 'startup')!
    expect(startup.sites).toBe(2)
    expect(startup.fields.logo).toEqual({ pass: 1, n: 2 })
    expect(startup.all).toEqual({ pass: 9, n: 10 })
    expect(s.tags.find((t) => t.tag === 'big')!.all).toEqual({ pass: 0, n: 5 })
    expect(s.tags.map((t) => t.tag)).toEqual(['big', 'dark', 'startup'])
    expect(s.exact).toBeNull()
  })
})
