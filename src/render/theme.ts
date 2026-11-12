import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import {
  contrast,
  luminance,
  oklch,
  parseColor,
  type Rgb,
  readableOn,
  shade,
  toHex,
} from '../brand/color.ts'
import { assertPublicUrl } from '../brand/guard.ts'
import type { BrandKit, FontRef } from '../brand/types.ts'
import type { Profile } from '../script/types.ts'

export interface Field {
  bg: string
  fg: string
  /** a second color that is still legible on bg (rules, highlights, numbers) */
  accent: string
  /** fg at low emphasis, for tracks and secondary lines */
  muted: string
}

export interface FilmTheme {
  dark: Field
  light: Field
  brand: Field
  sender: Field
  display: { family: string; weight: number; category: FontRef['category'] }
  body: { family: string; weight: number }
  /** @font-face rules with fonts embedded as data URLs, so rendering never depends on CORS */
  fontCss: string
  fontsEmbedded: { display: boolean; body: boolean }
  /** the free font used in place of a brand font that couldn't be embedded, by role */
  fallbacks: { display?: string; body?: string }
  /** each field's text and accent contrast against its background, for the film's review */
  contrast: { field: string; part: 'text' | 'accent'; ratio: number; min: number }[]
}

const rgb = (hex: string): Rgb => parseColor(hex) ?? { r: 0, g: 0, b: 0 }
const WHITE = '#ffffff'
const INK = '#111317'

/** Darken/lighten a brand color step by step until it reaches `min` contrast on bg. */
function legibleShade(hex: string, bg: Rgb, min: number): string | null {
  const c = rgb(hex)
  const dir = luminance(bg) > 0.4 ? -1 : 1
  for (let k = 0; k <= 0.9; k += 0.05) {
    // check the rounded hex we will actually paint, not the float color
    const hex = toHex(shade(c, dir * k))
    if (contrast(rgb(hex), bg) >= min) return hex
  }
  return null
}

function field(bgHex: string, fgCandidates: string[], accentCandidates: string[]): Field {
  const bg = rgb(bgHex)
  const fg = readableOn(bg, fgCandidates.map(rgb), 4.5)
  const fgHex = toHex(fg)
  // slate and zinc greys carry a faint tint; they still read as grey, not as a brand accent
  const neutral = (c: string) => oklch(rgb(c)).c < 0.045
  // prefer a colorful brand accent as-is, then the same hue shaded until legible, then fg
  const accent =
    accentCandidates.find(
      (c) => !neutral(c) && contrast(rgb(c), bg) >= 3 && c.toLowerCase() !== fgHex.toLowerCase(),
    ) ??
    accentCandidates
      .filter((c) => !neutral(c))
      .map((c) => legibleShade(c, bg, 3))
      .find((c): c is string => c !== null && c.toLowerCase() !== fgHex.toLowerCase()) ??
    fgHex
  return {
    bg: toHex(bg),
    fg: fgHex,
    accent,
    muted: `color-mix(in srgb, ${fgHex} 55%, ${toHex(bg)})`,
  }
}

/**
 * Turn an extracted palette into three film "fields" (dark, light, brand) that are always
 * accessible: every foreground meets WCAG 4.5:1 on its background, accents 3:1. The brand's
 * own colors are tried first; neutral ink/white only when the brand can't pass.
 */
export function deriveFields(
  kit: BrandKit,
  profile: Profile,
): Pick<FilmTheme, 'dark' | 'light' | 'brand' | 'sender'> {
  const c = kit.colors
  const primary = rgb(c.primary)

  let darkBg = c.dark
  if (luminance(rgb(darkBg)) > 0.08) darkBg = toHex(shade(primary, -0.78))
  let lightBg = c.background
  if (luminance(rgb(lightBg)) < 0.55) lightBg = toHex(shade(primary, 0.93))

  const palette = [
    c.primary,
    c.accent,
    c.text,
    c.dark,
    c.background,
    ...c.swatches.map((s) => s.hex),
  ]
  const dark = field(darkBg, [c.background, lightBg, WHITE], palette)
  const light = field(lightBg, [c.text, c.dark, INK], palette)
  // a monochrome brand (Vercel, Cal.com) has no signature hue; a mid grey reads as dull, so the
  // brand scenes take whichever of the brand's own black or white contrasts with the page
  const tone = oklch(primary)
  const grey = tone.c < 0.03 && luminance(primary) > 0.05 && luminance(primary) < 0.7
  const brandBg = grey ? (luminance(rgb(c.background)) > 0.5 ? darkBg : lightBg) : c.primary
  const brand = field(
    brandBg,
    [c.dark, c.text, c.background, WHITE, INK],
    [c.dark, c.background, c.accent, WHITE, INK],
  )
  const senderBg = profile.color ?? darkBg
  const sender = field(senderBg, [lightBg, WHITE, INK], [c.primary, ...palette])
  return { dark, light, brand, sender }
}

const require = createRequire(import.meta.url)

async function bundled(pkg: string, file: string): Promise<string> {
  const dir = require
    .resolve(`@fontsource-variable/${pkg}/package.json`)
    .replace(/package\.json$/, '')
  const data = await readFile(`${dir}files/${file}`)
  return `data:font/woff2;base64,${data.toString('base64')}`
}

const FALLBACK = {
  serif: { family: 'Fraunces Fallback', pkg: 'fraunces', file: 'fraunces-latin-wght-normal.woff2' },
  sans: {
    family: 'Instrument Sans Fallback',
    pkg: 'instrument-sans',
    file: 'instrument-sans-latin-wght-normal.woff2',
  },
}

/**
 * The free font a brand font is swapped for when the film can't embed it: the closest of the
 * same class (FALLBACK_FONTS in brand/extract.ts names them). Apple's system font becomes Inter.
 */
const STAND_IN: Record<FontRef['category'], { family: string; pkg: string; file: string }> = {
  sans: { family: 'Inter', pkg: 'inter', file: 'inter-latin-wght-normal.woff2' },
  serif: { family: 'Fraunces', pkg: 'fraunces', file: 'fraunces-latin-wght-normal.woff2' },
  mono: {
    family: 'JetBrains Mono',
    pkg: 'jetbrains-mono',
    file: 'jetbrains-mono-latin-wght-normal.woff2',
  },
}

/** a font already inlined by the site, and only that: nothing that could close the CSS rule */
export const DATA_FONT = /^data:[a-z]+\/[a-z0-9.+-]+(;charset=[a-z0-9-]+)?;base64,[A-Za-z0-9+/=]+$/i

async function fetchFace(
  src: string,
  timeoutMs: number,
  allowPrivate = false,
): Promise<string | null> {
  const url = src.match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1] ?? src
  if (url.startsWith('data:')) return DATA_FONT.test(url) ? url : null
  try {
    // the font URL comes from the company's own CSS: the same SSRF guard as the research
    // browser, and no redirects (a public URL could redirect to a private one)
    if (!allowPrivate) await assertPublicUrl(url)
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: allowPrivate ? 'follow' : 'error',
    })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > 2_000_000) return null
    const type = url.includes('.woff2')
      ? 'font/woff2'
      : url.includes('.woff')
        ? 'font/woff'
        : 'font/ttf'
    return `data:${type};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

async function embedFont(
  ref: FontRef,
  alias: string,
  timeoutMs: number,
  allowPrivate = false,
): Promise<{ css: string; ok: boolean }> {
  const rules: string[] = []
  for (const face of ref.faces) {
    const data = await fetchFace(face.src, timeoutMs, allowPrivate)
    if (!data) continue
    // weight and style come from the site's CSS: only values a font face can have, so nothing
    // can close the rule and reach the page that renders the film
    const weight = /^\d{1,3}( \d{1,3})?$|^(normal|bold)$/.test(face.weight) ? face.weight : '400'
    const style = /^(normal|italic|oblique( -?\d{1,2}deg){0,2})$/.test(face.style)
      ? face.style
      : 'normal'
    rules.push(
      `@font-face{font-family:'${alias}';src:url(${data});font-weight:${weight};font-style:${style};font-display:block;}`,
    )
  }
  return { css: rules.join('\n'), ok: rules.length > 0 }
}

export async function buildTheme(
  kit: BrandKit,
  profile: Profile,
  opts: { fontTimeoutMs?: number; allowPrivateNetworks?: boolean } = {},
): Promise<FilmTheme> {
  const priv = opts.allowPrivateNetworks ?? false
  const timeout = opts.fontTimeoutMs ?? 8000
  const fields = deriveFields(kit, profile)
  const displayFallback = FALLBACK[kit.fonts.display.category === 'serif' ? 'serif' : 'sans']
  const sameFamily = kit.fonts.body.family === kit.fonts.display.family
  const [display, body, fbDisplay, fbSans] = await Promise.all([
    embedFont(kit.fonts.display, 'Brand Display', timeout, priv),
    sameFamily
      ? Promise.resolve({ css: '', ok: false, same: true })
      : embedFont(kit.fonts.body, 'Brand Body', timeout, priv),
    bundled(displayFallback.pkg, displayFallback.file),
    bundled(FALLBACK.sans.pkg, FALLBACK.sans.file),
  ])
  const bodyOk = sameFamily ? display.ok : body.ok
  // a brand font the film can't embed is swapped for the closest free one of its class
  const standIn = (ref: FontRef) => STAND_IN[ref.category]
  const swaps = [
    ...(display.ok ? [] : [{ alias: 'Brand Display', font: standIn(kit.fonts.display) }]),
    ...(bodyOk || sameFamily ? [] : [{ alias: 'Brand Body', font: standIn(kit.fonts.body) }]),
  ]
  const swapCss = await Promise.all(
    swaps.map(
      async (w) =>
        `@font-face{font-family:'${w.alias}';src:url(${await bundled(w.font.pkg, w.font.file)});font-weight:100 900;font-display:block;}`,
    ),
  )
  const fontCss = [
    display.css,
    body.css,
    ...swapCss,
    `@font-face{font-family:'${displayFallback.family}';src:url(${fbDisplay});font-weight:100 900;font-display:block;}`,
    `@font-face{font-family:'${FALLBACK.sans.family}';src:url(${fbSans});font-weight:100 900;font-display:block;}`,
  ].join('\n')

  // the stand-in takes the brand font's alias, so the stacks stay the same either way
  const displayStack = `'Brand Display', '${displayFallback.family}', ${kit.fonts.display.category === 'serif' ? 'serif' : 'sans-serif'}`
  const bodyStack = `${sameFamily ? "'Brand Display', " : "'Brand Body', "}'${FALLBACK.sans.family}', sans-serif`
  const fallbacks = {
    ...(display.ok ? {} : { display: standIn(kit.fonts.display).family }),
    ...(bodyOk ? {} : { body: standIn(sameFamily ? kit.fonts.display : kit.fonts.body).family }),
  }
  return {
    ...fields,
    display: {
      family: displayStack,
      weight: Math.min(800, Math.max(500, Math.round(kit.fonts.display.weight / 50) * 50)),
      category: kit.fonts.display.category,
    },
    body: { family: bodyStack, weight: 450 },
    fontCss,
    fallbacks,
    contrast: contrastOf(fields),
    fontsEmbedded: { display: display.ok, body: bodyOk },
  }
}

/**
 * Each field's text and accent contrast on its background. The fields are solved to pass
 * (text 4.5:1, accents 3:1), so a shortfall here means no brand color could: the review says so.
 */
export function contrastOf(
  fields: Pick<FilmTheme, 'dark' | 'light' | 'brand'>,
): FilmTheme['contrast'] {
  return (['dark', 'light', 'brand'] as const).flatMap((name) => {
    const f = fields[name]
    const bg = rgb(f.bg)
    const r = (hex: string) => Math.round(contrast(rgb(hex), bg) * 100) / 100
    return [
      { field: name, part: 'text' as const, ratio: r(f.fg), min: 4.5 },
      { field: name, part: 'accent' as const, ratio: r(f.accent), min: 3 },
    ]
  })
}
