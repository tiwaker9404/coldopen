import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'puppeteer'
import { getBrowser } from '../browser.ts'
import { derivePalette, parseColor, toHex, type WeightedColor } from './color.ts'
import { assertPublicUrl, guardPage } from './guard.ts'
import { isStat, quotable, tidy } from './text.ts'

export { isStat, quotable, tidy }

import type { Box, BrandKit, Fact, FontRef } from './types.ts'

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
  /** allow localhost / private networks (local CLI use, tests). Hosted deployments keep this off. */
  allowPrivateNetworks?: boolean
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
  blocks: { text: string; tag: string; ref: number; box: Box | null }[]
  backgrounds: [string, number][]
  texts: [string, number][]
  brand: [string, number][]
  headlineFont: { family: string; weight: number }
  bodyFont: { family: string; weight: number }
  faces: { family: string; src: string; weight: string; style: string; unicodeRange?: string }[]
}

export async function extractBrand(url: string, opts: ExtractOptions): Promise<BrandKit> {
  if (!opts.allowPrivateNetworks) await assertPublicUrl(url)
  const browser = await getBrowser()
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  try {
    if (!opts.allowPrivateNetworks) await guardPage(page)
    // cross-origin stylesheets hide their rules from the page, so read @font-face from the network
    const cssTexts: { url: string; text: string }[] = []
    page.on('response', (r) => {
      if (r.request().resourceType() !== 'stylesheet' || !r.ok()) return
      r.text()
        .then((text) => cssTexts.push({ url: r.url(), text }))
        .catch(() => {})
    })
    await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 })
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 coldopen/1.0',
    )
    const res = await navigate(page, url, opts.timeoutMs ?? 30_000)
    if (res.status >= 400) {
      throw new Error(
        res.status === 403 || res.status === 429
          ? `${url} blocked the request (HTTP ${res.status}); some sites refuse automated browsers`
          : `${url} returned HTTP ${res.status}`,
      )
    }
    // web fonts, lazy hero images and client-rendered apps need a moment after "load"
    await Promise.race([
      page.evaluate(() => document.fonts.ready.then(() => undefined)),
      new Promise((r) => setTimeout(r, 5000)),
    ])
    await page.evaluate(() => window.scrollTo(0, 0))
    // consent banners often appear a beat after load, so sweep twice
    await dismissOverlays(page)
    await new Promise((r) => setTimeout(r, 700))
    await dismissOverlays(page)
    await new Promise((r) => setTimeout(r, 300))
    // biome-ignore lint/performance/useDomNodeTextContent: we want visible text, not hidden markup
    const textLength = await page.evaluate(() => document.body?.innerText?.trim().length ?? 0)
    if (textLength < 40) {
      throw new Error(
        `${url} rendered almost no text; it may be a login wall, a bot check or an empty app shell`,
      )
    }

    const raw = (await page.evaluate(readPage)) as RawPage
    raw.headline = tidy(raw.headline)
    raw.subheads = raw.subheads.map(tidy)
    raw.faces = mergeFaces(raw.faces, cssTexts)
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
    await page.screenshot({
      path: shotFile,
      type: 'jpeg',
      quality: 88,
      clip: { x: 0, y: 0, ...VIEWPORT },
    })
    const logo = await captureLogo(page)
    const refs = new Map<string, number>()
    const facts = buildFacts(raw, refs)
    await captureCloseUps(page, refs, facts, opts.outDir)

    const name = pickName(raw, host)
    const colors = derivePalette({
      backgrounds: toWeighted(raw.backgrounds),
      texts: toWeighted(raw.texts),
      brand: toWeighted([
        ...raw.brand,
        ...(raw.themeColor ? [[raw.themeColor, 40_000] as [string, number]] : []),
      ]),
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
      facts,
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

/** How many below-the-fold facts get their own screenshot (each takes about half a second). */
const CLOSE_UPS = 5

/**
 * The film's homepage scene can only point at what's in a screenshot. The first screenshot
 * is the top of the page; for the strongest facts further down, take one centered on them,
 * so "your homepage shows 93,000 vendors" can show exactly that line.
 */
async function captureCloseUps(
  page: Page,
  refs: Map<string, number>,
  facts: Fact[],
  outDir: string,
) {
  const below = facts.filter(
    (f) => f.box && f.box.y + f.box.h > VIEWPORT.height && f.box.h < VIEWPORT.height * 0.6,
  )
  // stats first, then claims: the facts a script is most likely to point at. Sentences from
  // one block share a close-up.
  const order = (f: Fact) => (f.kind === 'stat' ? 0 : f.kind === 'quote' ? 1 : 2)
  const blocks = new Map<number, Fact[]>()
  for (const f of below.sort((a, b) => order(a) - order(b))) {
    const ref = refs.get(f.id)
    if (ref === undefined) continue
    blocks.set(ref, [...(blocks.get(ref) ?? []), f])
  }
  for (const [ref, group] of [...blocks].slice(0, CLOSE_UPS)) {
    try {
      const at = (await page.evaluate(
        (ref: number, vh: number) => {
          const el = document.querySelector(`[data-coldopen-ref="${ref}"]`)
          if (!el) return null
          const before = el.getBoundingClientRect()
          const top = Math.max(0, before.top + window.scrollY - (vh - before.height) / 2)
          window.scrollTo(0, top)
          return { top: window.scrollY }
        },
        ref,
        VIEWPORT.height,
      )) as { top: number } | null
      if (!at) continue
      // lazy images and scroll-in animations need a moment
      await new Promise((r) => setTimeout(r, 650))
      const box = (await page.evaluate((ref: number) => {
        const r = document.querySelector(`[data-coldopen-ref="${ref}"]`)!.getBoundingClientRect()
        return { x: r.left, y: r.top, w: r.width, h: r.height, scrollY: window.scrollY }
      }, ref)) as Box & { scrollY: number }
      if (box.y < 0 || box.y + box.h > VIEWPORT.height || box.w < 4) continue
      const file = `site-${group[0]!.id}.jpg`
      await page.screenshot({
        path: join(outDir, file),
        type: 'jpeg',
        quality: 85,
        clip: { x: 0, y: box.scrollY, ...VIEWPORT },
      })
      for (const f of group) f.shot = { file, box: { x: box.x, y: box.y, w: box.w, h: box.h } }
    } catch {
      // a close-up is a nicety; the film falls back to the top of the page
    }
  }
  await page.evaluate(() => window.scrollTo(0, 0))
}

/**
 * Go to a URL like a patient visitor: wait for the network to settle, but if a site never
 * goes quiet (analytics, websockets, video), settle for whatever has loaded by the deadline.
 */
async function navigate(page: Page, url: string, timeoutMs: number): Promise<{ status: number }> {
  try {
    const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs })
    return { status: res?.status() ?? 200 }
  } catch (err) {
    if (!(err instanceof Error) || !/timeout/i.test(err.message)) throw err
    const loaded = await page.evaluate(() => document.readyState).catch(() => 'loading')
    if (loaded === 'loading')
      throw new Error(`${url} did not load within ${Math.round(timeoutMs / 1000)}s`)
    return { status: 200 }
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

/**
 * The company's name, not its tagline. og:site_name and the title's first segment are often a
 * slogan ("Build internal software better, with AI. | Retool"), so prefer whichever candidate
 * matches the domain, then the shortest name-like one, then the domain itself.
 */
export function pickName(raw: Pick<RawPage, 'siteName' | 'title'>, host: string): string {
  const label = host
    .replace(/^www\./, '')
    .split('.')[0]!
    .toLowerCase()
  const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const candidates = [raw.siteName, ...raw.title.split(/\s[|–—·:-]\s|:\s/)]
    .map(cleanName)
    .filter((c) => c.length > 1 && !GENERIC_PAGE.test(c))
  const matching = candidates.find((c) => {
    const q = squash(c)
    return q.length > 1 && (q === label || q.startsWith(label) || label.startsWith(q))
  })
  if (matching && matching.split(' ').length <= 4) return matching
  const short = candidates.find((c) => c.split(' ').length <= 2 && !/[.!?]$/.test(c))
  if (short) return short
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// what a page is called, not who it belongs to: "Home | Range" names the company Range
const GENERIC_PAGE =
  /^(home|home ?page|welcome|index|main|landing|official (web)?site|start|overview|about( us)?|untitled)$/i

function cleanName(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/^(home|welcome)\s*[|:-]\s*/i, '')
    .trim()
    .slice(0, 60)
}

const SERIF =
  /serif|fraunces|playfair|georgia|times|garamond|merriweather|lora|tiempos|canela|freight|caslon|baskerville|didot|bodoni|newsreader|instrument serif|dm serif|recoleta|gt super|editorial/i
const MONO = /mono|courier|consolas|menlo|code/i

function fontRef(
  f: { family: string; weight: number },
  faces: RawPage['faces'],
  base: string,
): FontRef {
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
  const latin = mine.filter(
    (x) => !x.unicodeRange || /U\+0000-00FF|U\+0-FF|U\+0020/i.test(x.unicodeRange),
  )
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

/** Add @font-face rules from stylesheets the page couldn't read (cross-origin). */
function mergeFaces(
  faces: RawPage['faces'],
  sheets: { url: string; text: string }[],
): RawPage['faces'] {
  const out = [...faces]
  const seen = new Set(faces.map((f) => `${f.family}|${f.src}`))
  for (const { url, text } of sheets) {
    for (const block of text.match(/@font-face\s*{[^}]*}/g) ?? []) {
      const get = (prop: string) =>
        block.match(new RegExp(`${prop}\\s*:\\s*([^;}]+)`, 'i'))?.[1]?.trim()
      const family = get('font-family')?.replace(/["']/g, '').trim()
      const src = get('src')?.match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1]
      if (!family || !src) continue
      let abs = src
      try {
        abs = new URL(src, url).href
      } catch {}
      const key = `${family}|url(${abs})`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        family,
        src: `url(${abs})`,
        weight: get('font-weight') ?? '400',
        style: get('font-style') ?? 'normal',
        unicodeRange: get('unicode-range'),
      })
    }
  }
  return out
}

/** @param refs  filled with each fact's page block, to find it again for a close-up */
function buildFacts(raw: RawPage, refs?: Map<string, number>): Fact[] {
  const facts: Fact[] = []
  const seen = new Set<string>()
  const push = (text: string, kind: Fact['kind'], box?: Box | null, ref?: number) => {
    const t = tidy(text)
    if (!quotable(t)) return
    if (kind === 'stat' && !isStat(t)) kind = 'claim'
    const key = t.toLowerCase().replace(/[^a-z0-9 ]/g, '')
    if (t.length < 12 || t.length > 260 || seen.has(key)) return
    // near-duplicates: the meta description often repeats the hero copy
    for (const k of seen) if (k.includes(key) || (key.includes(k) && k.length > 40)) return
    // skip boilerplate
    if (/cookie|privacy policy|all rights reserved|©|subscribe to our newsletter/i.test(t)) return
    seen.add(key)
    const id = `f${facts.length + 1}`
    if (ref !== undefined) refs?.set(id, ref)
    facts.push({ id, text: t, kind, ...(box ? { box } : {}) })
  }
  if (raw.headline) push(raw.headline, 'headline', raw.headlineBox)
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
      push(sentence, quote ? 'quote' : isStat(sentence) ? 'stat' : 'claim', b.box, b.ref)
    }
    if (facts.length >= 40) break
  }
  return facts
}

async function dismissOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    // prefer refusing optional cookies; any of these closes the banner
    const words =
      /^(reject( all)?|decline( all)?|only necessary|necessary only|accept( all)?( cookies)?|agree|i agree|got it|allow all|ok(ay)?|close|dismiss|no thanks)$/i
    const aboutConsent = (el: Element) => {
      for (let n: Element | null = el, i = 0; n && i < 8; n = n.parentElement, i++) {
        // biome-ignore lint/performance/useDomNodeTextContent: we match what a visitor reads
        const t = (n as HTMLElement).innerText ?? ''
        if (t.length > 2000) return false
        if (/cookie|consent|privacy/i.test(t) || /cookie|consent/i.test(`${n.id} ${n.className}`))
          return true
      }
      return false
    }
    const deep = (root: Document | ShadowRoot, sel: string): HTMLElement[] => {
      const out = [...root.querySelectorAll<HTMLElement>(sel)]
      for (const el of root.querySelectorAll('*'))
        if (el.shadowRoot) out.push(...deep(el.shadowRoot, sel))
      return out
    }
    for (const b of deep(document, 'button, [role=button], a')) {
      // biome-ignore lint/performance/useDomNodeTextContent: innerText is what a visitor reads
      if (words.test(b.innerText?.trim() ?? '') && aboutConsent(b)) b.click()
    }
    // consent managers by name: some render inside closed shadow roots we can't click into
    for (const el of document.querySelectorAll<HTMLElement>(
      '[id*=transcend i], [id*=onetrust i], [id*=didomi i], [id*=cookiebot i], [id*=usercentrics i], [id*=osano i], [id*=truste i], [class*=osano i]',
    ))
      el.style.setProperty('display', 'none', 'important')
    for (const el of deep(document, '*')) {
      const s = getComputedStyle(el)
      if (s.position !== 'fixed' && s.position !== 'sticky') continue
      const r = el.getBoundingClientRect()
      const tag = `${el.id} ${el.className}`
      // biome-ignore lint/performance/useDomNodeTextContent: visible text only
      const t = el.innerText ?? ''
      if (
        /cookie|consent|modal|popup|newsletter|chat|intercom|drift/i.test(tag) ||
        // a floating card that talks about cookies, but never the site header
        (t.length < 1500 && /\bcookies?\b/i.test(t) && r.top > 80) ||
        // a card pinned to the lower part of the screen: consent managers that hide inside closed
        // shadow roots, chat bubbles, promo toasts. Page content is never fixed down there.
        (r.top > innerHeight * 0.35 &&
          r.width * r.height < innerWidth * innerHeight * 0.35 &&
          r.width > 40 &&
          s.position === 'fixed')
      ) {
        el.style.setProperty('display', 'none', 'important')
      }
    }
  })
}

async function captureLogo(page: Page): Promise<BrandKit['logo']> {
  const handle = await page.evaluateHandle(() => {
    const scope = document.querySelector('header, [role=banner], nav') ?? document.body
    const graphic = (el: Element) => el.matches('svg, img') || !!el.querySelector('svg, img')
    const home = [
      ...scope.querySelectorAll<HTMLElement>(
        `a[href="/"], a[href="${location.origin}/"], a[href="${location.origin}"], a[aria-label*=home i]`,
      ),
    ].filter(graphic)
    const named = [
      ...scope.querySelectorAll<HTMLElement>(
        '[class*=logo i], [id*=logo i], img[alt*=logo i], [aria-label*=logo i]',
      ),
    ].filter(graphic)
    const loose = [
      ...scope.querySelectorAll<HTMLElement>(
        '[class*=logo i], [id*=logo i], img[alt*=logo i], a[aria-label*=home i], a[href="/"]',
      ),
    ]
    const fits = (el: Element) => {
      const r = el.getBoundingClientRect()
      return r.width >= 16 && r.width <= 420 && r.height >= 12 && r.height <= 160 && r.top < 200
    }
    const wide = (el: Element) => {
      const r = el.getBoundingClientRect()
      return r.width / Math.max(1, r.height) >= 1.8
    }
    const graphics = [...home, ...named].filter(fits)
    const candidates = [...graphics.filter(wide), ...graphics, ...loose]
    for (const el of candidates) {
      const r = el.getBoundingClientRect()
      if (r.width >= 16 && r.width <= 420 && r.height >= 12 && r.height <= 160 && r.top < 200)
        return el
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
    return (
      r.width > 2 &&
      r.height > 2 &&
      s.visibility !== 'hidden' &&
      s.display !== 'none' &&
      Number(s.opacity) > 0.1
    )
  }
  const text = (el: Element | null) =>
    // biome-ignore lint/performance/useDomNodeTextContent: innerText keeps block breaks ("1,400+\nshippers")
    ((el as HTMLElement | null)?.innerText ?? '').replace(/\s+/g, ' ').trim()
  const meta = (sel: string) => document.querySelector<HTMLMetaElement>(sel)?.content?.trim() ?? ''

  // -- copy
  // the headline: the biggest text above the fold. A visible h1 wins unless it's clearly
  // smaller, because some sites mark up an eyebrow label as the h1 (retellai.com).
  const sizeOf = (el: Element) => Number.parseFloat(getComputedStyle(el).fontSize) || 0
  let largest: Element | null = null
  let best = 0
  for (const el of document.querySelectorAll('h1, h2, p, div, span')) {
    if (el.children.length > 2 || !visible(el)) continue
    const r = el.getBoundingClientRect()
    const size = sizeOf(el)
    const t = text(el)
    if (r.top < vh && r.bottom > 0 && size > best && t.length > 8 && t.length < 140) {
      best = size
      largest = el
    }
  }
  let h1: Element | null =
    [...document.querySelectorAll('h1')].find((e) => visible(e) && text(e).length > 3) ?? null
  if (!h1 || (largest && sizeOf(h1) < best * 0.6)) h1 = largest
  // the box around the words a visitor sees: union of visible text runs inside the h1's own box.
  // Screen-reader copies and offscreen animation clones are excluded, so the zoom lands on the text.
  let hr: { left: number; top: number; width: number; height: number } | undefined =
    h1?.getBoundingClientRect()
  if (h1 && hr) {
    const outer = hr
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity
    const walker = document.createTreeWalker(h1, NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim() || !n.parentElement || !visible(n.parentElement)) continue
      range.selectNodeContents(n)
      for (const r of range.getClientRects()) {
        // tight display line-heights let glyphs overhang the box vertically, so allow most of a line
        const slack = r.height * 0.6
        const inside =
          r.left >= outer.left - 2 &&
          r.right <= outer.left + outer.width + 2 &&
          r.top >= outer.top - slack &&
          r.bottom <= outer.top + outer.height + slack
        if (r.width < 3 || r.height < 3 || !inside || r.right < 0 || r.left > vw) continue
        x0 = Math.min(x0, r.left)
        y0 = Math.min(y0, r.top)
        x1 = Math.max(x1, r.right)
        y1 = Math.max(y1, r.bottom)
      }
    }
    if (x1 - x0 > 8 && y1 - y0 > 8) hr = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 }
  }
  const subheads = [...document.querySelectorAll('h2, h3')]
    .filter(visible)
    .map(text)
    .filter((t) => t.length > 3)
    .slice(0, 10)
  const nav = [...document.querySelectorAll('header a, nav a')]
    .filter(visible)
    .map(text)
    .filter((t) => t.length > 1 && t.length < 30)
    .slice(0, 12)
  const blocks: { text: string; tag: string; ref: number; box: Box | null }[] = []
  // where a block sits on the page, and a mark to find it again for a close-up screenshot
  const place = (el: Element) => {
    const ref = blocks.length
    el.setAttribute('data-coldopen-ref', String(ref))
    const r = el.getBoundingClientRect()
    const box =
      r.width > 4 && r.height > 4
        ? { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height }
        : null
    return { ref, box }
  }
  const seenBlocks = new Set<Element>()
  for (const el of document.querySelectorAll(
    'main p, main li, main blockquote, p, li, blockquote, h2, h3, [class*=stat i], [class*=metric i], footer',
  )) {
    if (!visible(el) || seenBlocks.has(el)) continue
    // ignore containers whose children are also candidates
    if (el.querySelector('p, li, blockquote, h2, h3')) continue
    seenBlocks.add(el)
    const t = text(el)
    if (t.length >= 12 && t.length <= 600)
      blocks.push({ text: t, tag: el.tagName.toLowerCase(), ...place(el) })
    if (blocks.length > 80) break
  }
  // stat tiles: short blocks containing a number, often divs
  for (const el of document.querySelectorAll('div, span')) {
    if (blocks.length > 120) break
    // a tile, not a row of tiles: no block-level children
    if (el.children.length > 3 || !visible(el) || el.querySelector('div, p, li, section')) continue
    const t = text(el)
    if (
      /\d/.test(t) &&
      t.length >= 12 &&
      t.length <= 120 &&
      el.querySelector('b, strong, em, [class*=num i]') &&
      !blocks.some((b) => b.text === t)
    ) {
      blocks.push({ text: t, tag: 'stat', ...place(el) })
    }
  }

  // -- colors, weighted by what a visitor actually sees
  const backgrounds: [string, number][] = []
  const texts: [string, number][] = []
  const brand: [string, number][] = []
  const bodyBg = getComputedStyle(document.body).backgroundColor
  const htmlBg = getComputedStyle(document.documentElement).backgroundColor
  const pageBg = /rgba\(0, 0, 0, 0\)|transparent/.test(bodyBg) ? htmlBg : bodyBg
  backgrounds.push([
    /rgba\(0, 0, 0, 0\)|transparent/.test(pageBg) ? 'rgb(255, 255, 255)' : pageBg,
    vw * vh * 0.6,
  ])
  const all = [...document.querySelectorAll('body *')].slice(0, 4000)
  for (const el of all) {
    const r = el.getBoundingClientRect()
    if (r.bottom < 0 || r.top > vh * 2.5 || r.width < 2 || r.height < 2) continue
    const s = getComputedStyle(el)
    if (s.visibility === 'hidden' || s.display === 'none') continue
    const area =
      Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) *
      Math.max(0, Math.min(r.bottom, vh * 2.5) - Math.max(r.top, 0))
    // above the fold counts double
    const fold = r.top < vh ? 2 : 1
    if (!/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor))
      backgrounds.push([s.backgroundColor, area * fold])
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim()
    if (own.length) texts.push([s.color, own.length * fold])
    const interactive = el.matches(
      'a, button, [role=button], [class*=btn i], [class*=button i], [class*=cta i]',
    )
    if (interactive) {
      if (!/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor))
        brand.push([s.backgroundColor, 6000 * fold])
      else if (own.length) brand.push([s.color, 800])
    }
    if (el.matches('h1, h2') && own.length) brand.push([s.color, 1500])
    if (
      el instanceof SVGElement ||
      el.tagName === 'path' ||
      el.tagName === 'rect' ||
      el.tagName === 'circle'
    ) {
      const fill = s.fill
      if (fill?.startsWith('rgb') && r.top < 160) brand.push([fill, 4000])
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
