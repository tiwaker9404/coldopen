/**
 * Quality evals: does coldopen make a film you'd actually send?
 *
 *   node evals/run.ts                       # deterministic writer, all fixture sites
 *   node evals/run.ts --model qwen2.5:7b    # grade a real model's scripts (Ollama by default)
 *   node evals/run.ts --only messages --model openai/gpt-oss-120b \
 *     --base-url https://api.groq.com/openai/v1 --pace 40 --out messages.md
 *                                           # only the message drafts, against a real model
 *
 * Tests check that code works. Evals check that output is good: on-brand, grounded,
 * readable, tasteful. Every check is scored on every fixture site and both presets, and
 * the report is written to evals/results.md so changes can be compared over time.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { serveFixtures } from '../fixtures/serve.ts'
import { contrast, distance, parseColor } from '../src/brand/color.ts'
import { extractBrand } from '../src/brand/extract.ts'
import { type Homework, parseFeed, pickResearch } from '../src/brand/homework.ts'
import type { BrandKit } from '../src/brand/types.ts'
import { closeBrowser } from '../src/browser.ts'
import { buildLlm } from '../src/llm/chain.ts'
import { LlmHttpError } from '../src/llm/openai.ts'
import { ScriptedProvider } from '../src/llm/scripted.ts'
import { openerFor } from '../src/outreach/messages.ts'
import {
  assemble,
  briefFor,
  DRAFTS,
  FILM,
  type FilmMessages,
  MessagesSchema,
  type ModelMessages,
  scriptedMessages,
  type WrittenDraft,
  writeMessages,
} from '../src/outreach/writer.ts'
import { compose, type Format } from '../src/render/composition.ts'
import { openComposition, seek } from '../src/render/render.ts'
import { buildTheme } from '../src/render/theme.ts'
import { LocalContext } from '../src/runtime/local.ts'
import { checkScript } from '../src/script/checks.ts'
import { buildStoryboard } from '../src/script/storyboard.ts'
import { type Profile, ProfileSchema, type Script, ScriptSchema } from '../src/script/types.ts'
import { deterministicScript, writeScript } from '../src/script/writer.ts'

const { values } = parseArgs({
  options: {
    model: { type: 'string' },
    'base-url': {
      type: 'string',
      default: process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1',
    },
    'api-key': { type: 'string', default: process.env.LLM_API_KEY ?? 'ollama' },
    'fallback-model': { type: 'string', default: process.env.LLM_FALLBACK_MODEL },
    out: { type: 'string' },
    /** `messages`: only the message drafts (no brand, copy or design checks, no rendering) */
    only: { type: 'string' },
    /** seconds to wait between films, for a free tier's tokens-a-minute limit (Groq: 8k) */
    pace: { type: 'string', default: '0' },
  },
})
const messagesOnly = values.only === 'messages'
if (values.only && !messagesOnly) {
  console.error(`--only takes "messages", not "${values.only}"`)
  process.exit(2)
}
// the full report is tracked in the repo; a messages-only run is a measurement, written elsewhere
const OUT =
  values.out ?? join(import.meta.dirname, messagesOnly ? 'messages-results.md' : 'results.md')
const PACE_MS = Math.max(0, Number(values.pace) || 0) * 1000

const DESCRIPTIONS: Record<string, string> = {
  'brand.primary-color': 'Extracted signature color matches the site (OKLab distance under 0.03)',
  'brand.display-font': 'Headline typeface identified, so the film uses their font',
  'brand.name': 'Company name read correctly',
  'brand.logo': 'Logo captured from the header',
  'copy.taste-rules': 'Word limits, no banned phrases, no invented numbers, names the company',
  'copy.no-fallback': 'The model wrote every line itself; no built-in line was swapped in',
  'copy.quote-on-their-site': 'The fact shown on screen appears verbatim on their homepage',
  'copy.uses-a-stat': 'The featured fact is a number, which reads strongest on screen',
  'messages.first-try':
    'Each message draft (note, after accept, InMail, email) passed every check on the first try',
  'messages.no-fallback': "Each message draft kept the writer's own words; no template swapped in",
  'design.text-contrast': 'Every text color meets WCAG AA (4.5:1) on its background',
  'design.brand-fonts-loaded': "The site's own font files were embedded, not a fallback",
  'copy.varied': 'No two companies get the same greeting or the same pivot line',
  'design.headline-framed':
    'Their headline sits fully in frame, with a 4% margin, when the homepage zoom settles, in square, wide and tall',
  'design.no-text-overflow':
    'No line overflows or breaks its line budget, in square, wide and tall',
  'motion.frame-exact-seek': 'Any frame can be re-rendered pixel-identical (crash-safe rendering)',
}

const ROOT = join(import.meta.dirname, '..')
const expected = JSON.parse(readFileSync(join(ROOT, 'fixtures/expected.json'), 'utf8')) as Record<
  string,
  { name: string; primary: string; display: string; logo: boolean }
>
const profiles: Record<string, Profile> = {
  sales: ProfileSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'profiles/sales.example.json'), 'utf8')),
  ),
  candidate: ProfileSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'profiles/candidate.example.json'), 'utf8')),
  ),
}

interface Result {
  eval: string
  site: string
  preset: string
  pass: boolean
  detail: string
}
const results: Result[] = []
/** each film's greeting and pivot, to check that two companies don't read as one template */
const lines_: { site: string; preset: string; hook: string; why: string }[] = []
const record = (r: Result) => {
  results.push(r)
  process.stdout.write(
    `${r.pass ? '  pass' : '  FAIL'}  ${r.eval.padEnd(26)} ${r.site}/${r.preset}  ${r.pass ? '' : r.detail}\n`,
  )
}

const llm = values.model
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

async function script(
  kit: BrandKit,
  profile: Profile,
  id: string,
): Promise<{ script: Script; rounds: number; fallback: boolean; replaced: string[] }> {
  if (!llm)
    return { script: deterministicScript(kit, profile), rounds: 1, fallback: false, replaced: [] }
  const ctx = new LocalContext({ runId: id, llm })
  const r = await writeScript({
    kit,
    profile,
    model: values.model!,
    complete: (key, messages) => ctx.llm(key, { schema: ScriptSchema, messages }),
  })
  return {
    script: r.script,
    rounds: r.meta.rounds,
    fallback: r.meta.usedFallback,
    replaced: r.meta.replaced,
  }
}

/**
 * Homework for the messages eval: each fixture site's own feed, read directly and picked on a
 * pinned day, because their dates are fixed (none is linked from its fixture site, on purpose).
 * Each site gets its own posts, so a research line is always about the company it's sent to.
 */
const FEEDS: Record<string, { file: string; kind: 'changelog' | 'blog' }> = {
  parcelpine: { file: 'parcelpine/changelog.xml', kind: 'changelog' },
  northwind: { file: 'northwind/changelog.xml', kind: 'changelog' },
  lumen: { file: 'lumen/blog.xml', kind: 'blog' },
}
const homeworkFor = (site: string): Homework => {
  const feed = FEEDS[site]
  if (!feed) throw new Error(`no fixture feed for ${site}; add one to FEEDS`)
  return {
    items: parseFeed(
      readFileSync(join(ROOT, 'fixtures/sites', feed.file), 'utf8'),
      'http://127.0.0.1/',
    ).map((i) => ({ kind: feed.kind, ...i })),
    pages: [],
  }
}
const MESSAGES_NOW = Date.parse('2026-11-03T12:00:00Z')

/** per draft kind: how many passed on the first try, and how many fell back to the template */
const byDraft = new Map<string, { first: number; fallback: number; total: number }>()

/** what each film's messages did, for the messages report */
interface MessageRun {
  film: string
  m: FilmMessages
  /** the reasons drafts were sent back after the first try, as the rewrite request listed them */
  sentBack: { draft: string; why: string }[]
  /** the model's own drafts from its last reply, assembled as they'd be sent */
  modelDrafts: ReturnType<typeof assemble> | null
}
const runs: MessageRun[] = []
/** films whose messages couldn't be measured (the model was unavailable after a retry) */
const unmeasured: { film: string; why: string }[] = []

const isRateLimit = (e: unknown) =>
  (e instanceof LlmHttpError && e.status === 429) || /\bHTTP 429\b/.test(String(e))

async function messages(
  kit: BrandKit,
  profile: Profile,
  s: Script,
  homework: Homework | null,
  id: string,
): Promise<Omit<MessageRun, 'film'>> {
  const board = buildStoryboard(kit, profile, s)
  const insight = board.scenes.find((x) => x.kind === 'insight')
  const proof = board.scenes.find((x) => x.kind === 'proof')
  const film = {
    company: kit.name,
    script: s,
    highlights: {
      quote:
        insight?.kind === 'insight'
          ? { text: insight.text, source: insight.source }
          : { text: '', source: '' },
      proof: proof?.kind === 'proof' ? proof.stats : [],
    },
  }
  const opener = openerFor(id)
  const item = homework ? pickResearch(homework, { points: profile.points }, MESSAGES_NOW) : null
  // without --model, the built-in stand-in answers through ScriptedProvider, as a model would
  const provider =
    llm ??
    new ScriptedProvider(
      () => JSON.stringify(scriptedMessages(briefFor(film, profile, item, opener))),
      [0, 1],
    )
  const attempt = async () => {
    const ctx = new LocalContext({ runId: id, llm: provider })
    const sentBack: MessageRun['sentBack'] = []
    let last: ModelMessages | null = null
    const m = await writeMessages({
      film,
      profile,
      homework,
      opener,
      model: values.model ?? 'scripted-v1',
      now: MESSAGES_NOW,
      complete: async (key, msgs) => {
        // the rewrite request lists each problem as "- draft: why"
        if (key === 'messages-2')
          for (const line of (msgs.at(-1)?.content ?? '').split('\n')) {
            const hit = line.match(/^- (\w+): (.+)$/)
            if (hit) sentBack.push({ draft: hit[1]!, why: hit[2]! })
          }
        last = await ctx.llm(key, { schema: MessagesSchema, messages: msgs })
        return last
      },
    })
    // the shape writeMessages assembled with: the opener it settled on, and research when picked
    const shape = { opener: briefFor(film, profile, item, opener).opener, research: !!item }
    const reply = last as ModelMessages | null
    return { m, sentBack, modelDrafts: reply ? assemble(reply, film, profile, FILM, shape) : null }
  }
  try {
    return await attempt()
  } catch (e) {
    if (!isRateLimit(e)) throw e
    // a free tier's minute ran out despite the pacing: wait a full minute, then once more
    console.log(`  rate limited on ${id}; waiting 60s and retrying once`)
    await sleep(60_000)
    return attempt()
  }
}

const { server, url } = await serveFixtures()
const writer = llm ? `model ${values.model}` : 'deterministic writer'
console.log(`coldopen evals (${writer}${messagesOnly ? ', messages only' : ''})\n`)
let films = 0
const started = Date.now()

try {
  for (const site of Object.keys(expected)) {
    const want = expected[site]!
    const dir = join(ROOT, '.scratch', 'evals', site)
    const kit = await extractBrand(`${url}/${site}/`, { outDir: dir, allowPrivateNetworks: true })
    const html = readFileSync(join(ROOT, 'fixtures/sites', site, 'index.html'), 'utf8')
    const pageText = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')

    for (const preset of ['sales', 'candidate'] as const) {
      const profile = profiles[preset]!
      const base = { site, preset }

      if (!messagesOnly) {
        // --- brand fidelity
        const dE = distance(parseColor(kit.colors.primary)!, parseColor(want.primary)!)
        record({
          ...base,
          eval: 'brand.primary-color',
          pass: dE < 0.03,
          detail: `${kit.colors.primary} vs ${want.primary}`,
        })
        record({
          ...base,
          eval: 'brand.display-font',
          pass: kit.fonts.display.family === want.display,
          detail: kit.fonts.display.family,
        })
        record({ ...base, eval: 'brand.name', pass: kit.name === want.name, detail: kit.name })
        record({
          ...base,
          eval: 'brand.logo',
          pass: Boolean(kit.logo) === want.logo,
          detail: kit.logo ? 'captured' : 'missing',
        })
      }

      // --- copy quality. A messages-only run keeps the model's minute for the messages, so the
      // film's script comes from the built-in writer (the same one every time)
      const s = messagesOnly
        ? { script: deterministicScript(kit, profile), rounds: 1, fallback: false, replaced: [] }
        : await script(kit, profile, `eval_${site}_${preset}`)
      if (!messagesOnly) {
        const v = checkScript(s.script, kit, profile)
        record({ ...base, eval: 'copy.taste-rules', pass: v.length === 0, detail: v.join('; ') })
        lines_.push({ site, preset, hook: s.script.hook, why: s.script.insight.why })
        record({
          ...base,
          eval: 'copy.no-fallback',
          pass: !s.fallback && s.replaced.length === 0,
          detail: s.fallback
            ? 'model never complied; deterministic fallback used'
            : `built-in lines swapped in for: ${s.replaced.join(', ')}`,
        })
        const fact = kit.facts.find((f) => f.id === s.script.insight.factId)
        const norm = (x: string) => x.replace(/[“”"]/g, '').replace(/\s+/g, ' ').toLowerCase()
        record({
          ...base,
          eval: 'copy.quote-on-their-site',
          pass: Boolean(fact) && norm(pageText).includes(norm(fact!.text).slice(0, 60)),
          detail: fact?.text ?? 'no fact',
        })
        record({
          ...base,
          eval: 'copy.uses-a-stat',
          pass: fact?.kind === 'stat',
          detail: `featured a ${fact?.kind} fact; numbers land harder`,
        })
      }

      // --- the messages that carry the film, with and without the site's own latest posts
      for (const homework of [null, homeworkFor(site)]) {
        const filmId = `eval_${site}_${preset}_${homework ? 'research' : 'plain'}`
        if (PACE_MS && films++) await sleep(PACE_MS)
        let run: Omit<MessageRun, 'film'>
        try {
          run = await messages(kit, profile, s.script, homework, filmId)
        } catch (e) {
          // still unavailable after the retry: say so, rather than count it against the model
          if (!llm || !isRateLimit(e)) throw e
          unmeasured.push({ film: filmId, why: String(e).slice(0, 160) })
          continue
        }
        runs.push({ film: filmId, ...run })
        const { m } = run
        const tag = homework ? 'with research' : 'no research'
        for (const d of DRAFTS) {
          const first = m.firstTry.includes(d)
          const fell = m.writer[d] === 'template'
          const t = byDraft.get(d) ?? { first: 0, fallback: 0, total: 0 }
          byDraft.set(d, {
            first: t.first + Number(first),
            fallback: t.fallback + Number(fell),
            total: t.total + 1,
          })
          const why = (m.flags[d] ?? []).map((c) => c.why).join('; ')
          record({ ...base, eval: 'messages.first-try', pass: first, detail: `${d}, ${tag}` })
          record({
            ...base,
            eval: 'messages.no-fallback',
            pass: !fell,
            detail: `${d}, ${tag}: ${why}`,
          })
        }
      }

      if (messagesOnly) continue

      // --- design quality
      const board = buildStoryboard(kit, profile, s.script)
      const theme = await buildTheme(kit, profile, { allowPrivateNetworks: true })
      const fields = [theme.dark, theme.light, theme.brand]
      const rgb = (h: string) => parseColor(h)!
      const worst = Math.min(...fields.map((f) => contrast(rgb(f.fg), rgb(f.bg))))
      record({
        ...base,
        eval: 'design.text-contrast',
        pass: worst >= 4.5,
        detail: `worst ${worst.toFixed(2)}:1`,
      })
      record({
        ...base,
        eval: 'design.brand-fonts-loaded',
        pass: theme.fontsEmbedded.display,
        detail: 'fell back to bundled font',
      })

      const shot = `data:image/jpeg;base64,${readFileSync(join(dir, kit.screenshot.file)).toString('base64')}`
      const formats: Format[] = ['square', 'landscape', 'portrait']
      const overflow: string[] = []
      const framed: string[] = []
      let deterministic = true
      for (const format of formats) {
        const c = await openComposition(
          compose({ board, kit, theme, format, screenshotDataUrl: shot }),
          format,
        )
        overflow.push(...c.report.issues.map((i) => `${format}: ${i.kind} ${i.text ?? ''}`))
        const margin = c.report.frame?.margin ?? -1
        if (margin < 0.04 - 1e-6) framed.push(`${format}: margin ${(margin * 100).toFixed(1)}%`)
        if (format === 'square') {
          // seeking is exact: the same timestamp always produces the same pixels
          const frame = async (t: number) => {
            await seek(c.page, t)
            return createHash('sha1')
              .update(await c.page.screenshot({ type: 'png' }))
              .digest('hex')
          }
          const a = await frame(7.3)
          await frame(20.1)
          deterministic = a === (await frame(7.3))
        }
        await c.close()
      }
      record({
        ...base,
        eval: 'design.no-text-overflow',
        pass: overflow.length === 0,
        detail: overflow.join('; '),
      })
      record({
        ...base,
        eval: 'design.headline-framed',
        pass: framed.length === 0,
        detail: framed.join('; '),
      })
      record({
        ...base,
        eval: 'motion.frame-exact-seek',
        pass: deterministic,
        detail: 'same time, different pixels',
      })
    }
  }
} finally {
  await closeBrowser()
  server.close()
}

/** Per draft kind: first-try pass, fallback, average rounds, and why drafts failed */
function messagesReport(): string[] {
  const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a')
  // a draft takes one round when it passes first, two when it's sent back
  const table = DRAFTS.map((d) => {
    const n = runs.length
    const first = runs.filter((r) => r.m.firstTry.includes(d)).length
    const fell = runs.filter((r) => r.m.writer[d] === 'template').length
    const rounds = runs.reduce((sum, r) => sum + (r.m.firstTry.includes(d) ? 1 : 2), 0)
    return `| ${d} | ${first}/${n} (${pct(first, n)}) | ${fell}/${n} (${pct(fell, n)}) | ${n ? (rounds / n).toFixed(2) : 'n/a'} |`
  })
  // numbers vary from draft to draft ("131 of 125 words"), so they're grouped as N
  const top = (lines: { draft: string; why: string }[]) => {
    const counts = new Map<string, { n: number; example: string }>()
    for (const l of lines) {
      const key = `${l.draft}: ${l.why.replace(/\d+/g, 'N')}`
      const c = counts.get(key) ?? { n: 0, example: `${l.draft}: ${l.why}` }
      counts.set(key, { ...c, n: c.n + 1 })
    }
    return [...counts]
      .sort((x, y) => y[1].n - x[1].n)
      .slice(0, 10)
      .map(([, c]) => `| ${c.n} | ${c.example.replaceAll('|', '\\|')} |`)
  }
  const sentBack = runs.flatMap((r) => r.sentBack)
  const fellBack = runs.flatMap((r) =>
    Object.entries(r.m.flags).flatMap(([d, cs]) =>
      (cs ?? []).map((c) => ({ draft: d, why: c.why ?? c.rule })),
    ),
  )
  const show = (t: string | { subject: string; body: string }) =>
    typeof t === 'string' ? t : `Subject: ${t.subject}\n\n${t.body}`
  const fence = (t: string) => ['```', t, '```']
  // one draft the model got right first time, two it didn't, each with why
  const passedOne = runs
    .flatMap((r) => DRAFTS.filter((d) => r.m.firstTry.includes(d)).map((d) => ({ r, d })))
    .sort((x, y) => (x.d === 'email' ? -1 : 0) - (y.d === 'email' ? -1 : 0))[0]
  const fellBackTwo: { r: MessageRun; d: WrittenDraft }[] = []
  for (const r of runs)
    for (const d of DRAFTS)
      if (r.m.writer[d] === 'template' && !fellBackTwo.some((x) => x.d === d))
        fellBackTwo.push({ r, d })
  const examples = [
    ...(passedOne
      ? [
          `### Passed on the first try: ${passedOne.d}, ${passedOne.r.film}`,
          '',
          ...fence(show(passedOne.r.m.drafts[passedOne.d])),
          '',
        ]
      : ['No draft passed on the first try.', '']),
    ...fellBackTwo
      .slice(0, 2)
      .flatMap(({ r, d }) => [
        `### Fell back to the template: ${d}, ${r.film}`,
        '',
        "The model's last draft:",
        '',
        ...fence(r.modelDrafts ? show(r.modelDrafts[d]) : '(no reply)'),
        '',
        'Why:',
        ...(r.m.flags[d] ?? []).map((c) => `- ${c.rule}: ${c.why ?? ''}`),
        '',
      ]),
    ...(fellBackTwo.length ? [] : ['No draft fell back to its template.', '']),
  ]
  return [
    `# Messages eval: ${writer}`,
    '',
    `${runs.length} films (3 fixture sites, the candidate and sales profiles, with and without their latest post), ${DRAFTS.length} drafts each. The films' scripts come from the built-in writer, so only the messages use the model. Ran in ${Math.round((Date.now() - started) / 1000)}s.${unmeasured.length ? ` ${unmeasured.length} films couldn't be measured: ${unmeasured.map((u) => u.film).join(', ')}.` : ''}`,
    '',
    '| Draft | Passed on the first try | Fell back to the template | Average rounds |',
    '|---|---:|---:|---:|',
    ...table,
    '',
    `Films that needed a second round: ${runs.filter((r) => r.m.rounds > 1).length}/${runs.length}.`,
    '',
    '## Why drafts were sent back after the first try',
    '',
    ...(sentBack.length ? ['| Count | Draft: why |', '|---:|---|', ...top(sentBack)] : ['None.']),
    '',
    '## Why drafts fell back to the template (after the rewrite)',
    '',
    ...(fellBack.length ? ['| Count | Draft: why |', '|---:|---|', ...top(fellBack)] : ['None.']),
    '',
    // which post each email's research line is about: each site's own, never another company's
    '## Research lines',
    '',
    ...(() => {
      const rows = runs
        .filter((r) => r.m.research)
        .map(
          (r) =>
            `| ${r.film} | ${new URL(r.m.research!.itemUrl).pathname} | ${r.m.writer.email} | ${r.m.research!.line.replaceAll('|', '\\|')} |`,
        )
      return rows.length
        ? ['| Film | Post | Email written by | Line |', '|---|---|---|---|', ...rows]
        : ['None.']
    })(),
    '',
    '## Example drafts',
    '',
    ...examples,
  ]
}

if (messagesOnly) {
  const lines = messagesReport()
  writeFileSync(OUT, `${lines.join('\n')}\n`)
  console.log(`\n${runs.length} films measured. Report: ${OUT}`)
  // a real model's misses are the measurement, not a failure; nothing measured is
  process.exit(runs.length ? 0 : 1)
}

// across companies, per preset: the same greeting or pivot twice means the film reads as a template
for (const l of lines_) {
  const others = lines_.filter((o) => o.preset === l.preset && o.site !== l.site)
  const same = [
    ...(others.some((o) => o.hook === l.hook) ? [`greeting "${l.hook}"`] : []),
    ...(others.some((o) => o.why === l.why) ? [`pivot "${l.why}"`] : []),
  ]
  record({
    site: l.site,
    preset: l.preset,
    eval: 'copy.varied',
    pass: same.length === 0,
    detail: `shares its ${same.join(' and ')} with another company`,
  })
}

const evals = [...new Set(results.map((r) => r.eval))]
const passed = results.filter((r) => r.pass).length
const lines = [
  `# coldopen evals`,
  '',
  `${passed}/${results.length} checks passed across ${evals.length} evals, ${new Set(results.map((r) => r.site)).size} sites and 2 presets, using the ${writer}. Ran in ${Math.round((Date.now() - started) / 1000)}s.`,
  '',
  '| Eval | Passed | What it checks |',
  '|---|---:|---|',
  ...evals.map((e) => {
    const rs = results.filter((r) => r.eval === e)
    return `| \`${e}\` | ${rs.filter((r) => r.pass).length}/${rs.length} | ${DESCRIPTIONS[e] ?? ''} |`
  }),
  '',
  '## Messages by draft',
  '',
  '| Draft | Passed on the first try | Fell back to the template |',
  '|---|---:|---:|',
  ...[...byDraft].map(
    ([d, t]) =>
      `| ${d} | ${t.first}/${t.total} (${Math.round((100 * t.first) / t.total)}%) | ${t.fallback}/${t.total} (${Math.round((100 * t.fallback) / t.total)}%) |`,
  ),
  '',
  ...(results.some((r) => !r.pass)
    ? [
        '## Failures',
        '',
        ...results
          .filter((r) => !r.pass)
          .map((r) => `- \`${r.eval}\` on ${r.site}/${r.preset}: ${r.detail}`),
      ]
    : []),
]
writeFileSync(OUT, `${lines.join('\n')}\n`)
console.log(`\n${passed}/${results.length} passed. Report: ${OUT}`)
process.exit(passed === results.length ? 0 : 1)
