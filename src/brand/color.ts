/**
 * Color math for brand extraction and accessible film design.
 * OKLCH for perceptual "how colorful is this", WCAG 2.x for contrast.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

export function parseColor(input: string): (Rgb & { a: number }) | null {
  const s = input.trim().toLowerCase()
  let m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/)
  if (m) {
    const a =
      m[4] === undefined ? 1 : m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number(m[4])
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a }
  }
  m = s.match(/^#([0-9a-f]{3,8})$/)
  if (m) {
    let h = m[1]!
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
    const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 }
  }
  return null
}

export function toHex({ r, g, b }: Rgb): string {
  const h = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

const lin = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance */
export function luminance(c: Rgb): number {
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** OKLCH (Björn Ottosson's OKLab): L 0..1, C ~0..0.37, h degrees */
export function oklch(c: Rgb): { l: number; c: number; h: number } {
  const r = lin(c.r)
  const g = lin(c.g)
  const b = lin(c.b)
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  const C = Math.sqrt(A * A + B * B)
  let h = (Math.atan2(B, A) * 180) / Math.PI
  if (h < 0) h += 360
  return { l: L, c: C, h }
}

/** Perceptual distance in OKLab, good enough to tell "same brand color" from "different". */
export function distance(a: Rgb, b: Rgb): number {
  const x = oklch(a)
  const y = oklch(b)
  const ax = x.c * Math.cos((x.h * Math.PI) / 180)
  const ay = x.c * Math.sin((x.h * Math.PI) / 180)
  const bx = y.c * Math.cos((y.h * Math.PI) / 180)
  const by = y.c * Math.sin((y.h * Math.PI) / 180)
  return Math.sqrt((x.l - y.l) ** 2 + (ax - bx) ** 2 + (ay - by) ** 2)
}

const WHITE: Rgb = { r: 255, g: 255, b: 255 }
const BLACK: Rgb = { r: 17, g: 17, b: 17 }
const PURE_BLACK: Rgb = { r: 0, g: 0, b: 0 }

/**
 * The most on-brand text color that is still readable on `bg`:
 * try the brand candidates first, fall back to near-black / white.
 */
export function readableOn(bg: Rgb, candidates: Rgb[], min = 4.5): Rgb {
  for (const c of candidates) if (contrast(c, bg) >= min) return c
  if (contrast(WHITE, bg) >= min) return WHITE
  if (contrast(BLACK, bg) >= min) return BLACK
  // on mid-tones only pure black or white can pass; one of the two always reaches 4.58:1
  return contrast(WHITE, bg) >= contrast(PURE_BLACK, bg) ? WHITE : PURE_BLACK
}

/** Mix toward white (t>0) or black (t<0). */
export function shade(c: Rgb, t: number): Rgb {
  const target = t > 0 ? 255 : 0
  const k = Math.abs(t)
  return { r: c.r + (target - c.r) * k, g: c.g + (target - c.g) * k, b: c.b + (target - c.b) * k }
}

export interface WeightedColor {
  hex: string
  weight: number
}

export interface Palette {
  /** page background, usually light */
  background: string
  /** body text */
  text: string
  /** the brand's signature color: most prominent saturated color */
  primary: string
  /** second distinct brand color, or a tint of primary */
  accent: string
  /** darkest prominent brand color (deep backgrounds, ink) */
  dark: string
  swatches: WeightedColor[]
}

/**
 * Turn raw weighted color observations from the page into brand roles.
 * `backgrounds` are weighted by painted area, `texts` by text length, `brand` by
 * interactive prominence (buttons, links, theme-color).
 */
export function derivePalette(input: {
  backgrounds: WeightedColor[]
  texts: WeightedColor[]
  brand: WeightedColor[]
}): Palette {
  const merged = new Map<string, number>()
  const add = (list: WeightedColor[], k: number) => {
    for (const { hex, weight } of list) merged.set(hex, (merged.get(hex) ?? 0) + weight * k)
  }
  add(input.backgrounds, 1)
  add(input.brand, 1)

  const byWeight = (l: WeightedColor[]) => [...l].sort((a, b) => b.weight - a.weight)
  const rgb = (h: string) => parseColor(h)!

  const background = byWeight(input.backgrounds)[0]?.hex ?? '#ffffff'
  const bg = rgb(background)

  const text =
    byWeight(input.texts).find((t) => contrast(rgb(t.hex), bg) >= 4.5)?.hex ??
    toHex(readableOn(bg, []))

  // saturated candidates: brand signals count 3x, painted areas 1x
  const scored = new Map<string, number>()
  for (const { hex, weight } of input.brand) scored.set(hex, (scored.get(hex) ?? 0) + weight * 3)
  for (const { hex, weight } of input.backgrounds) scored.set(hex, (scored.get(hex) ?? 0) + weight)
  const saturated = [...scored.entries()]
    .map(([hex, weight]) => ({ hex, weight, c: oklch(rgb(hex)).c }))
    .filter((x) => x.c >= 0.08 && distance(rgb(x.hex), bg) > 0.08)
    .sort((a, b) => b.weight * (0.5 + b.c) - a.weight * (0.5 + a.c))

  // cluster near-identical shades so "#2f6bff" and "#2e6afe" count once
  const clusters: { hex: string; weight: number }[] = []
  for (const s of saturated) {
    const hit = clusters.find((c) => distance(rgb(c.hex), rgb(s.hex)) < 0.06)
    if (hit) hit.weight += s.weight
    else clusters.push({ hex: s.hex, weight: s.weight })
  }

  const textRgb = rgb(text)
  const primary = clusters[0]?.hex ?? text
  const accent =
    clusters.find((c) => distance(rgb(c.hex), rgb(primary)) > 0.12)?.hex ??
    toHex(shade(rgb(primary), luminance(rgb(primary)) > 0.4 ? -0.35 : 0.55))

  // darkest prominent color with real presence (brand ink), else text color
  const darkCandidates = [...merged.entries()]
    .filter(([hex]) => luminance(rgb(hex)) < 0.06)
    .sort((a, b) => b[1] - a[1])
  const dark = darkCandidates[0]?.[0] ?? (luminance(textRgb) < 0.06 ? text : '#111418')

  const swatches = byWeight([...merged.entries()].map(([hex, weight]) => ({ hex, weight }))).slice(
    0,
    8,
  )
  return { background, text, primary, accent, dark, swatches }
}
