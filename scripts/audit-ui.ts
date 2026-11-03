/**
 * UI audit: every page coldopen serves, in a real browser, at desktop and phone widths.
 * Checks accessibility (axe-core, WCAG 2.2 AA), console errors, horizontal overflow on a
 * phone, and missing security headers. Exits non-zero on anything serious.
 *
 *   node scripts/audit-ui.ts http://localhost:8080 [site-dir]     (CHROME_PATH to use another Chrome)
 */
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { extname, join } from 'node:path'
import puppeteer from 'puppeteer'

const base = process.argv[2] ?? 'http://localhost:8080'
const siteDir = process.argv[3]
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

const pages: { name: string; url: string }[] = [
  { name: 'Today', url: `${base}/#today` },
  { name: 'Jobs', url: `${base}/#jobs` },
  { name: 'Startups', url: `${base}/#startups` },
  { name: 'Films', url: `${base}/#films` },
  { name: 'Profile', url: `${base}/#profile` },
  { name: 'Privacy', url: `${base}/privacy` },
]

// the landing site and the Hiring Index, served as GitHub Pages serves them
let close = () => {}
if (siteDir) {
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.mp4': 'video/mp4',
  }
  const srv = createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? '/').split('?')[0]!)
    if (p.endsWith('/')) p += 'index.html'
    try {
      const body = readFileSync(join(siteDir, p))
      res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((r) => srv.listen(8099, r))
  close = () => srv.close()
  pages.push(
    { name: 'Landing', url: 'http://localhost:8099/' },
    { name: 'Hiring Index', url: 'http://localhost:8099/hiring-index/' },
    { name: 'Developers', url: 'http://localhost:8099/developers/' },
  )
}

interface Finding {
  page: string
  width: number
  kind: string
  detail: string
  serious: boolean
}
const findings: Finding[] = []

const browser = await puppeteer.launch({
  args: ['--no-sandbox'],
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
})
// desktop, phone, and desktop in dark mode (its own colors, its own contrast)
for (const [width, dark] of [
  [1280, false],
  [375, false],
  [1280, true],
] as const) {
  for (const p of pages) {
    const page = await browser.newPage()
    await page.setViewport({ width, height: 900 })
    // the page's CSP would (rightly) refuse the injected axe script
    await page.setBypassCSP(true)
    if (dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
    const errors: string[] = []
    page.on('console', (m) => {
      // a resource the network refused (offline CI) isn't a page bug; a script error is
      // a resource that failed to load (offline CI, a test film with no files) is a network
      // matter, not a page bug; a script error is
      if (
        m.type() === 'error' &&
        !/^Failed to load resource|ERR_(TUNNEL|NAME|INTERNET|CONNECTION|PROXY)/.test(m.text())
      )
        errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(e.message))
    const res = await page.goto(p.url, { waitUntil: 'networkidle0' }).catch(() => null)
    await new Promise((r) => setTimeout(r, 800))
    if (width === 1280 && !dark && res && p.url.startsWith(base)) {
      const h = res.headers()
      for (const want of [
        'content-security-policy',
        'x-content-type-options',
        'referrer-policy',
        'x-frame-options',
      ])
        if (!h[want])
          findings.push({
            page: p.name,
            width,
            kind: 'header',
            detail: `no ${want}`,
            serious: true,
          })
    }
    for (const e of errors.slice(0, 5))
      findings.push({
        page: p.name,
        width,
        kind: 'console',
        detail: e.slice(0, 200),
        serious: true,
      })
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    if (width === 375 && overflow > 1)
      findings.push({
        page: p.name,
        width,
        kind: 'overflow',
        detail: `scrolls sideways by ${overflow}px on a phone`,
        serious: true,
      })
    await page.addScriptTag({ content: axe })
    const result = (await page.evaluate(async () => {
      const a = (window as unknown as { axe: { run: (o: unknown) => Promise<unknown> } }).axe
      return a.run({ runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] })
    })) as {
      violations: {
        id: string
        impact: string
        help: string
        nodes: { target: string[]; any?: { message: string }[] }[]
      }[]
    }
    for (const v of result.violations)
      findings.push({
        page: dark ? `${p.name} (dark)` : p.name,
        width,
        kind: `a11y:${v.id}`,
        detail: `${v.help} (${v.nodes.length}×: ${v.nodes
          .slice(0, 3)
          .map(
            (n) =>
              `${n.target.join(' ')}${n.any?.[0]?.message ? ` [${n.any[0].message.slice(0, 140)}]` : ''}`,
          )
          .join(', ')})`,
        serious: v.impact === 'serious' || v.impact === 'critical',
      })
    await page.close()
  }
}
await browser.close()
close()

// one line per finding; a finding seen at both widths is listed once
const seen = new Set<string>()
for (const f of findings) {
  const k = `${f.page}|${f.kind}|${f.detail}`
  if (seen.has(k)) continue
  seen.add(k)
  console.log(`${f.serious ? 'SERIOUS' : 'minor  '} ${f.page} @${f.width}: ${f.kind} — ${f.detail}`)
}
const serious = findings.filter((f) => f.serious).length
console.log(
  `\n${pages.length} pages × desktop, phone and dark: ${serious} serious, ${findings.length - serious} minor`,
)
process.exit(serious ? 1 : 0)
