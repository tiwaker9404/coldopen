/**
 * Quality evals: does coldopen make a film you'd actually send?
 *
 *   node evals/run.ts                       # deterministic writer, all fixture sites
 *   node evals/run.ts --model qwen2.5:7b    # grade a real model's scripts (Ollama by default)
 *
 * Tests check that code works. Evals check that output is good: on-brand, grounded,
 * readable, tasteful. Every check is scored on every fixture site and both presets, and
 * the report is written to evals/results.md so changes can be compared over time.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { serveFixtures } from '../fixtures/serve.ts'
import { contrast, distance, parseColor } from '../src/brand/color.ts'
import { extractBrand } from '../src/brand/extract.ts'
import type { BrandKit } from '../src/brand/types.ts'
import { closeBrowser } from '../src/browser.ts'
import { OpenAICompatibleProvider } from '../src/llm/openai.ts'
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
    out: { type: 'string', default: join(import.meta.dirname, 'results.md') },
  },
})

const DESCRIPTIONS: Record<string, string> = {
  'brand.primary-color': 'Extracted signature color matches the site (OKLab distance under 0.03)',
  'brand.display-font': 'Headline typeface identified, so the film uses their font',
  'brand.name': 'Company name read correctly',
  'brand.logo': 'Logo captured from the header',
  'copy.taste-rules': 'Word limits, no banned phrases, no invented numbers, names the company',
  'copy.no-fallback': 'The model wrote every line itself; no built-in line was swapped in',
  'copy.quote-on-their-site': 'The fact shown on screen appears verbatim on their homepage',
  'copy.uses-a-stat': 'The featured fact is a number, which reads strongest on screen',
  'design.text-contrast': 'Every text color meets WCAG AA (4.5:1) on its background',
  'design.brand-fonts-loaded': "The site's own font files were embedded, not a fallback",
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
const record = (r: Result) => {
  results.push(r)
  process.stdout.write(
    `${r.pass ? '  pass' : '  FAIL'}  ${r.eval.padEnd(26)} ${r.site}/${r.preset}  ${r.pass ? '' : r.detail}\n`,
  )
}

const llm = values.model
  ? new OpenAICompatibleProvider({
      baseUrl: values['base-url']!,
      model: values.model,
      apiKey: values['api-key']!,
      timeoutMs: 180_000,
    })
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

const { server, url } = await serveFixtures()
const writer = llm ? `model ${values.model}` : 'deterministic writer'
console.log(`coldopen evals (${writer})\n`)
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

      // --- copy quality
      const s = await script(kit, profile, `eval_${site}_${preset}`)
      const v = checkScript(s.script, kit, profile)
      record({ ...base, eval: 'copy.taste-rules', pass: v.length === 0, detail: v.join('; ') })
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

      // --- design quality
      const board = buildStoryboard(kit, profile, s.script)
      const theme = await buildTheme(kit, profile)
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
      let deterministic = true
      for (const format of formats) {
        const c = await openComposition(
          compose({ board, kit, theme, format, screenshotDataUrl: shot }),
          format,
        )
        overflow.push(...c.report.issues.map((i) => `${format}: ${i.kind} ${i.text ?? ''}`))
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
writeFileSync(values.out!, `${lines.join('\n')}\n`)
console.log(`\n${passed}/${results.length} passed. Report: ${values.out}`)
process.exit(passed === results.length ? 0 : 1)
