/**
 * The fit eval: how often does "this line of your record answers that requirement" match a
 * person's judgment? Scores the keyword matcher (shared words, what fit used first), sentence
 * embeddings, and the two together, on the hand-labeled pairs in pairs.ts.
 *
 *   node evals/fit/run.ts                 # writes evals/fit/results.md and threshold.json
 *
 * Each embedding model's cut-off is picked on half the pairs (best F1) and scored on the other
 * half, so the numbers aren't fit to the very pairs they're reported on. Needs the network once
 * to download the models (a few dozen MB each), then runs from the on-disk cache.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ANSWERED, answers } from '../../src/job/fit.ts'
import { cosine, loadEmbedder } from '../../src/job/semantic.ts'
import { PAIRS, type Pair } from './pairs.ts'

const MODELS = ['Xenova/all-MiniLM-L6-v2', 'Xenova/bge-small-en-v1.5']

interface Score {
  precision: number
  recall: number
  f1: number
  accuracy: number
}

function score(pairs: Pair[], said: boolean[]): Score {
  let tp = 0
  let fp = 0
  let fn = 0
  let right = 0
  pairs.forEach((p, i) => {
    const y = p.answers === 1
    if (said[i] && y) tp++
    if (said[i] && !y) fp++
    if (!said[i] && y) fn++
    if (said[i] === y) right++
  })
  const precision = tp + fp ? tp / (tp + fp) : 0
  const recall = tp + fn ? tp / (tp + fn) : 0
  return {
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    accuracy: right / pairs.length,
  }
}

/** the cut-off with the best F1 on these pairs (ties: the higher one, fewer false matches) */
function pickThreshold(pairs: Pair[], sims: number[]): number {
  let best = { t: 0.5, f1: -1 }
  for (let t = 0.3; t <= 0.95; t += 0.005) {
    const f1 = score(
      pairs,
      sims.map((s) => s >= t),
    ).f1
    if (f1 >= best.f1) best = { t, f1 }
  }
  return Math.round(best.t * 1000) / 1000
}

/** the chance a random answering pair scores above a random non-answering one */
function auc(pairs: Pair[], sims: number[]): number {
  const pos = sims.filter((_, i) => pairs[i]!.answers === 1)
  const neg = sims.filter((_, i) => pairs[i]!.answers === 0)
  let wins = 0
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0
  return wins / (pos.length * neg.length)
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const row = (name: string, s: Score, extra = '') =>
  `| ${name} | ${pct(s.precision)} | ${pct(s.recall)} | ${s.f1.toFixed(2)} | ${pct(s.accuracy)} | ${extra} |`

const pick = PAIRS.filter((_, i) => i % 2 === 0)
const test = PAIRS.filter((_, i) => i % 2 === 1)
const keyword = (ps: Pair[]) => ps.map((p) => answers(p.record, p.requirement))

const started = Date.now()
const rows: string[] = []
const thresholds: Record<string, number> = {}
const misses: string[] = []

const kw = keyword(test)
rows.push(
  row(
    'Shared words (keyword)',
    score(
      test,
      kw.map((s) => s >= ANSWERED),
    ),
    `AUC ${auc(test, kw).toFixed(2)}`,
  ),
)

for (const model of MODELS) {
  const e = await loadEmbedder(model)
  const t0 = Date.now()
  const texts = [...new Set(PAIRS.flatMap((p) => [p.record, p.requirement]))]
  const vs = await e.embed(texts)
  const ms = (Date.now() - t0) / texts.length
  const v = new Map(texts.map((t, i) => [t, vs[i]!]))
  const sims = (ps: Pair[]) => ps.map((p) => cosine(v.get(p.record)!, v.get(p.requirement)!))
  const t = pickThreshold(pick, sims(pick))
  thresholds[model] = t
  const st = sims(test)
  const name = model.split('/')[1]
  rows.push(
    row(
      `${name} (cut-off ${t})`,
      score(
        test,
        st.map((s) => s >= t),
      ),
      `AUC ${auc(test, st).toFixed(2)}, ${ms.toFixed(1)} ms a sentence`,
    ),
  )
  const hybrid = test.map((_, i) => kw[i]! >= ANSWERED || st[i]! >= t)
  rows.push(row(`${name} + keyword`, score(test, hybrid), 'answered if either says so'))
  if (model === MODELS.at(-1))
    test.forEach((p, i) => {
      if (hybrid[i] !== (p.answers === 1))
        misses.push(
          `| ${p.answers ? 'missed' : 'false match'} | ${p.record} | ${p.requirement} | ${st[i]!.toFixed(2)} |`,
        )
    })
}

const out = `# Fit eval

Does "this line of your record answers that requirement" agree with a person's judgment?
${PAIRS.length} hand-labeled pairs (${PAIRS.filter((p) => p.answers).length} that answer, the rest that don't, many of
them sharing words without answering). Each model's cut-off is picked on half the pairs and
scored on the other ${test.length}, so these numbers are out of sample. Ran in ${Math.round((Date.now() - started) / 1000)}s.

| Matcher | Precision | Recall | F1 | Accuracy | Notes |
|---|---:|---:|---:|---:|---|
${rows.join('\n')}

Precision: of the requirements it says you answer, how many you do. Recall: of the ones you
do, how many it finds. coldopen's fit uses whichever of the two reads closer, with the
cut-off above (\`FIT_SEMANTIC=on\`); without it, fit is shared words alone.

## Where the combined matcher (${MODELS.at(-1)!.split('/')[1]}) still disagrees

| | Record | Requirement | Similarity |
|---|---|---|---:|
${misses.join('\n')}

Regenerate: \`node evals/fit/run.ts\`. Labeled set: [pairs.ts](pairs.ts).
`
writeFileSync(join(import.meta.dirname, 'results.md'), out)
writeFileSync(
  join(import.meta.dirname, 'threshold.json'),
  `${JSON.stringify(thresholds, null, 2)}\n`,
)
console.log(out)
