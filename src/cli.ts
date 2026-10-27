#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { closeBrowser } from './browser.ts'
import { createFilmAgent, type FilmResult } from './film.ts'
import { OpenAICompatibleProvider } from './llm/openai.ts'
import { LocalContext } from './runtime/local.ts'
import { ProfileSchema } from './script/types.ts'

const HELP = `coldopen: turn a company's website into a 30-second personalized film

Usage
  coldopen <url> [options]               make one film
  coldopen batch <prospects.csv> [opts]  one film per row (needs a "url" column)
  coldopen init [file]                   write a profile template to edit

Options
  -p, --profile <file>    who is sending and what they offer (default: profile.json)
  -f, --format <name>     square | landscape | portrait (default: square)
  -o, --out <dir>         output directory (default: ./films)
      --id <slug>         film id; re-running the same id resumes where it stopped
  -c, --concurrency <n>   films rendered in parallel in batch mode (default: 2)
      --model <name>      use an OpenAI-compatible model to write the script
      --base-url <url>    model endpoint (default: http://localhost:11434/v1, Ollama)
      --api-key <key>     model API key (default: $LLM_API_KEY or "ollama")

Without --model the script is written by the deterministic writer: free, offline, reproducible.
With Ollama:  coldopen https://acme.com --model qwen2.5:7b
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    profile: { type: 'string', short: 'p', default: 'profile.json' },
    format: { type: 'string', short: 'f', default: 'square' },
    out: { type: 'string', short: 'o', default: './films' },
    id: { type: 'string' },
    concurrency: { type: 'string', short: 'c', default: '2' },
    model: { type: 'string', default: process.env.LLM_MODEL },
    'base-url': {
      type: 'string',
      default: process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1',
    },
    'api-key': { type: 'string', default: process.env.LLM_API_KEY ?? 'ollama' },
    help: { type: 'boolean', short: 'h' },
  },
})

const tty = process.stderr.isTTY
const status = (line: string) => {
  if (tty) process.stderr.write(`\r\x1b[2K${line}`)
}
const done = (line: string) => process.stderr.write(`${tty ? '\r\x1b[2K' : ''}${line}\n`)

function slugFor(url: string, format: string): string {
  const host = new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '')
  const h = createHash('sha1').update(`${url}|${format}`).digest('hex').slice(0, 6)
  return `${host}-${h}`
}

async function loadProfile(file: string) {
  if (!existsSync(file)) {
    throw new Error(
      `no profile at ${file}. Create one with "coldopen init" or pass --profile <file>.`,
    )
  }
  const parsed = ProfileSchema.safeParse(JSON.parse(await readFile(file, 'utf8')))
  if (!parsed.success) {
    throw new Error(
      `invalid profile ${file}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    )
  }
  return parsed.data
}

async function makeFilm(url: string, opts: { id?: string; quiet?: boolean }): Promise<FilmResult> {
  const profile = await loadProfile(values.profile!)
  const format = values.format as 'square' | 'landscape' | 'portrait'
  if (!['square', 'landscape', 'portrait'].includes(format))
    throw new Error(`unknown format "${format}"`)
  const filmsDir = resolve(values.out!)
  const id = opts.id ?? slugFor(url, format)
  await mkdir(join(filmsDir, id), { recursive: true })

  const llm = values.model
    ? new OpenAICompatibleProvider({
        baseUrl: values['base-url']!,
        model: values.model,
        apiKey: values['api-key']!,
        timeoutMs: 180_000,
      })
    : null
  const ctx = new LocalContext({
    runId: id,
    journalFile: join(filmsDir, id, '.journal.json'),
    llm,
    onLog: (m) => opts.quiet || done(`  ${m}`),
    onProgress: (p) =>
      opts.quiet || status(`  ${p.label}${p.percent !== undefined ? `  ${p.percent}%` : ''}`),
  })
  const resumed = await ctx.load()
  if (resumed && !opts.quiet) done(`  resuming ${id}: ${resumed} finished steps in the journal`)
  const agent = createFilmAgent({ filmsDir, llmModel: llm ? values.model! : null })
  return agent.run(ctx, { url, profile, format })
}

function summary(r: FilmResult, filmsDir: string) {
  const p = (f: string) => join(filmsDir, f)
  const lines = [
    `${r.company} (${r.host}), ${r.durationSec}s ${r.format} film`,
    `  film     ${p(r.files.film)}`,
    `  gif      ${p(r.files.gif)}`,
    `  poster   ${p(r.files.poster)}`,
    `  sheet    ${p(r.files.sheet)}`,
    `  script   ${r.scriptMeta.model}, ${r.scriptMeta.rounds} round(s)${r.scriptMeta.usedFallback ? ', fell back to deterministic writer' : ''}`,
    `  render   ${r.render.frames} frames in ${(r.render.ms / 1000).toFixed(1)}s`,
  ]
  if (r.qa.issues.length)
    lines.push(
      `  qa       ${r.qa.issues.map((i) => `${i.kind}${i.text ? ` "${i.text}"` : ''}`).join(', ')}`,
    )
  return lines.join('\n')
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      if (row.some((c) => c.trim())) rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell)
  if (row.some((c) => c.trim())) rows.push(row)
  const [head, ...body] = rows
  if (!head) return []
  const keys = head.map((h) => h.trim().toLowerCase())
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

async function batch(file: string) {
  const rows = parseCsv(await readFile(file, 'utf8'))
  const withUrl = rows.filter((r) => r.url)
  if (withUrl.length === 0) throw new Error(`${file} has no rows with a "url" column`)
  const filmsDir = resolve(values.out!)
  const conc = Math.max(1, Number(values.concurrency))
  done(`${withUrl.length} prospects, ${conc} at a time`)
  const results: Record<string, string>[] = []
  let next = 0
  let finished = 0
  const workers = Array.from({ length: conc }, async () => {
    while (next < withUrl.length) {
      const row = withUrl[next++]!
      const url = /^https?:\/\//.test(row.url!) ? row.url! : `https://${row.url}`
      try {
        const r = await makeFilm(url, { quiet: true })
        results.push({
          ...row,
          status: 'ok',
          company: r.company,
          film: join(filmsDir, r.files.film),
          gif: join(filmsDir, r.files.gif),
          poster: join(filmsDir, r.files.poster),
        })
        done(`  [${++finished}/${withUrl.length}] ${r.company}`)
      } catch (err) {
        results.push({
          ...row,
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
        })
        done(
          `  [${++finished}/${withUrl.length}] ${url} failed: ${err instanceof Error ? err.message : err}`,
        )
      }
    }
  })
  await Promise.all(workers)
  const cols = [...new Set(results.flatMap((r) => Object.keys(r)))]
  const out = join(filmsDir, 'results.csv')
  await writeFile(
    out,
    [cols.join(','), ...results.map((r) => cols.map((c) => csvCell(r[c] ?? '')).join(','))].join(
      '\n',
    ),
  )
  done(`\nwrote ${out}`)
}

const TEMPLATE = {
  preset: 'sales',
  sender: { name: 'Your Name', company: 'Your Company', role: 'Founder' },
  offer: 'One line: what you offer, in your customer’s terms',
  points: ['A specific benefit, under ten words', 'Another one', 'A third one'],
  proof: [
    { value: '31%', label: 'a real result, with who it was for' },
    { value: '140', label: 'teams using it' },
  ],
  cta: { line: 'Worth a 15-minute look?', contact: 'you@company.com' },
}

async function main() {
  const [cmd, arg] = positionals
  if (values.help || !cmd) {
    process.stdout.write(HELP)
    return
  }
  if (cmd === 'init') {
    const file = arg ?? 'profile.json'
    if (existsSync(file)) throw new Error(`${file} already exists`)
    await writeFile(file, `${JSON.stringify(TEMPLATE, null, 2)}\n`)
    done(`wrote ${file}. Edit it, then: coldopen https://their-company.com`)
    return
  }
  if (cmd === 'batch') {
    if (!arg) throw new Error('usage: coldopen batch prospects.csv')
    await batch(arg)
    return
  }
  const url = /^https?:\/\//.test(cmd) ? cmd : `https://${cmd}`
  const started = Date.now()
  done(`coldopen ${url}`)
  const r = await makeFilm(url, { ...(values.id ? { id: values.id } : {}) })
  done(
    `${summary(r, resolve(values.out!))}\n  total    ${((Date.now() - started) / 1000).toFixed(1)}s`,
  )
}

main()
  .catch((err) => {
    done(`error: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  })
  .finally(() => closeBrowser())
