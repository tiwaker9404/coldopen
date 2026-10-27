import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { contrast, parseColor } from '../../src/brand/color.ts'
import { closeBrowser } from '../../src/browser.ts'
import { compose, type Format } from '../../src/render/composition.ts'
import {
  concatSegments,
  frameRange,
  openComposition,
  renderSegment,
} from '../../src/render/render.ts'
import { buildTheme } from '../../src/render/theme.ts'
import { buildStoryboard } from '../../src/script/storyboard.ts'
import { deterministicScript } from '../../src/script/writer.ts'
import { fixtureServer, kitFor, profile, SITES, tmp } from '../helpers/index.ts'

afterAll(async () => {
  await closeBrowser()
  ;(await fixtureServer()).close()
})

const EXPECTED = {
  northwind: {
    name: 'Northwind Freight',
    host: 'northwindfreight.example',
    primary: '#c6f432',
    display: 'Fraunces Variable',
    category: 'serif',
  },
  lumen: {
    name: 'Lumen Health',
    host: 'lumenhealth.example',
    primary: '#2f6bff',
    display: 'Instrument Sans Variable',
    category: 'sans',
  },
  parcelpine: {
    name: 'Parcelpine',
    host: 'parcelpine.example',
    primary: '#ff6b2c',
    display: 'Bricolage Grotesque Variable',
    category: 'sans',
  },
} as const

describe.each(SITES)('brand extraction: %s', (site) => {
  it('reads name, colors, fonts, logo, screenshot and citable facts', async () => {
    const { kit, dir } = await kitFor(site)
    const want = EXPECTED[site]
    expect(kit.name).toBe(want.name)
    expect(kit.host).toBe(want.host)
    expect(kit.colors.primary).toBe(want.primary)
    expect(kit.fonts.display.family).toBe(want.display)
    expect(kit.fonts.display.category).toBe(want.category)
    expect(kit.fonts.display.faces.length).toBeGreaterThan(0)
    expect(kit.logo?.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(kit.screenshot.headlineBox).not.toBeNull()
    expect(existsSync(join(dir, kit.screenshot.file))).toBe(true)
    // stat tiles come out as separate, citable facts
    const stats = kit.facts.filter((f) => f.kind === 'stat')
    expect(stats.length).toBeGreaterThanOrEqual(3)
    for (const s of stats.slice(0, 3)) expect(s.text.length).toBeLessThan(80)
    expect(new Set(kit.facts.map((f) => f.text)).size).toBe(kit.facts.length)
    // text color is readable on the background the site actually uses
    expect(
      contrast(parseColor(kit.colors.text)!, parseColor(kit.colors.background)!),
    ).toBeGreaterThanOrEqual(4.5)
  })
})

describe('composition QA', () => {
  const formats: Format[] = ['square', 'landscape', 'portrait']
  for (const site of SITES) {
    for (const preset of ['sales', 'candidate'] as const) {
      it(`${site} / ${preset}: fonts embedded, nothing overflows in any format`, async () => {
        const { kit, dir } = await kitFor(site)
        const p = profile(preset)
        const board = buildStoryboard(kit, p, deterministicScript(kit, p))
        const theme = await buildTheme(kit, p)
        expect(theme.fontsEmbedded.display).toBe(true)
        const shot = `data:image/jpeg;base64,${readFileSync(join(dir, kit.screenshot.file)).toString('base64')}`
        for (const format of formats) {
          const c = await openComposition(
            compose({ board, kit, theme, format, screenshotDataUrl: shot }),
            format,
          )
          try {
            expect(c.report.issues, `${format}: ${JSON.stringify(c.report.issues)}`).toEqual([])
            expect(c.report.fonts).toContain('Brand Display')
          } finally {
            await c.close()
          }
        }
      })
    }
  }
})

describe('rendering', () => {
  it('renders scene segments and joins them losslessly into one H.264 film', async () => {
    const { kit, dir } = await kitFor('lumen')
    const p = profile('sales')
    const board = buildStoryboard(kit, p, deterministicScript(kit, p))
    const theme = await buildTheme(kit, p)
    const shot = `data:image/jpeg;base64,${readFileSync(join(dir, kit.screenshot.file)).toString('base64')}`
    const c = await openComposition(
      compose({ board, kit, theme, format: 'square', screenshotDataUrl: shot }),
      'square',
    )
    const out = tmp('render-')
    try {
      // first 1.5 s of two scenes, to keep the test quick
      const a = join(out, 'a.mp4')
      const b = join(out, 'b.mp4')
      const [f0] = frameRange(0, 1)
      const [g0] = frameRange(board.scenes[0]!.dur, board.scenes[0]!.dur + 0.5)
      await renderSegment(c.page, { f0: f0, f1: f0 + 30, file: a })
      await renderSegment(c.page, { f0: g0, f1: g0 + 15, file: b })
      const film = join(out, 'film.mp4')
      await concatSegments([a, b], film)
      const probe = execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-count_frames',
          '-select_streams',
          'v:0',
          '-show_entries',
          'stream=codec_name,width,height,nb_read_frames,pix_fmt',
          '-of',
          'json',
          film,
        ],
        { encoding: 'utf8' },
      )
      const s = JSON.parse(probe).streams[0]
      expect(s).toMatchObject({ codec_name: 'h264', width: 1080, height: 1080, pix_fmt: 'yuv420p' })
      expect(Number(s.nb_read_frames)).toBe(45)
    } finally {
      await c.close()
    }
  })
})
