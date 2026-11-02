#!/usr/bin/env node
/**
 * Checks every default job board against its live API: how many roles it lists, or why it
 * failed. Run by the "Job boards" workflow (and by hand: node src/jobs/check.ts).
 * Exits non-zero when a board is gone (an empty one is fine), so a dead entry in companies.ts gets noticed.
 */
import { type Board, boardKey, fetchBoard, prettyToken } from './boards.ts'
import { DEFAULT_BOARDS } from './companies.ts'

// `node src/jobs/check.ts ashby:acme greenhouse:acme` checks those boards instead
const asked: Board[] = process.argv.slice(2).map((a) => {
  const [ats, token] = a.split(':') as [Board['ats'], string]
  return { ats, token, name: prettyToken(token) }
})
const results = await Promise.all(
  (asked.length ? asked : DEFAULT_BOARDS).map(async (b) => {
    try {
      const jobs = await fetchBoard(b, { timeoutMs: 20_000 })
      const newest = jobs
        .map((j) => j.posted ?? '')
        .sort()
        .at(-1)
      return { b, n: jobs.length, newest: newest?.slice(0, 10) ?? '', sample: jobs[0] }
    } catch (err) {
      return { b, n: -1, error: err instanceof Error ? err.message : String(err) }
    }
  }),
)
let bad = 0
for (const r of results) {
  // a board with no openings this week is fine; one that's gone is not
  if (r.n < 0) bad++
  const line =
    r.n < 0
      ? `FAIL  ${boardKey(r.b)}  ${r.error}`
      : `${r.n === 0 ? 'EMPTY' : 'ok   '} ${boardKey(r.b)}  ${r.n} roles  newest ${r.newest}`
  console.log(line)
}
const sample = results.find((r) => r.sample)?.sample
if (sample) console.log('sample', JSON.stringify(sample))
console.log(`${results.length - bad}/${results.length} boards list open roles`)
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFile } = await import('node:fs/promises')
  await appendFile(
    process.env.GITHUB_STEP_SUMMARY,
    `### Job boards\n\n${results.length - bad}/${results.length} list open roles\n\n${results
      .filter((r) => r.n <= 0)
      .map((r) => `- ${boardKey(r.b)}: ${r.n < 0 ? r.error : 'no open roles'}`)
      .join('\n')}\n`,
  )
}
process.exit(bad ? 1 : 0)
