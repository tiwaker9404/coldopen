/**
 * Brand extraction on real homepages: how often does coldopen get each field right?
 *
 *   node evals/extract/run.ts                          # the 20 sites in sites.json
 *   node evals/extract/run.ts --only linear.app,stripe.com
 *   node evals/extract/run.ts --sites local.json --allow-private   # fixture sites, to test the wiring
 *
 * The fixture evals (evals/run.ts) prove extraction on three fictional sites; this measures
 * it on live ones. Most build sandboxes can't reach the web, so it runs by hand on GitHub's
 * runners (.github/workflows/extract-eval.yml). It is a measurement, not a gate: it exits 0
 * when fields fail, and 1 only if the script itself breaks.
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { extractBrand } from '../../src/brand/extract.ts'
import { closeBrowser } from '../../src/browser.ts'
import { buildTheme } from '../../src/render/theme.ts'
import { type Profile, ProfileSchema } from '../../src/script/types.ts'
import {
  type Expected,
  FIELDS,
  type FieldName,
  pct,
  type SiteResult,
  scoreColors,
  scoreExact,
  scoreFonts,
  scoreHeadlineBox,
  scoreHero,
  scoreLogo,
  siteFailed,
  summarize,
} from './score.ts'

const HERE = import.meta.dirname
const ROOT = join(HERE, '../..')
const SITE_TIMEOUT_MS = 60_000

const WHAT: Record<FieldName, string> = {
  colors: 'A primary color that isn’t a grey default, and film text that meets WCAG AA',
  fonts: 'The headline’s own font (not a fallback), with its files embedded in the film',
  logo: 'A header logo at least 24 px on its short side, not the favicon',
  hero: 'A hero screenshot that isn’t blank',
  headline: 'A headline box on screen, at least 1% of it, with the headline text',
}

interface Site {
  url: string
  tags: string[]
}

const host = (u: string) => new URL(u).hostname.replace(/^www\./, '')
/** the host, plus the path when there is one (the fixture sites share a host) */
const label = (u: string) => `${host(u)}${new URL(u).pathname.replace(/\/$/, '')}`
const cell = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ')

/** the hero as 160×100 greyscale bytes: enough to tell a blank page from a real one */
function greyPixels(file: string): Promise<Uint8Array> {
  return new Promise((ok, fail) => {
    const proc = spawn(
      process.env.FFMPEG_PATH ?? 'ffmpeg',
      ['-v', 'error', '-i', file, '-vf', 'scale=160:100,format=gray', '-f', 'rawvideo', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const out: Buffer[] = []
    let err = ''
    proc.stdout.on('data', (b: Buffer) => out.push(b))
    proc.stderr.on('data', (b: Buffer) => {
      err += b.toString()
    })
    proc.on('error', fail)
    proc.on('close', (code) =>
      code === 0 ? ok(new Uint8Array(Buffer.concat(out))) : fail(new Error(err.trim())),
    )
  })
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`took longer than ${ms / 1000}s`)), ms)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

async function measure(
  site: Site,
  dir: string,
  opts: { allowPrivate: boolean; profile: Profile; expected?: Expected },
): Promise<Omit<SiteResult, 'seconds'>> {
  const kit = await extractBrand(site.url, {
    outDir: dir,
    // leave the last stretch of the minute for fonts and the screenshot check
    timeoutMs: 40_000,
    allowPrivateNetworks: opts.allowPrivate,
  })
  // the film's own theme: its fields are what gets painted, and it is what embeds the fonts
  const theme = await buildTheme(kit, opts.profile, {
    allowPrivateNetworks: opts.allowPrivate,
    fontTimeoutMs: 8000,
  })
  const pixels = await greyPixels(join(dir, kit.screenshot.file)).catch(() => null)
  if (kit.logo) {
    const png = kit.logo.dataUrl.replace(/^data:image\/png;base64,/, '')
    await writeFile(join(dir, 'logo.png'), Buffer.from(png, 'base64'))
  }
  return {
    url: site.url,
    tags: site.tags,
    fields: {
      colors: scoreColors(kit, site.tags, [theme.dark, theme.light, theme.brand]),
      fonts: scoreFonts(kit, theme.fontsEmbedded.display),
      logo: scoreLogo(kit.logo),
      hero: scoreHero(pixels),
      headline: scoreHeadlineBox(kit),
    },
    ...(opts.expected ? { exact: scoreExact(kit, opts.expected) } : {}),
  }
}

function report(results: SiteResult[], date: string): string {
  const s = summarize(results)
  const exact = s.exact !== null
  const mark = (c: { pass: boolean; reason: string }) =>
    c.pass ? 'pass' : `**fail**: ${cell(c.reason)}`
  return [
    '# Brand extraction on live homepages',
    '',
    `Automatic checks on ${results.length} live homepages, run ${date}. A pass means plausible, not hand-verified, unless an exact-match column is shown.`,
    '',
    '## Per field',
    '',
    '| Field | Passed | Rate | What it checks |',
    '|---|---:|---:|---|',
    ...FIELDS.map(
      (f) => `| ${f} | ${s.fields[f].pass}/${s.fields[f].n} | ${pct(s.fields[f])} | ${WHAT[f]} |`,
    ),
    ...(exact
      ? [
          `| exact match | ${s.exact!.pass}/${s.exact!.n} | ${pct(s.exact!)} | Primary within OKLab 0.03 and the same headline family as hand-checked |`,
        ]
      : []),
    '',
    '## Per tag',
    '',
    `| Tag | Sites | ${FIELDS.join(' | ')} | All fields |`,
    `|---|---:|${FIELDS.map(() => '---:|').join('')}---:|`,
    ...s.tags.map(
      (t) =>
        `| ${t.tag} | ${t.sites} | ${FIELDS.map((f) => `${t.fields[f].pass}/${t.fields[f].n}`).join(' | ')} | ${t.all.pass}/${t.all.n} (${pct(t.all)}) |`,
    ),
    '',
    '## Per site',
    '',
    `| Site | Tags | ${FIELDS.join(' | ')} |${exact ? ' Exact match |' : ''} Seconds |`,
    `|---|---|${FIELDS.map(() => '---|').join('')}${exact ? '---|' : ''}---:|`,
    ...results.map(
      (r) =>
        `| ${label(r.url)} | ${r.tags.join(', ')} | ${FIELDS.map((f) => mark(r.fields[f])).join(' | ')} |${exact ? ` ${r.exact ? mark(r.exact) : ''} |` : ''} ${r.seconds.toFixed(1)} |`,
    ),
    '',
  ].join('\n')
}

function printTable(results: SiteResult[]) {
  const w = Math.max(...results.map((r) => label(r.url).length), 4)
  console.log(`\n${'site'.padEnd(w)}  ${FIELDS.map((f) => f.padEnd(8)).join(' ')}  seconds`)
  for (const r of results) {
    console.log(
      `${label(r.url).padEnd(w)}  ${FIELDS.map((f) => (r.fields[f].pass ? 'pass' : 'FAIL').padEnd(8)).join(' ')}  ${r.seconds.toFixed(1)}`,
    )
  }
  const s = summarize(results)
  console.log(
    `\n${FIELDS.map((f) => `${f} ${s.fields[f].pass}/${s.fields[f].n} (${pct(s.fields[f])})`).join('  ')}`,
  )
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      out: { type: 'string', default: 'extract-eval.md' },
      sites: { type: 'string', default: join(HERE, 'sites.json') },
      results: { type: 'string', default: join(HERE, 'results.json') },
      'out-dir': { type: 'string', default: 'extract-eval-out' },
      /** a comma list of hosts, to run a few sites */
      only: { type: 'string' },
      /** fixture sites on this machine only; the SSRF guard stays on for everything else */
      'allow-private': { type: 'boolean', default: false },
    },
  })
  let sites = JSON.parse(await readFile(resolve(values.sites!), 'utf8')) as Site[]
  const only = (values.only ?? '')
    .split(',')
    .map((h) => h.trim().replace(/^www\./, ''))
    .filter(Boolean)
  if (only.length) sites = sites.filter((s) => only.includes(host(s.url)))
  if (!sites.length) {
    console.error('no sites to check')
    process.exit(2)
  }
  const allowPrivate = values['allow-private']!
  if (allowPrivate) {
    const outside = sites.filter(
      (s) => !['127.0.0.1', 'localhost'].includes(new URL(s.url).hostname),
    )
    if (outside.length) {
      console.error(
        `--allow-private is only for sites on this machine (127.0.0.1 or localhost), not ${outside.map((s) => s.url).join(', ')}`,
      )
      process.exit(2)
    }
  }
  // Ashwin can fill expected.json with hand-checked values, keyed by host: { "linear.app": { "primary": "#5e6ad2", "display": "Inter Variable" } }
  const expected = JSON.parse(await readFile(join(HERE, 'expected.json'), 'utf8')) as Record<
    string,
    Expected
  >
  const profile = ProfileSchema.parse(
    JSON.parse(await readFile(join(ROOT, 'profiles/sales.example.json'), 'utf8')),
  )

  const results: SiteResult[] = []
  // one site at a time: a fair per-site time, and no site slowed by another
  for (const site of sites) {
    const started = Date.now()
    const slug =
      `${host(site.url)}${new URL(site.url).pathname.replace(/[^a-z0-9]+/gi, '-')}`.replace(
        /-+$/,
        '',
      )
    const dir = join(resolve(values['out-dir']!), slug)
    await mkdir(dir, { recursive: true })
    let result: SiteResult
    try {
      const r = await withTimeout(
        measure(site, dir, {
          allowPrivate,
          profile,
          expected: expected[label(site.url)] ?? expected[host(site.url)],
        }),
        SITE_TIMEOUT_MS,
      )
      result = { ...r, seconds: (Date.now() - started) / 1000 }
    } catch (err) {
      result = siteFailed(site.url, site.tags, err, (Date.now() - started) / 1000)
      // a page stuck past the deadline would still be running; start the next site fresh
      await closeBrowser()
    }
    results.push(result)
    const fails = FIELDS.filter((f) => !result.fields[f].pass)
    console.log(
      `${label(site.url).padEnd(22)} ${result.error ? `couldn't read the site: ${result.error}` : fails.length ? `fail ${fails.map((f) => `${f} (${result.fields[f].reason})`).join(', ')}` : 'all pass'}  ${result.seconds.toFixed(1)}s`,
    )
  }
  await closeBrowser()

  printTable(results)
  const date = new Date().toISOString().slice(0, 10)
  await writeFile(resolve(values.out!), report(results, date))
  await writeFile(resolve(values.results!), `${JSON.stringify({ date, results }, null, 2)}\n`)
  console.log(`\nwrote ${values.out} and ${values.results}`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
