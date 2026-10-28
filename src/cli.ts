#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { extractBrand } from './brand/extract.ts'
import type { BrandKit } from './brand/types.ts'
import { closeBrowser } from './browser.ts'
import { createFilmAgent, type FilmResult } from './film.ts'
import { buildLlm } from './llm/chain.ts'
import { draftProfile } from './profile/draft.ts'
import { rankProfiles } from './profile/match.ts'
import { parseResume } from './profile/parse.ts'
import { resumeText } from './profile/read.ts'
import { LocalContext } from './runtime/local.ts'
import { type Profile, ProfileSchema } from './script/types.ts'

const HELP = `coldopen: turn a company's website into a 30-second personalized film

Usage
  coldopen <url> [options]               make one film
  coldopen batch <prospects.csv> [opts]  one film per row (needs a "url" column)
  coldopen init [file]                   write a profile template to edit
  coldopen profile <resume> [file]       draft a profile from a résumé (PDF, .docx, .md, .txt)

Options
  -p, --profile <path>    who is sending and what they offer (default: profile.json). A folder of
                          profiles (one per résumé) makes coldopen rank them for each company
                          and ask which to use
      --use <name>        with a profile folder: use this profile (file name without .json)
  -y, --yes               with a profile folder: take the best match without asking
  -f, --format <name>     square | landscape | portrait (default: square)
  -o, --out <dir>         output directory (default: ./films)
      --id <slug>         film id; re-running the same id resumes where it stopped
      --proof <list>      which proof items to show, by position in the profile, e.g. 2,4,6
      --role <title>      profile: the role you're applying for; picks the résumé points that fit
      --exclude <names>   profile: comma-separated employers or words to leave out entirely
      --contact <email>   profile: the contact line for the film (default: the résumé's email)
  -c, --concurrency <n>   films rendered in parallel in batch mode (default: 2)
      --model <name>      use an OpenAI-compatible model to write the script
      --base-url <url>    model endpoint (default: http://localhost:11434/v1, Ollama)
      --api-key <key>     model API key. Prefer setting $LLM_API_KEY: a key on the
                          command line is echoed by pnpm and saved in shell history

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
    proof: { type: 'string' },
    role: { type: 'string' },
    use: { type: 'string' },
    yes: { type: 'boolean', short: 'y' },
    exclude: { type: 'string' },
    contact: { type: 'string' },
    concurrency: { type: 'string', short: 'c', default: '2' },
    model: { type: 'string', default: process.env.LLM_MODEL },
    'base-url': {
      type: 'string',
      default: process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1',
    },
    'api-key': { type: 'string', default: process.env.LLM_API_KEY ?? 'ollama' },
    'fallback-model': { type: 'string', default: process.env.LLM_FALLBACK_MODEL },
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

/** One profile file, or every *.json in a folder (one per résumé), named by file. */
async function loadProfiles(path: string): Promise<{ id: string; profile: Profile }[]> {
  if (existsSync(path) && statSync(path).isDirectory()) {
    const files = readdirSync(path)
      .filter((f) => f.endsWith('.json'))
      .sort()
    if (!files.length) throw new Error(`no .json profiles in ${path}`)
    return Promise.all(
      files.map(async (f) => ({
        id: basename(f, '.json').replace(/\.local$/, ''),
        profile: await loadProfile(join(path, f)),
      })),
    )
  }
  return [{ id: basename(path, '.json'), profile: await loadProfile(path) }]
}

/** Rank the profiles against the company's site, then confirm with the person (or not). */
async function chooseProfile(
  kit: BrandKit,
  profiles: { id: string; profile: Profile }[],
  opts: { use?: string; quiet?: boolean },
): Promise<{ id: string; profile: Profile }> {
  const ranked = rankProfiles(kit, profiles)
  const named = opts.use ?? values.use
  if (named) {
    const hit = profiles.find((p) => p.id === named)
    if (!hit)
      throw new Error(`no profile named "${named}"; have: ${profiles.map((p) => p.id).join(', ')}`)
    return hit
  }
  const best = ranked[0]!
  const why = (m: (typeof ranked)[number]) =>
    m.score < 3
      ? `weak match${m.reasons.length ? `: ${m.reasons.slice(0, 3).join(', ')}` : ''}`
      : `their site mentions ${m.reasons.slice(0, 4).join(', ')}`
  if (opts.quiet || values.yes || !process.stdin.isTTY) {
    if (!opts.quiet) done(`  profile  ${best.id} (best match: ${why(best)})`)
    return best
  }
  done(`\n  Which profile for ${kit.name}?`)
  for (const [i, m] of ranked.entries())
    done(
      `  ${String(i + 1).padStart(2)}. ${m.id.padEnd(10)} ${(m.profile.sender.role ?? '').padEnd(28).slice(0, 28)} ${i === 0 ? '<- best: ' : ''}${why(m)}`,
    )
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  const answer = (await rl.question(`  Choose 1-${ranked.length} [1]: `)).trim()
  rl.close()
  const pick = ranked[(Number.parseInt(answer, 10) || 1) - 1] ?? best
  done(`  profile  ${pick.id}`)
  return pick
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

function modelFromFlags() {
  return values.model
    ? buildLlm(
        { baseUrl: values['base-url']!, model: values.model, apiKey: values['api-key']! },
        values['fallback-model']
          ? {
              model: values['fallback-model'],
              baseUrl: process.env.LLM_FALLBACK_BASE_URL,
              apiKey: process.env.LLM_FALLBACK_API_KEY,
            }
          : null,
        180_000,
      )
    : null
}

async function makeFilm(
  url: string,
  opts: { id?: string; quiet?: boolean; use?: string },
): Promise<FilmResult> {
  const profiles = await loadProfiles(values.profile!)
  const format = values.format as 'square' | 'landscape' | 'portrait'
  if (!['square', 'landscape', 'portrait'].includes(format))
    throw new Error(`unknown format "${format}"`)
  const filmsDir = resolve(values.out!)

  // several profiles: read the site once, pick the profile that fits, and seed the film's
  // journal with that research so the film doesn't load the site again
  let chosen = profiles[0]!
  let seed: BrandKit | null = null
  if (profiles.length > 1) {
    const researchDir = join(filmsDir, '.research', slugFor(url, 'site'))
    const cached = join(researchDir, 'kit.json')
    if (!opts.quiet) status(`  reading ${new URL(url).hostname} to match a profile`)
    seed = existsSync(cached)
      ? (JSON.parse(await readFile(cached, 'utf8')) as BrandKit)
      : await extractBrand(url, { outDir: researchDir, allowPrivateNetworks: true })
    chosen = await chooseProfile(seed, profiles, opts)
  }
  const profile = chosen.profile
  // the profile is part of a film's identity: the same company with another profile is another film
  const id = opts.id ?? `${slugFor(url, format)}${profiles.length > 1 ? `-${chosen.id}` : ''}`
  await mkdir(join(filmsDir, id), { recursive: true })
  const journal = join(filmsDir, id, '.journal.json')
  if (seed && !existsSync(journal)) {
    await copyFile(
      join(filmsDir, '.research', slugFor(url, 'site'), seed.screenshot.file),
      join(filmsDir, id, seed.screenshot.file),
    )
    await writeFile(join(filmsDir, id, 'kit.json'), JSON.stringify(seed, null, 2))
    await writeFile(journal, JSON.stringify({ research: seed }))
  }

  const llm = modelFromFlags()
  const ctx = new LocalContext({
    runId: id,
    journalFile: journal,
    llm,
    onLog: (m) => opts.quiet || done(`  ${m}`),
    onProgress: (p) =>
      opts.quiet || status(`  ${p.label}${p.percent !== undefined ? `  ${p.percent}%` : ''}`),
  })
  const resumed = await ctx.load()
  if (resumed && !opts.quiet) done(`  resuming ${id}: ${resumed} finished steps in the journal`)
  // a film first written by a model must be resumed with a model, or its script would be
  // silently replaced by the built-in writer's
  if (!llm && ctx.journaled.some((k) => /^script-\d+$/.test(k))) {
    throw new Error(
      `${id} was written by a model. Re-run with --model (and the same LLM_BASE_URL) to keep its script; the saved drafts are reused, not regenerated`,
    )
  }
  // a local tool: researching localhost or an intranet site is the user's own business
  const agent = createFilmAgent({
    filmsDir,
    llmModel: llm ? values.model! : null,
    allowPrivateNetworks: true,
  })
  const proof = values.proof
    ?.split(',')
    .map((x) => Number.parseInt(x.trim(), 10) - 1)
    .filter((x) => x >= 0)
  return agent.run(ctx, { url, profile, format, ...(proof?.length ? { proof } : {}) })
}

function summary(r: FilmResult, filmsDir: string) {
  const p = (f: string) => join(filmsDir, f)
  const lines = [
    `${r.company} (${r.host}), ${r.durationSec}s ${r.format} film`,
    `  film     ${p(r.files.film)}`,
    `  gif      ${p(r.files.gif)}`,
    `  poster   ${p(r.files.poster)}`,
    `  sheet    ${p(r.files.sheet)}`,
    `  script   ${r.scriptMeta.model}, ${r.scriptMeta.rounds} round(s)${r.scriptMeta.usedFallback ? ', fell back to deterministic writer' : r.scriptMeta.replaced?.length ? `, built-in lines for ${r.scriptMeta.replaced.join(', ')}` : ''}`,
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
        const r = await makeFilm(url, { quiet: true, ...(row.profile ? { use: row.profile } : {}) })
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
  if (cmd === 'profile') {
    if (!arg)
      throw new Error('usage: coldopen profile resume.pdf [profile.json] --role "Data analyst"')
    const out = positionals[2] ?? 'profile.json'
    if (existsSync(out)) throw new Error(`${out} already exists; pass another file name`)
    const role = values.role ?? 'the role I want'
    const exclude = (values.exclude ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    const resume = parseResume(await resumeText(new Uint8Array(await readFile(arg)), arg), exclude)
    if (resume.unmatchedExcludes.length)
      throw new Error(
        `--exclude "${resume.unmatchedExcludes.join('", "')}" doesn't appear anywhere in ${arg}, so nothing would be left out. Use the name exactly as the résumé writes it`,
      )
    done(
      `  reading ${resume.entries.length} résumé bullets${exclude.length ? `, leaving out ${exclude.join(', ')}` : ''}`,
    )
    const { profile, meta } = await draftProfile({
      resume,
      role,
      exclude,
      llm: modelFromFlags(),
      ...(values.contact ? { contact: values.contact } : {}),
    })
    await writeFile(out, `${JSON.stringify(profile, null, 2)}\n`)
    done(`wrote ${out} for ${profile.sender.role ?? role}`)
    done(
      `  ${profile.proof.length} proof points, ${profile.points.length} strengths (${meta.model}${meta.rounds > 1 ? `, ${meta.rounds} rounds` : ''})`,
    )
    for (const [i, p] of profile.proof.entries())
      done(
        `  ${String(i + 1).padStart(2)}. ${p.value.padEnd(12)} ${p.label}${p.where ? `  (${p.where})` : ''}`,
      )
    if (meta.dropped.length)
      done(`  left out, not grounded in the résumé: ${meta.dropped.join(', ')}`)
    done(`Check every line, then: coldopen https://their-company.com -p ${out} --proof 1,2,3`)
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
