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
  const neutral = (c: string) => oklch(rgb(c)).c < 0.03
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
  const brand = field(
    c.primary,
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

async function fetchFace(src: string, timeoutMs: number): Promise<string | null> {
  const url = src.match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1] ?? src
  if (url.startsWith('data:')) return url
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
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
): Promise<{ css: string; ok: boolean }> {
  const rules: string[] = []
  for (const face of ref.faces) {
    const data = await fetchFace(face.src, timeoutMs)
    if (!data) continue
    rules.push(
      `@font-face{font-family:'${alias}';src:url(${data});font-weight:${face.weight};font-style:${face.style};font-display:block;}`,
    )
  }
  return { css: rules.join('\n'), ok: rules.length > 0 }
}

export async function buildTheme(
  kit: BrandKit,
  profile: Profile,
  opts: { fontTimeoutMs?: number } = {},
): Promise<FilmTheme> {
  const timeout = opts.fontTimeoutMs ?? 8000
  const fields = deriveFields(kit, profile)
  const displayFallback = FALLBACK[kit.fonts.display.category === 'serif' ? 'serif' : 'sans']
  const [display, body, fbDisplay, fbSans] = await Promise.all([
    embedFont(kit.fonts.display, 'Brand Display', timeout),
    kit.fonts.body.family === kit.fonts.display.family
      ? Promise.resolve({ css: '', ok: false, same: true })
      : embedFont(kit.fonts.body, 'Brand Body', timeout),
    bundled(displayFallback.pkg, displayFallback.file),
    bundled(FALLBACK.sans.pkg, FALLBACK.sans.file),
  ])
  const sameFamily = kit.fonts.body.family === kit.fonts.display.family
  const fontCss = [
    display.css,
    body.css,
    `@font-face{font-family:'${displayFallback.family}';src:url(${fbDisplay});font-weight:100 900;font-display:block;}`,
    `@font-face{font-family:'${FALLBACK.sans.family}';src:url(${fbSans});font-weight:100 900;font-display:block;}`,
  ].join('\n')

  const displayStack = `${display.ok ? "'Brand Display', " : ''}'${displayFallback.family}', ${kit.fonts.display.category === 'serif' ? 'serif' : 'sans-serif'}`
  const bodyStack = `${sameFamily && display.ok ? "'Brand Display', " : body.ok ? "'Brand Body', " : ''}'${FALLBACK.sans.family}', sans-serif`
  return {
    ...fields,
    display: {
      family: displayStack,
      weight: Math.min(800, Math.max(500, Math.round(kit.fonts.display.weight / 50) * 50)),
      category: kit.fonts.display.category,
    },
    body: { family: bodyStack, weight: 450 },
    fontCss,
    fontsEmbedded: { display: display.ok, body: sameFamily ? display.ok : body.ok },
  }
}
