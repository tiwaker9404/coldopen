/**
 * Stills for the role reels, captured from the real product rather than mocked: the demo build
 * (the web app on its recorded account), the developers page and the eval report.
 *
 *   pnpm dashboard:build:demo && node launch/stills.ts [out-dir]     (default .scratch/stills)
 *
 * Writes PNGs named after what they show; launch/reels/*.json refer to them by those names.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import type { Page } from 'puppeteer'
import { closeBrowser, getBrowser } from '../src/browser.ts'
import { STILLS } from './reels.ts'

const ROOT = join(import.meta.dirname, '..')
const out = resolve(process.argv[2] ?? join(ROOT, '.scratch/stills'))
mkdirSync(out, { recursive: true })

// GitHub Pages, locally: the landing site at /coldopen/ and the demo at /coldopen/demo/
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
}
const DEMO_DIR = join(ROOT, 'dashboard/dist-demo')
const SITE_DIR = join(ROOT, 'site')
const server = createServer((req, res) => {
  try {
    let p = decodeURIComponent((req.url ?? '/').split('?')[0]!)
    if (p.endsWith('/')) p += 'index.html'
    const [dir, rest] = p.startsWith('/coldopen/demo/')
      ? [DEMO_DIR, p.slice('/coldopen/demo/'.length)]
      : [SITE_DIR, p.replace(/^\/coldopen\//, '')]
    // serve only files inside the folder: a ../ in the path would reach the rest of the disk
    const file = resolve(dir, `.${sep}${rest}`)
    if (!file.startsWith(dir + sep)) throw new Error('outside the served folder')
    const body = readFileSync(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
})
await new Promise<void>((r) => server.listen(8096, '127.0.0.1', r))
const BASE = 'http://127.0.0.1:8096/coldopen'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const browser = await getBrowser()

async function open(url: string, tour: boolean): Promise<Page> {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
  await page.goto(`${BASE}/demo/`, { waitUntil: 'networkidle0' })
  await page.evaluate((show) => {
    if (show) localStorage.removeItem('coldopen.demo.tour')
    else localStorage.setItem('coldopen.demo.tour', 'done')
  }, tour)
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.reload({ waitUntil: 'networkidle0' })
  await wait(600)
  return page
}
const shot = async (page: Page, name: string) => {
  await page.screenshot({ path: join(out, `${name}.png`) })
  console.log(`  ${name}.png`)
}
/** scroll the open film panel so a heading or label sits near the top */
const scrollTo = (page: Page, text: string) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll('h3, dt, [role=tab], button')].find((e) =>
      e.textContent?.trim().startsWith(t),
    )
    el?.scrollIntoView({ block: 'start' })
  }, text)

// the account's pages, without the tour
let page = await open(`${BASE}/demo/#today`, false)
await shot(page, 'today')
await page.goto(`${BASE}/demo/#jobs`, { waitUntil: 'networkidle0' })
await wait(500)
// past the search form, to the ranked list
await page.evaluate(() => window.scrollBy(0, 560))
await wait(300)
await shot(page, 'jobs')
await page.goto(`${BASE}/demo/#startups`, { waitUntil: 'networkidle0' })
await wait(500)
await shot(page, 'startups')
await page.goto(`${BASE}/demo/#films`, { waitUntil: 'networkidle0' })
await wait(500)
await shot(page, 'board')
await page.close()

// the tour walks into the film panel; the cards are hidden for clean shots of what they point at
page = await open(`${BASE}/demo/#today`, true)
await shot(page, 'tour')
const nextStop = async () => {
  await page.click('.tour button.primary')
  await wait(1400)
}
await nextStop()
await nextStop()
await shot(page, 'film-tour')
await page.addStyleTag({ content: '.tour{display:none !important}' })
await shot(page, 'film')
await scrollTo(page, 'Send the message')
await wait(400)
await shot(page, 'messages')
await page.click('#tab-views')
await wait(600)
await page.evaluate(() => document.querySelector('#tab-views')?.scrollIntoView({ block: 'start' }))
await wait(300)
await shot(page, 'views')
await page.close()

// the developers page: the API, MCP and self-hosting
page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
await page.goto(`${BASE}/developers/`, { waitUntil: 'networkidle0' })
await shot(page, 'developers')
await page.close()

// the eval report, as a page: the numbers come straight from evals/results.md
const report = readFileSync(join(ROOT, 'evals/results.md'), 'utf8')
const rows = report
  .split('\n')
  .filter((l) => /^\| `/.test(l))
  .map((l) => l.split('|').map((c) => c.trim()))
  .map(([, name, passed, what]) => ({
    name: name!.replaceAll('`', ''),
    passed: passed!,
    what: what!,
  }))
const summary = report.split('\n').find((l) => /checks passed/.test(l)) ?? ''
const esc = (s: string) =>
  s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
page = await browser.newPage()
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 })
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#17181b;color:#f2f2ee;font:16px/1.4 system-ui,sans-serif;padding:44px 56px}
h1{font:800 44px/1 Impact,'Arial Narrow',sans-serif;letter-spacing:.01em;margin:0 0 10px}
p{color:#b3b5b9;margin:0 0 22px}
table{border-collapse:collapse;width:100%}
td{padding:7px 10px;border-top:1px solid #2e3035;font-size:15px}
td:first-child{font-family:ui-monospace,monospace;color:#ffc21a;white-space:nowrap}
td:nth-child(2){text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td:last-child{color:#b3b5b9}
</style><h1>coldopen evals</h1><p>${esc(summary)}</p><table>${rows
  .map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.passed)}</td><td>${esc(r.what)}</td></tr>`)
  .join('')}</table>`)
await shot(page, 'evals')
await page.close()

await closeBrowser()
server.close()
const missing = STILLS.filter((s) => !existsSync(join(out, `${s}.png`)))
if (missing.length) throw new Error(`stills not captured: ${missing.join(', ')}`)
console.log(`stills in ${out}`)
