/**
 * Scoring for the résumé-to-profile eval (evals/resume/run.ts).
 *
 * Two questions, both pure functions so the rules are unit-tested without a model:
 * - Does every drafted proof card read well to a stranger? readableProof() on each card,
 *   against the bullet it came from.
 * - On Ashwin's FDE résumé, does the draft say what he would have written himself? Each
 *   hand-checked row (fixtures/profiles/ashwin-fde-expected.json) is matched by meaning to the
 *   drafted card from the same bullet: the value equal or the same change, and the label and
 *   "did" sharing at least half their words.
 */
import type { Entry } from '../../src/profile/parse.ts'
import {
  allowedNumbers,
  CHECKS,
  changeOf,
  numbersIn,
  type ProofCard,
  type ProofCheck,
  readableProof,
} from '../../src/profile/proof.ts'

export interface ExpectedRow extends ProofCard {
  bullet: string
  /** a phrase only the source bullet has */
  from: string
  best?: boolean
}

export interface CardResult {
  card: ProofCard
  /** the bullet it was matched to; null when no bullet has its numbers */
  bullet: string | null
  checks: Record<ProofCheck, boolean>
  problems: string[]
}

export interface RowResult {
  row: ExpectedRow
  drafted: ProofCard | null
  match: boolean
  why: string
}

const STOP = new Set(
  'a an the and or of to in on at for with from by via into a day per its their our from'.split(
    ' ',
  ),
)
/** content words, roughly stemmed: "migrated" and "migration" both count as "migrat" */
export function wordsOf(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/→/g, ' ')
      .split(/[^a-z0-9+#.]+/)
      .map((w) => w.replace(/\.$/, ''))
      .filter((w) => w.length > 1 && !STOP.has(w))
      .map((w) => (w.length > 5 ? w.replace(/(ions?|ing|ed|es|s)$/, '') : w)),
  )
}

/** shared words over the shorter side: 1 when one says everything the other does */
export function overlap(a: string, b: string): number {
  const A = wordsOf(a)
  const B = wordsOf(b)
  if (!A.size || !B.size) return 0
  let n = 0
  for (const w of A) if (B.has(w)) n++
  return n / Math.min(A.size, B.size)
}

/** "6h → 45m" and "6 hours → 45 minutes" are the same change; "1,500+" equals "1,500+" */
export function sameValue(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
  if (norm(a) === norm(b)) return true
  if (a.includes('→') && b.includes('→')) return numbersIn(a).join(',') === numbersIn(b).join(',')
  return false
}

/** the bullet a drafted card came from: one that has all its numbers, sharing most words */
export function sourceOf(card: ProofCard, entries: Entry[]): Entry | null {
  const need = numbersIn(card.value)
  const fits = entries.filter((e) => {
    const ok = allowedNumbers(e.text)
    return need.length > 0 && need.every((n) => ok.has(n))
  })
  const said = `${card.label} ${card.did ?? ''}`
  return fits.sort((a, b) => overlap(said, b.text) - overlap(said, a.text))[0] ?? null
}

export function scoreCards(cards: ProofCard[], entries: Entry[], exclude: string[]): CardResult[] {
  return cards.map((card) => {
    const src = sourceOf(card, entries)
    const r = readableProof(card, src?.text ?? '', { exclude })
    if (!src) {
      r.checks.numbers_from_resume = false
      r.problems.push('no bullet has this number')
    }
    return { card, bullet: src?.text ?? null, checks: r.checks, problems: r.problems }
  })
}

export function scoreRows(rows: ExpectedRow[], results: CardResult[]): RowResult[] {
  return rows.map((row) => {
    const hit = results.find((r) => r.bullet?.includes(row.from))
    if (!hit) return { row, drafted: null, match: false, why: 'not picked' }
    const d = hit.card
    const value = sameValue(d.value, row.value)
    const did = overlap(d.did ?? '', row.did ?? '')
    const label = overlap(d.label, row.label)
    const match = value && did >= 0.5 && label >= 0.5
    const why = match
      ? `did ${did.toFixed(2)}, label ${label.toFixed(2)}`
      : [
          !value && `value "${d.value}" ≠ "${row.value}"`,
          did < 0.5 && `did overlap ${did.toFixed(2)}`,
          label < 0.5 && `label overlap ${label.toFixed(2)}`,
        ]
          .filter(Boolean)
          .join('; ')
    return { row, drafted: d, match, why }
  })
}

/** each check's pass rate over every drafted card */
export function rates(results: CardResult[]): Record<ProofCheck, { pass: number; of: number }> {
  return Object.fromEntries(
    CHECKS.map((c) => [c, { pass: results.filter((r) => r.checks[c]).length, of: results.length }]),
  ) as Record<ProofCheck, { pass: number; of: number }>
}

/** the bullets that give a before and an after, and whether the draft kept both */
export function beforeAfter(
  entries: Entry[],
  results: CardResult[],
): { bullet: string; drafted: string | null; kept: boolean }[] {
  return entries
    .filter((e) => changeOf(e.text))
    .map((e) => {
      const hit = results.find((r) => r.bullet === e.text)
      return {
        bullet: e.text,
        drafted: hit?.card.value ?? null,
        kept: !!hit && hit.checks.keeps_before_after,
      }
    })
}

export const pct = (pass: number, of: number) => (of ? `${Math.round((100 * pass) / of)}%` : '–')
