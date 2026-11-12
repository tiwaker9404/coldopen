/**
 * The judged eval's two files. judge-summary.md: the averages per line and the yes rates against
 * this batch's targets, and, for each line under target, its two weakest drafts. judge-review.md:
 * every draft and every film's lines in full, with its scores and the judge's one-line reason, for
 * Ashwin to read aloud. The targets live here, in the report, and never in the judge's prompt.
 */
import { type ItemKind, type Judged, RUBRICS, summarize, weakest } from './judge.ts'

/** This batch's targets (step 13): every average at least 4, every yes rate at least 75% */
export const TARGETS = { average: 4, yes: 0.75 }

export interface RunMeta {
  model: string | null
  seconds: number
  calls: number
  waitedSeconds: number
  /** who wrote each film's messages: the model, or the templates and why */
  films: { id: string; writtenBy: string }[]
}

const KINDS: { kind: ItemKind; title: string }[] = [
  { kind: 'message', title: 'Messages (email and after-accept)' },
  { kind: 'film', title: 'Films (every line on screen)' },
  { kind: 'referral', title: 'Referral asks (with the blurb)' },
]

const cell = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ')
const fence = (t: string) => ['```', t.replaceAll('```', "'''"), '```']
const two = (n: number) => n.toFixed(2)

function header(judged: Judged[], meta: RunMeta): string[] {
  const scored = judged.filter((j) => j.scored).length
  const calls = `${meta.calls} judge calls, ${Math.round(meta.waitedSeconds / 60)} min paced for the free tier`
  return [
    `Judge: ${meta.model ?? 'none (no --model given, so nothing was scored)'}. ${judged.length} items, ${scored} scored, ${judged.length - scored} not scored. ${calls}. Ran in ${Math.round(meta.seconds / 60)} min.`,
    '',
    "Advisory only: a founder-eye read, not a gate. The judge never sees the sender's name, these targets or the code checks.",
  ]
}

/** The table of averages and yes rates, with each target met or missed */
export function targetTable(judged: Judged[]): string[] {
  const rows: string[] = []
  for (const { kind } of KINDS) {
    const s = summarize(kind, judged)
    for (const a of s.averages)
      rows.push(
        `| ${kind} | ${a.label} | ${a.average === null ? 'not scored' : two(a.average)} | ≥ ${TARGETS.average} | ${a.average === null ? '' : a.average >= TARGETS.average ? 'met' : `missed by ${two(TARGETS.average - a.average)}`} |`,
      )
    const y = s.yes
    rows.push(
      `| ${kind} | **${y.label}** | ${y.rate === null ? 'not scored' : `${Math.round(y.rate * 100)}% (${y.count}/${s.scored})`} | ≥ ${Math.round(TARGETS.yes * 100)}% | ${y.rate === null ? '' : y.rate >= TARGETS.yes ? 'met' : `missed by ${Math.round((TARGETS.yes - y.rate) * 100)} points`} |`,
    )
  }
  return ['| Kind | Line | Result | Target | |', '|---|---|---:|---:|---|', ...rows]
}

/** For each line under target, its two weakest drafts, quoted, with the judge's reason */
export function weakestNotes(judged: Judged[], original: Map<string, string>): string[] {
  const out: string[] = []
  for (const { kind } of KINDS) {
    const s = summarize(kind, judged)
    for (const a of s.averages) {
      if (a.average === null || a.average >= TARGETS.average) continue
      out.push(`### ${a.label} (${kind}, average ${two(a.average)})`, '')
      for (const j of weakest(kind, a.key, judged)) {
        if (!j.scored) continue
        out.push(
          `**${j.item.id}**: ${j.verdict.scores[a.key]}/5. The judge: ${j.verdict.reason}`,
          '',
          ...fence(original.get(j.item.id) ?? j.item.text),
          '',
        )
      }
    }
  }
  return out.length ? out : ['Every line met its target.', '']
}

export function summaryFile(judged: Judged[], original: Map<string, string>, meta: RunMeta) {
  const fallbacks = meta.films.filter((f) => f.writtenBy !== 'model')
  return [
    '# Judged eval: read it like a founder',
    '',
    ...header(judged, meta),
    '',
    '## Averages and yes rates (targets for this batch)',
    '',
    ...targetTable(judged),
    '',
    `Messages: ${meta.films.length} films (3 fixture sites × 2 job seekers × with and without their latest post), the email and the after-accept each. Films: one per site and job seeker (both message variants share a film). Referral asks: one per site and job seeker.`,
    '',
    ...(fallbacks.length
      ? [
          "Films whose messages are not all the model's own:",
          '',
          ...fallbacks.map((f) => `- ${f.id}: ${cell(f.writtenBy)}`),
          '',
        ]
      : ['The model wrote every message judged here (no template stood in).', '']),
    ...(judged.some((j) => !j.scored)
      ? [
          '### Not scored',
          '',
          ...judged
            .filter((j) => !j.scored)
            .map((j) => `- ${j.item.id}: ${cell(j.scored ? '' : j.why)}`),
          '',
        ]
      : []),
    '## The weakest drafts, for each line under 4',
    '',
    ...weakestNotes(judged, original),
  ].join('\n')
}

export function reviewFile(judged: Judged[], original: Map<string, string>, meta: RunMeta) {
  const out = [
    "# Read aloud: every draft and film, with the judge's scores",
    '',
    ...header(judged, meta),
    '',
    "Each item is shown as it would be sent (with the sender's name, which the judge did not see).",
    '',
  ]
  for (const { kind, title } of KINDS) {
    out.push(`## ${title}`, '')
    const r = RUBRICS[kind]
    for (const j of judged.filter((x) => x.item.kind === kind)) {
      out.push(`### ${j.item.id} (${j.item.label})`, '')
      if (j.scored) {
        const scores = r.criteria.map((c) => `${c.label} ${j.verdict.scores[c.key]}`).join(' · ')
        out.push(
          `${scores} · **${r.yes.label}: ${j.verdict.yes ? 'yes' : 'no'}**`,
          '',
          `The judge: ${j.verdict.reason}`,
          '',
        )
      } else out.push(`Not scored: ${j.why}`, '')
      out.push(...fence(original.get(j.item.id) ?? j.item.text), '')
    }
  }
  return out.join('\n')
}
