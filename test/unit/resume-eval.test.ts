import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  beforeAfter,
  type ExpectedRow,
  overlap,
  sameValue,
  scoreCards,
  scoreRows,
  sourceOf,
} from '../../evals/resume/score.ts'
import { parseResume } from '../../src/profile/parse.ts'

const root = join(import.meta.dirname, '../..')
const ashwin = parseResume(readFileSync(join(root, 'fixtures/resumes/ashwin-fde.md'), 'utf8'))
const expected = JSON.parse(
  readFileSync(join(root, 'fixtures/profiles/ashwin-fde-expected.json'), 'utf8'),
) as { rows: ExpectedRow[] }

describe('the résumé eval scores by meaning', () => {
  it('has one hand-checked row per numbered bullet, each found by its phrase', () => {
    expect(expected.rows).toHaveLength(16)
    for (const r of expected.rows)
      expect(ashwin.entries.filter((e) => e.text.includes(r.from))).toHaveLength(1)
    expect(expected.rows.filter((r) => r.best).map((r) => r.value)).toEqual([
      '1.5M',
      '6h → 45m',
      '1,500+',
      '2.5M+',
      '3d → 4h',
    ])
  })

  it('matches words loosely, values and changes exactly', () => {
    expect(
      overlap(
        'Built containerized ETL workflows using Docker and PostgreSQL',
        'Built containerized ETL with Docker and PostgreSQL',
      ),
    ).toBe(1)
    expect(overlap('HubSpot records migrated', 'migration of HubSpot records')).toBe(1)
    expect(overlap('queries a second', 'financial records')).toBe(0)
    expect(sameValue('6h → 45m', '6 hours → 45 minutes')).toBe(true)
    expect(sameValue('1,500+', '1,500+')).toBe(true)
    expect(sameValue('6', '6h → 45m')).toBe(false)
  })

  it('scores the answer key itself as a perfect draft', () => {
    const results = scoreCards(expected.rows, ashwin.entries, [])
    for (const r of results)
      expect(Object.values(r.checks).every(Boolean), r.problems.join()).toBe(true)
    expect(scoreRows(expected.rows, results).every((r) => r.match)).toBe(true)
    expect(beforeAfter(ashwin.entries, results).map((b) => b.kept)).toEqual([true, true, true])
  })

  it('finds a card’s bullet by its numbers, and calls a starting figure alone a miss', () => {
    const lazy = {
      value: '6',
      label: 'hours of daily data sync',
      did: 'Built ETL with Docker',
      where: 'Rail Inc.',
    }
    expect(sourceOf(lazy, ashwin.entries)?.text).toContain('from 6 hours to 45 minutes')
    const [r] = scoreCards([lazy], ashwin.entries, [])
    expect(r!.checks.keeps_before_after).toBe(false)
    const rail = expected.rows.find((x) => x.value === '6h → 45m')!
    expect(scoreRows([rail], [r!])[0]).toMatchObject({ match: false })
  })
})
