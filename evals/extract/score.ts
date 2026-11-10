/**
 * Scoring for the real-site extraction eval (evals/extract/run.ts).
 *
 * Each check is a pure function over what extractBrand returned (plus a few measurements
 * the runner takes: whether the film could embed the font, the hero's pixels), so the rules
 * are unit-tested without a network. A pass means the field is plausible, not that a person
 * checked it against the site; hand-checked values go in expected.json for an exact match.
 */
import { contrast, distance, oklch, parseColor, type Rgb } from '../../src/brand/color.ts'
import type { BrandKit } from '../../src/brand/types.ts'

export const FIELDS = ['colors', 'fonts', 'logo', 'hero', 'headline'] as const
export type FieldName = (typeof FIELDS)[number]

export interface Check {
  pass: boolean
  /** short and plain: why it failed, or what was found when it passed */
  reason: string
}

export interface SiteResult {
  url: string
  tags: string[]
  seconds: number
  /** set when the site couldn't be read at all; every field then fails */
  error?: string
  fields: Record<FieldName, Check>
  /** only for sites with hand-checked values in expected.json */
  exact?: { pass: boolean; reason: string }
}

export interface Expected {
  primary?: string
  display?: string
}

const rgb = (hex: string): Rgb | null => parseColor(hex)

/** below this OKLab chroma a color reads as grey, so it can't be anyone's signature color */
const GREY_CHROMA = 0.02

/**
 * A primary color was found, it isn't a near-grey default (unless the site is dark and the
 * color stands out from the page), and every text color the film paints meets WCAG AA.
 * `fields` are the film's own fields (deriveFields / buildTheme), so this is the film's
 * rendering, not the site's.
 */
export function scoreColors(
  kit: Pick<BrandKit, 'colors'>,
  tags: string[],
  fields: { fg: string; bg: string }[],
): Check {
  const primary = rgb(kit.colors.primary)
  if (!primary) return { pass: false, reason: 'no primary color found' }
  const chroma = oklch(primary).c
  const bg = rgb(kit.colors.background)
  const standsOut = tags.includes('dark') && !!bg && contrast(primary, bg) >= 4.5
  if (chroma <= GREY_CHROMA && !standsOut)
    return {
      pass: false,
      reason: `primary ${kit.colors.primary} is a near-grey (chroma ${chroma.toFixed(3)})`,
    }
  let worst = Number.POSITIVE_INFINITY
  for (const f of fields) {
    const fg = rgb(f.fg)
    const back = rgb(f.bg)
    if (!fg || !back) return { pass: false, reason: `unreadable film color ${f.fg} on ${f.bg}` }
    worst = Math.min(worst, contrast(fg, back))
  }
  if (worst < 4.5) return { pass: false, reason: `film text only ${worst.toFixed(2)}:1` }
  return { pass: true, reason: `primary ${kit.colors.primary}` }
}

/** what a browser falls back to when the site's own font isn't found */
const GENERIC_FAMILY =
  /^(serif|sans-serif|system-ui|-apple-system|arial|helvetica|times|times new roman|ui-sans-serif|ui-serif|monospace)$/i

/**
 * The film embedded at least one of the site's @font-face files for the headline, and the
 * headline family is the site's own, not a browser default.
 */
export function scoreFonts(kit: Pick<BrandKit, 'fonts'>, embedded: boolean): Check {
  const family = kit.fonts.display.family.trim()
  if (!family || GENERIC_FAMILY.test(family))
    return { pass: false, reason: `display font is a fallback (${family || 'none'})` }
  if (!kit.fonts.display.faces.length)
    return { pass: false, reason: `no @font-face found for ${family}` }
  if (!embedded) return { pass: false, reason: `${family} files couldn't be embedded` }
  return { pass: true, reason: family }
}

/**
 * The smallest short side that still reads as a logo. Header wordmarks run 18–24 px tall
 * (Figma's is 19, Cal.com's 22) and a favicon is 16, so 18 tells them apart. The first run
 * used 24 plus "a square of 32 px or less is the favicon", which failed GitHub's real
 * 32 px Octocat and both of those wordmarks.
 */
const MIN_LOGO = 18

/** A logo image was captured and it is bigger than a favicon on its short side. */
export function scoreLogo(logo: BrandKit['logo']): Check {
  if (!logo) return { pass: false, reason: 'no logo captured' }
  const short = Math.min(logo.width, logo.height)
  if (short < MIN_LOGO)
    return { pass: false, reason: `only ${short} px on its short side, favicon-sized` }
  return { pass: true, reason: `${logo.width}×${logo.height}` }
}

/** standard deviation of 8-bit luminance samples (one byte per pixel, grey) */
export function lumaSpread(pixels: Uint8Array): number {
  if (!pixels.length) return 0
  let sum = 0
  for (const p of pixels) sum += p
  const mean = sum / pixels.length
  let sq = 0
  for (const p of pixels) sq += (p - mean) ** 2
  return Math.sqrt(sq / pixels.length)
}

/** a blank or single-color page has almost no spread; any real hero has well over this */
const BLANK_SPREAD = 4

/** The hero screenshot exists and isn't blank. `pixels` is the screenshot as greyscale bytes. */
export function scoreHero(pixels: Uint8Array | null): Check {
  if (!pixels?.length) return { pass: false, reason: 'no hero screenshot' }
  const spread = lumaSpread(pixels)
  if (spread < BLANK_SPREAD)
    return { pass: false, reason: `screenshot is blank (spread ${spread.toFixed(1)})` }
  return { pass: true, reason: `spread ${spread.toFixed(0)}` }
}

/**
 * The film zooms into the headline, so its box must exist, sit inside the viewport and be
 * big enough to see (at least 1% of the screen), and the headline text must be there.
 */
export function scoreHeadlineBox(kit: Pick<BrandKit, 'headline' | 'screenshot'>): Check {
  const box = kit.screenshot.headlineBox
  const { width, height } = kit.screenshot
  if (!box) return { pass: false, reason: 'no headline box' }
  // sub-pixel layout can put an edge a fraction outside
  const slack = 1
  if (
    box.x < -slack ||
    box.y < -slack ||
    box.x + box.w > width + slack ||
    box.y + box.h > height + slack
  )
    return { pass: false, reason: 'headline box is off-screen' }
  const share = (box.w * box.h) / (width * height)
  if (share < 0.01)
    return { pass: false, reason: `headline box is ${(share * 100).toFixed(2)}% of the screen` }
  if (!kit.headline.trim()) return { pass: false, reason: 'headline text is empty' }
  return { pass: true, reason: `${(share * 100).toFixed(1)}% of the screen` }
}

/** OKLab distance under which two colors count as the same brand color (as in the brand evals) */
export const SAME_COLOR = 0.03

/** Hand-checked values, when there are any: same primary color and same headline family. */
export function scoreExact(kit: Pick<BrandKit, 'colors' | 'fonts'>, want: Expected): Check {
  const misses: string[] = []
  if (want.primary) {
    const a = rgb(kit.colors.primary)
    const b = rgb(want.primary)
    const d = a && b ? distance(a, b) : Number.POSITIVE_INFINITY
    if (d >= SAME_COLOR) misses.push(`primary ${kit.colors.primary}, expected ${want.primary}`)
  }
  if (want.display) {
    const got = kit.fonts.display.family.trim().toLowerCase()
    if (got !== want.display.trim().toLowerCase())
      misses.push(`font ${kit.fonts.display.family}, expected ${want.display}`)
  }
  return misses.length
    ? { pass: false, reason: misses.join('; ') }
    : { pass: true, reason: 'matches' }
}

/** A site that timed out, threw or hit a sign-in wall: every field fails with the same reason. */
export function siteFailed(url: string, tags: string[], err: unknown, seconds: number): SiteResult {
  const message = err instanceof Error ? err.message : String(err)
  const first = message.split('\n')[0]!.trim() || 'unknown error'
  const check: Check = { pass: false, reason: `couldn't read the site: ${first}` }
  return {
    url,
    tags,
    seconds,
    error: first,
    fields: Object.fromEntries(FIELDS.map((f) => [f, check])) as Record<FieldName, Check>,
  }
}

export interface Rate {
  pass: number
  n: number
}

export interface Summary {
  sites: number
  fields: Record<FieldName, Rate>
  tags: { tag: string; sites: number; fields: Record<FieldName, Rate>; all: Rate }[]
  exact: Rate | null
}

const empty = (): Record<FieldName, Rate> =>
  Object.fromEntries(FIELDS.map((f) => [f, { pass: 0, n: 0 }])) as Record<FieldName, Rate>

function add(into: Record<FieldName, Rate>, r: SiteResult) {
  for (const f of FIELDS) {
    into[f].n++
    if (r.fields[f].pass) into[f].pass++
  }
}

/** Pass rates per field over every site, and per tag (each field and all fields together). */
export function summarize(results: SiteResult[]): Summary {
  const fields = empty()
  for (const r of results) add(fields, r)
  const byTag = new Map<string, SiteResult[]>()
  for (const r of results) for (const t of r.tags) byTag.set(t, [...(byTag.get(t) ?? []), r])
  const tags = [...byTag]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, rs]) => {
      const f = empty()
      for (const r of rs) add(f, r)
      const all = FIELDS.reduce((acc, k) => ({ pass: acc.pass + f[k].pass, n: acc.n + f[k].n }), {
        pass: 0,
        n: 0,
      })
      return { tag, sites: rs.length, fields: f, all }
    })
  const checked = results.filter((r) => r.exact)
  const exact = checked.length
    ? { pass: checked.filter((r) => r.exact!.pass).length, n: checked.length }
    : null
  return { sites: results.length, fields, tags, exact }
}

export const pct = (r: Rate) => (r.n ? `${Math.round((100 * r.pass) / r.n)}%` : 'n/a')
