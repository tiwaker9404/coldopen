#!/usr/bin/env node
/**
 * Checks every default job board against its live API: how many roles it lists, or why it
 * failed. Run by the "Job boards" workflow (and by hand: node src/jobs/check.ts).
 * Exits non-zero when a board is gone (an empty one is fine), so a dead entry in companies.ts gets noticed.
 */
import { type Board, boardKey, fetchBoard, prettyToken } from './boards.ts'
import { CURATED_BOARDS as DEFAULT_BOARDS } from './companies.ts'

// `--details ashby:acme ...`: the requirements read from a few engineering jobs on each board
if (process.argv[2] === '--details') {
  const { readBoard, fetchBoardBody } = await import('./boards.ts')
  const { detailsFromBoard, greenhouseRequirements } = await import('./details.ts')
  for (const a of process.argv.slice(3)) {
    const [ats, token] = a.split(':') as [Board['ats'], string]
    const b: Board = { ats, token, name: prettyToken(token) }
    const body = await fetchBoardBody(b, { timeoutMs: 45_000 })
    const jobs = readBoard(b, body)
      .filter((j) => /engineer|solutions|deployed/i.test(j.title))
      .slice(0, 3)
    const details = detailsFromBoard(b, body)
    for (const j of jobs) {
      const reqs =
        ats === 'greenhouse'
          ? await greenhouseRequirements(token, j.id.split(':')[2]!)
          : (details.get(j.id) ?? [])
      console.log(`\n== ${b.name}: ${j.title} (${reqs.length})`)
      for (const r of reqs) console.log(`  - ${r}`)
    }
  }
  process.exit(0)
}

// `node src/jobs/check.ts ashby:acme greenhouse:acme` checks those boards instead
const asked: Board[] = process.argv.slice(2).map((a) => {
  const [ats, token] = a.split(':') as [Board['ats'], string]
  return { ats, token, name: prettyToken(token) }
})
const results = await Promise.all(
  (asked.length ? asked : DEFAULT_BOARDS).map(async (b) => {
    try {
      const jobs = await fetchBoard(b, { timeoutMs: 45_000 })
      const newest = jobs
        .map((j) => j.posted ?? '')
        .sort()
        .at(-1)
      const paid = jobs.filter((j) => j.pay).length
      return {
        b,
        n: jobs.length,
        paid,
        newest: newest?.slice(0, 10) ?? '',
        sample: jobs.find((j) => j.pay) ?? jobs[0],
      }
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
      : `${r.n === 0 ? 'EMPTY' : 'ok   '} ${boardKey(r.b)}  ${r.n} roles  pay on ${'paid' in r ? r.paid : 0}  newest ${r.newest}`
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
