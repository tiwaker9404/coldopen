import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'puppeteer'
import { getBrowser } from '../browser.ts'
import { derivePalette, parseColor, toHex, type WeightedColor } from './color.ts'
import type { BrandKit, Fact, FontRef } from './types.ts'

/**
 * Brand + research extraction from a live website.
 *
 * Opens the page in headless Chromium the way a person would, then reads what is actually
 * rendered: computed colors weighted by painted area, the fonts the headline really uses
 * (with their @font-face sources so the film can load them), the logo, the hero screenshot
 * and the copy, split into citable facts. Everything the film says about the company is
 * later required to come from these facts.
 */

const VIEWPORT = { width: 1440, height: 900 }

export interface ExtractOptions {
  outDir: string
  timeoutMs?: number
}

interface RawPage {
  title: string
  siteName: string
  description: string
  themeColor: string
  headline: string
  headlineBox: { x: number; y: number; w: number; h: number } | null
  subheads: string[]
  nav: string[]
  blocks: { text: string; tag: string }[]
  backgrounds: [string, number][]
  texts: [string, number][]
  brand: [string, number][]
  headlineFont: { family: string; weight: number }
  bodyFont: { family: string; weight: number }
  faces: { family: string; src: string; weight: string; style: string; unicodeRange?: string }[]
}

export async function extractBrand(url: string, opts: ExtractOptions): Promise<BrandKit> {
  const browser = await getBrowser()
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  try {
    await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 })
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 coldopen/1.0',
    )
    const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: opts.timeoutMs ?? 30_000 })
    if (!res) throw new Error(`no response from ${url}`)
    if (res.status() >= 400) throw new Error(`${url} returned HTTP ${res.status()}`)
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    await dismissOverlays(page)
    await new Promise((r) => setTimeout(r, 300))

    const raw = (await page.evaluate(readPage)) as RawPage
    const finalUrl = page.url()
    const canonical = await page.evaluate(
      () =>
        document.querySelector<HTMLLinkElement>('link[rel=canonical]')?.href ||
        document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content ||
        '',
    )
    const host = hostOf(canonical) ?? hostOf(finalUrl) ?? finalUrl

    await mkdir(opts.outDir, { recursive: true })
    const shotFile = join(opts.outDir, 'site.jpg')
    await page.screenshot({ path: shotFile, type: 'jpeg', quality: 88, clip: { x: 0, y: 0, ...VIEWPORT } })
    const logo = await captureLogo(page)

    const name = cleanName(raw.siteName || raw.title.split(/\s[|–—:-]\s|:\s/)[0] || host)
    const colors = derivePalette({
      backgrounds: toWeighted(raw.backgrounds),
      texts: toWeighted(raw.texts),
      brand: toWeighted([...raw.brand, ...(raw.themeColor ? [[raw.themeColor, 40_000] as [string, number]] : [])]),
    })

    const kit: BrandKit = {
      url: finalUrl,
      host,
      name,
      title: raw.title,
      description: raw.description,
      headline: raw.headline,
      subheads: raw.subheads,
      nav: raw.nav,
      facts: buildFacts(raw),
      colors,
      fonts: {
        display: fontRef(raw.headlineFont, raw.faces, finalUrl),
        body: fontRef(raw.bodyFont, raw.faces, finalUrl),
      },
      logo,
      screenshot: { file: 'site.jpg', ...VIEWPORT, headlineBox: raw.headlineBox },
      extractedAt: new Date().toISOString(),
    }
    await writeFile(join(opts.outDir, 'kit.json'), JSON.stringify(kit, null, 2))
    return kit
  } finally {
    await context.close().catch(() => {})
  }
}

function hostOf(u: string): string | null {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, '') : null
  } catch {
    return null
  }
}

function toWeighted(list: [string, number][]): WeightedColor[] {
  const out = new Map<string, number>()
  for (const [c, w] of list) {
    const p = parseColor(c)
    if (!p || p.a < 0.6) continue
    const hex = toHex(p)
    out.set(hex, (out.get(hex) ?? 0) + w)
  }
  return [...out.entries()].map(([hex, weight]) => ({ hex, weight }))
}

function cleanName(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^(home|welcome)\s*[|:-]\s*/i, '').trim().slice(0, 60)
}

const SERIF = /serif|fraunces|playfair|georgia|times|garamond|merriweather|lora|tiempos|canela|freight|caslon|baskerville|didot|bodoni|newsreader|instrument serif|dm serif|recoleta|gt super|editorial/i
const MONO = /mono|courier|consolas|menlo|code/i

function fontRef(f: { family: string; weight: number }, faces: RawPage['faces'], base: string): FontRef {
  const stack = f.family.split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''))
  const family = stack[0] || 'sans-serif'
  const generic = stack.find((s) => ['serif', 'sans-serif', 'monospace'].includes(s))
  const category: FontRef['category'] =
    generic === 'monospace' || MONO.test(family)
      ? 'mono'
      : (generic === 'serif' || SERIF.test(family)) && !/sans/i.test(family)
        ? 'serif'
        : 'sans'
  const mine = faces
    .filter((x) => x.family.replace(/["']/g, '').trim().toLowerCase() === family.toLowerCase())
    .map((x) => ({ ...x, src: absolutize(x.src, base) }))
    .filter((x) => /\.woff2?(\?|$)|format\(["']?woff/i.test(x.src))
  // prefer latin subsets: no unicode-range, or one that covers basic Latin
  const latin = mine.filter((x) => !x.unicodeRange || /U\+0000-00FF|U\+0-FF|U\+0020/i.test(x.unicodeRange))
  return {
    family,
    category,
    weight: f.weight,
    faces: (latin.length ? latin : mine).slice(0, 6).map(({ family: _f, ...rest }) => rest),
  }
}

function absolutize(src: string, base: string): string {
  const m = src.match(/url\(\s*["']?([^"')]+)["']?\s*\)/)
  if (!m) return src
  try {
    return new URL(m[1]!, base).href
  } catch {
    return m[1]!
  }
}

function buildFacts(raw: RawPage): Fact[] {
  const facts: Fact[] = []
  const seen = new Set<string>()
  const push = (text: string, kind: Fact['kind']) => {
    const t = text.replace(/\s+/g, ' ').trim()
    const key = t.toLowerCase().replace(/[^a-z0-9 ]/g, '')
    if (t.length < 12 || t.length > 260 || seen.has(key)) return
    // near-duplicates: the meta description often repeats the hero copy
    for (const k of seen) if (k.includes(key) || (key.includes(k) && k.length > 40)) return
    // skip boilerplate
    if (/cookie|privacy policy|all rights reserved|©|subscribe to our newsletter/i.test(t)) return
    seen.add(key)
    facts.push({ id: `f${facts.length + 1}`, text: t, kind })
  }
  if (raw.headline) push(raw.headline, 'headline')
  if (raw.description) push(raw.description, 'description')
  // stat tiles first: they are the most quotable facts on a page
  const ordered = [
    ...raw.blocks.filter((b) => b.tag === 'stat'),
    ...raw.blocks.filter((b) => b.tag !== 'stat'),
  ]
  for (const b of ordered) {
    const quote = b.tag === 'blockquote' || /^["“]/.test(b.text)
    const sentences = quote ? [b.text] : b.text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    for (const sentence of sentences) {
      push(sentence, quote ? 'quote' : /\d/.test(sentence) ? 'stat' : 'claim')
    }
    if (facts.length >= 40) break
  }
  return facts
}

async function dismissOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    const words = /^(accept( all)?|agree|i agree|got it|allow all|ok(ay)?|close|dismiss|no thanks)$/i
    for (const b of document.querySelectorAll<HTMLElement>('button, [role=button], a')) {
      if (words.test(b.innerText?.trim() ?? '') && b.closest('[class*=cookie i], [id*=cookie i], [class*=consent i], [id*=consent i], [role=dialog], [class*=banner i]')) {
        b.click()
      }
    }
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const s = getComputedStyle(el)
      if ((s.position === 'fixed' || s.position === 'sticky') && /cookie|consent|modal|popup|newsletter|chat|intercom|drift/i.test(`${el.id} ${el.className}`)) {
        el.style.setProperty('display', 'none', 'important')
      }
    }
  })
}

async function captureLogo(page: Page): Promise<BrandKit['logo']> {
  const handle = await page.evaluateHandle(() => {
    const scope = document.querySelector('header, [role=banner], nav') ?? document.body
    const candidates = [
      ...scope.querySelectorAll<HTMLElement>('[class*=logo i], [id*=logo i], img[alt*=logo i], a[aria-label*=home i]'),
      ...scope.querySelectorAll<HTMLElement>(`a[href="/"], a[href="${location.pathname}"], a[href="${location.origin}/"]`),
    ]
    for (const el of candidates) {
      const r = el.getBoundingClientRect()
      if (r.width >= 16 && r.width <= 420 && r.height >= 12 && r.height <= 160 && r.top < 200) return el
    }
    return null
  })
  const el = handle.asElement()
  if (!el) return null
  try {
    const box = await el.boundingBox()
    if (!box) return null
    const png = (await (el as import('puppeteer').ElementHandle<Element>).screenshot({
      type: 'png',
      omitBackground: true,
    })) as Uint8Array
    return {
      dataUrl: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
      width: Math.round(box.width),
      height: Math.round(box.height),
    }
  } catch {
    return null
  }
}

/** Runs inside the page. Must be self-contained (no closures over Node scope). */
function readPage(): RawPage {
  const vw = innerWidth
  const vh = innerHeight
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.1
  }
  const text = (el: Element | null) => ((el as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ').trim()
  const meta = (sel: string) => document.querySelector<HTMLMetaElement>(sel)?.content?.trim() ?? ''

  // -- copy
  const h1 = [...document.querySelectorAll('h1')].find(visible) ?? null
  const hr = h1?.getBoundingClientRect()
  const subheads = [...document.querySelectorAll('h2, h3')].filter(visible).map(text).filter((t) => t.length > 3).slice(0, 10)
  const nav = [...document.querySelectorAll('header a, nav a')].filter(visible).map(text).filter((t) => t.length > 1 && t.length < 30).slice(0, 12)
  const blocks: { text: string; tag: string }[] = []
  const seenBlocks = new Set<Element>()
  for (const el of document.querySelectorAll('main p, main li, main blockquote, p, li, blockquote, h2, h3, [class*=stat i], [class*=metric i], footer')) {
    if (!visible(el) || seenBlocks.has(el)) continue
    // ignore containers whose children are also candidates
    if (el.querySelector('p, li, blockquote, h2, h3')) continue
    seenBlocks.add(el)
    const t = text(el)
    if (t.length >= 12 && t.length <= 600) blocks.push({ text: t, tag: el.tagName.toLowerCase() })
    if (blocks.length > 80) break
  }
  // stat tiles: short blocks containing a number, often divs
  for (const el of document.querySelectorAll('div, span')) {
    if (blocks.length > 120) break
    // a tile, not a row of tiles: no block-level children
    if (el.children.length > 3 || !visible(el) || el.querySelector('div, p, li, section')) continue
    const t = text(el)
    if (/\d/.test(t) && t.length >= 12 && t.length <= 120 && el.querySelector('b, strong, em, [class*=num i]') && !blocks.some((b) => b.text === t)) {
      blocks.push({ text: t, tag: 'stat' })
    }
  }

  // -- colors, weighted by what a visitor actually sees
  const backgrounds: [string, number][] = []
  const texts: [string, number][] = []
  const brand: [string, number][] = []
  const bodyBg = getComputedStyle(document.body).backgroundColor
  const htmlBg = getComputedStyle(document.documentElement).backgroundColor
  const pageBg = /rgba\(0, 0, 0, 0\)|transparent/.test(bodyBg) ? htmlBg : bodyBg
  backgrounds.push([/rgba\(0, 0, 0, 0\)|transparent/.test(pageBg) ? 'rgb(255, 255, 255)' : pageBg, vw * vh * 0.6])
  const all = [...document.querySelectorAll('body *')].slice(0, 4000)
  for (const el of all) {
    const r = el.getBoundingClientRect()
    if (r.bottom < 0 || r.top > vh * 2.5 || r.width < 2 || r.height < 2) continue
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none') continue
    const area = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh * 2.5) - Math.max(r.top, 0))
    // above the fold counts double
    const fold = r.top < vh ? 2 : 1
    if (!/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor)) backgrounds.push([s.backgroundColor, area * fold])
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim()
    if (own.length) texts.push([s.color, own.length * fold])
    const interactive = el.matches('a, button, [role=button], [class*=btn i], [class*=button i], [class*=cta i]')
    if (interactive) {
      if (!/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor)) brand.push([s.backgroundColor, 6000 * fold])
      else if (own.length) brand.push([s.color, 800])
    }
    if (el.matches('h1, h2') && own.length) brand.push([s.color, 1500])
    if (el instanceof SVGElement || el.tagName === 'path' || el.tagName === 'rect' || el.tagName === 'circle') {
      const fill = s.fill
      if (fill && fill.startsWith('rgb') && r.top < 160) brand.push([fill, 4000])
    }
  }

  // -- fonts actually used, plus every @font-face we can read
  const fontOf = (el: Element | null) => {
    const s = el ? getComputedStyle(el) : getComputedStyle(document.body)
    return { family: s.fontFamily, weight: Number(s.fontWeight) || 400 }
  }
  const bodyEl = [...document.querySelectorAll('main p, p')].find(visible) ?? document.body
  const faces: RawPage['faces'] = []
  for (const sheet of [...document.styleSheets]) {
    let rules: CSSRuleList | null = null
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    const base = sheet.href ?? location.href
    for (const rule of [...rules]) {
      if (rule instanceof CSSFontFaceRule) {
        const st = rule.style
        const src = st.getPropertyValue('src')
        const m = src.match(/url\(\s*["']?([^"')]+)["']?\s*\)/)
        if (!m) continue
        let abs = m[1]!
        try {
          abs = new URL(m[1]!, base).href
        } catch {}
        faces.push({
          family: st.getPropertyValue('font-family').replace(/["']/g, '').trim(),
          src: `url(${abs})`,
          weight: st.getPropertyValue('font-weight') || '400',
          style: st.getPropertyValue('font-style') || 'normal',
          unicodeRange: st.getPropertyValue('unicode-range') || undefined,
        })
      }
    }
  }

  return {
    title: document.title.trim(),
    siteName: meta('meta[property="og:site_name"]'),
    description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
    themeColor: meta('meta[name="theme-color"]'),
    headline: text(h1),
    headlineBox: hr ? { x: hr.left, y: hr.top, w: hr.width, h: hr.height } : null,
    subheads,
    nav,
    blocks,
    backgrounds,
    texts,
    brand,
    headlineFont: fontOf(h1),
    bodyFont: fontOf(bodyEl),
    faces,
  }
}
