/**
 * Résumé to profile: does "Start from your résumé" draft proof a stranger understands?
 *
 *   node evals/resume/run.ts                         # the built-in drafter (no model)
 *   node evals/resume/run.ts --model openai/gpt-oss-120b \
 *     --base-url https://api.groq.com/openai/v1 --pace 30 --out resume-eval.md
 *
 * Drafts Ashwin's FDE résumé and the fixture résumés, scores every drafted proof card on
 * readableProof, and on the FDE one matches each card to Ashwin's hand-checked row by meaning.
 * The real-model run happens on GitHub (.github/workflows/resume-eval.yml), which writes the
 * report to the job summary. It is a measurement, not a gate: it exits 0 when targets are
 * missed, and 1 only if the script itself breaks.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { buildLlm } from '../../src/llm/chain.ts'
import { draftProfile } from '../../src/profile/draft.ts'
import { parseResume } from '../../src/profile/parse.ts'
import { CHECKS } from '../../src/profile/proof.ts'
import {
  beforeAfter,
  type CardResult,
  type ExpectedRow,
  pct,
  type RowResult,
  rates,
  scoreCards,
  scoreRows,
} from './score.ts'

const { values } = parseArgs({
  options: {
    model: { type: 'string' },
    'base-url': {
      type: 'string',
      default: process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1',
    },
    'api-key': { type: 'string', default: process.env.LLM_API_KEY ?? 'ollama' },
    out: { type: 'string' },
    /** seconds to wait between résumés, for a free tier's tokens-a-minute limit (Groq: 8k) */
    pace: { type: 'string', default: '0' },
  },
})

const ROOT = join(import.meta.dirname, '../..')
const OUT = values.out ?? join(import.meta.dirname, 'results.md')
const PACE_MS = Math.max(0, Number(values.pace) || 0) * 1000

const expected = JSON.parse(
  readFileSync(join(ROOT, 'fixtures/profiles/ashwin-fde-expected.json'), 'utf8'),
) as { resume: string; role: string; rows: ExpectedRow[] }

const RESUMES = [
  { file: 'ashwin-fde.md', role: expected.role, exclude: [] as string[] },
  { file: 'priya-analyst.md', role: 'Senior data analyst', exclude: [] },
  { file: 'marco-marketer.md', role: 'Growth marketing manager', exclude: [] },
]

const llm = values.model
  ? buildLlm(
      { baseUrl: values['base-url']!, model: values.model, apiKey: values['api-key']! },
      null,
      180_000,
    )
  : null

const cell = (s: string | undefined | null) =>
  (s ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')
const tick = (b: boolean) => (b ? '✓' : '✗')

interface Run {
  file: string
  results: CardResult[]
  ba: ReturnType<typeof beforeAfter>
  rows?: RowResult[]
  meta: { model: string; rounds: number; dropped: string[]; rebuilt: string[]; error?: string }
}

async function main() {
  const runs: Run[] = []
  for (const [i, r] of RESUMES.entries()) {
    if (i && PACE_MS) await new Promise((ok) => setTimeout(ok, PACE_MS))
    const resume = parseResume(
      readFileSync(join(ROOT, 'fixtures/resumes', r.file), 'utf8'),
      r.exclude,
    )
    process.stdout.write(`drafting ${r.file} (${resume.entries.length} bullets)… `)
    const t = Date.now()
    const { profile, meta } = await draftProfile({ resume, role: r.role, exclude: r.exclude, llm })
    // the model failing is a result too: the built-in draft stood in, and the report says so
    if (meta.error) process.stdout.write(`model failed (${meta.error}); built-in draft used. `)
    process.stdout.write(
      `${((Date.now() - t) / 1000).toFixed(1)}s, ${profile.proof.length} cards\n`,
    )
    const results = scoreCards(profile.proof, resume.entries, r.exclude)
    runs.push({
      file: r.file,
      results,
      ba: beforeAfter(resume.entries, results),
      ...(r.file === 'ashwin-fde.md' ? { rows: scoreRows(expected.rows, results) } : {}),
      meta,
    })
  }
  const md = report(runs)
  writeFileSync(OUT, md)
  process.stdout.write(`\n${md}\nwrote ${OUT}\n`)
}

function report(runs: Run[]): string {
  const model = values.model ?? 'built-in drafter (no model)'
  const all = runs.flatMap((r) => r.results)
  const total = rates(all)
  const fde = runs.find((r) => r.file === 'ashwin-fde.md')!
  const best = fde.rows!.filter((r) => r.row.best)
  const bestPicked = best.filter((r) => r.drafted).length
  const fdeBa = fde.ba
  const lines: string[] = [
    '# Résumé eval: proof a stranger understands',
    '',
    `Model: ${model}. ${runs.length} résumés, ${all.length} drafted proof cards.`,
    '',
    ...runs
      .filter((r) => r.meta.error)
      .map(
        (r) =>
          `**${r.file}: the model failed, so these are the built-in drafter's cards.** ${cell(r.meta.error)}\n`,
      ),
    '## Targets',
    '',
    '| Target | Result | |',
    '|---|---|---|',
    ...(['has_action', 'has_result', 'has_where'] as const).map(
      (c) =>
        `| ${c} on every card | ${total[c].pass}/${total[c].of} (${pct(total[c].pass, total[c].of)}) | ${tick(total[c].pass === total[c].of)} |`,
    ),
    `| keeps_before_after on the FDE résumé's ${fdeBa.length} before/after bullets | ${fdeBa.filter((b) => b.kept).length}/${fdeBa.length} | ${tick(fdeBa.every((b) => b.kept))} |`,
    `| best picks chosen (at least 4 of 5) | ${bestPicked}/${best.length} | ${tick(bestPicked >= 4)} |`,
    '',
    '## Every check, per résumé',
    '',
    `| Résumé | Cards | ${CHECKS.join(' | ')} | Rounds | Rebuilt | Dropped |`,
    `|---|---|${CHECKS.map(() => '---').join('|')}|---|---|---|`,
    ...runs.map((r) => {
      const t = rates(r.results)
      return `| ${r.file} | ${r.results.length} | ${CHECKS.map((c) => `${t[c].pass}/${t[c].of}`).join(' | ')} | ${r.meta.rounds} | ${r.meta.rebuilt.length} | ${r.meta.dropped.length} |`
    }),
    `| **all** | ${all.length} | ${CHECKS.map((c) => pct(total[c].pass, total[c].of)).join(' | ')} | | | |`,
    '',
    '## ashwin-fde.md: drafted vs expected',
    '',
    `Matched by meaning: same bullet, value equal or the same change, did and label sharing at least half their words. ${fde.rows!.filter((r) => r.match).length} of ${fde.rows!.length} rows matched; ${fde.rows!.filter((r) => r.drafted).length} picked.`,
    '',
    '| Bullet | Best | Expected | Drafted | Match |',
    '|---|---|---|---|---|',
    ...fde.rows!.map(
      (r) =>
        `| ${cell(r.row.bullet)} | ${r.row.best ? '★' : ''} | **${cell(r.row.value)}** ${cell(r.row.label)}<br>${cell(r.row.did)} · ${cell(r.row.where)} | ${
          r.drafted
            ? `**${cell(r.drafted.value)}** ${cell(r.drafted.label)}<br>${cell(r.drafted.did ?? '(no did)')} · ${cell(r.drafted.where ?? '(no where)')}`
            : '–'
        } | ${r.drafted ? `${tick(r.match)} ${cell(r.why)}` : 'not picked'} |`,
    ),
    '',
    '## Cards that missed a check',
    '',
  ]
  const misses = runs.flatMap((r) =>
    r.results
      .filter((x) => CHECKS.some((c) => !x.checks[c]))
      .map(
        (x) =>
          `- ${r.file}: **${cell(x.card.value)}** ${cell(x.card.label)}: ${cell(x.problems.join('; '))}`,
      ),
  )
  lines.push(...(misses.length ? misses : ['None.']), '')
  return lines.join('\n')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
