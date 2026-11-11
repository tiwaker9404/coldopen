import { describe, expect, it } from 'vitest'
import {
  CHECKS,
  changeOf,
  impressive,
  type ProofCard,
  readableProof,
  startsWithVerb,
} from '../../src/profile/proof.ts'

/** a bullet with a before and an after, and the card a stranger understands */
const RAIL =
  'Architected containerized ETL workflows using Docker and PostgreSQL, accelerating daily client data synchronization cycles from 6 hours to 45 minutes relative to the legacy high-latency batch baseline.'
const good: ProofCard = {
  value: '6h → 45m',
  label: 'daily client data sync, from 6 hours to 45 minutes',
  did: 'Built containerized ETL with Docker and PostgreSQL',
  where: 'Rail Inc.',
}
const failing = (p: ProofCard, bullet = RAIL, exclude: string[] = []) => {
  const r = readableProof(p, bullet, { exclude })
  return CHECKS.filter((c) => !r.checks[c])
}

describe('readableProof: does a stranger follow this card?', () => {
  it('passes a card that says what was done, where, and what changed', () => {
    const r = readableProof(good, RAIL)
    expect(r).toEqual({ ok: true, checks: expect.any(Object), problems: [] })
    expect(Object.values(r.checks).every(Boolean)).toBe(true)
  })

  it('has_action: the act starts with a verb and names what was built, without padding', () => {
    expect(failing({ ...good, did: undefined })).toEqual(['has_action'])
    expect(failing({ ...good, did: 'ETL workflows with Docker and PostgreSQL' })).toEqual([
      'has_action',
    ])
    expect(failing({ ...good, did: 'Leveraged containerized ETL with Docker' })).toEqual([
      'has_action',
    ])
    expect(failing({ ...good, did: 'Built it all' })).toEqual(['has_action'])
    expect(readableProof({ ...good, did: 'Built ETL' }, RAIL).problems.join()).toMatch(
      /name what was built/,
    )
  })

  it('has_result: the label says what the number counts, whole and plain', () => {
    expect(failing({ ...good, value: 'six', label: 'faster' }, 'Made it faster.')).toEqual([
      'has_result',
    ])
    expect(
      failing(
        { ...good, value: '60%', label: 'less manual configuration overhead compared to' },
        'cutting manual configuration overhead by 60% compared to legacy manual baselines',
      ),
    ).toEqual(['has_result'])
    expect(
      failing(
        { ...good, value: '60%', label: 'less overhead relative to the baseline' },
        'cutting overhead by 60% relative to the baseline',
      ),
    ).toEqual(['has_result'])
  })

  it('keeps_before_after: the change is the value, and the label says both', () => {
    // the starting figure alone, the ending figure alone, or the label losing one side
    expect(failing({ ...good, value: '6', label: 'hours of daily data sync' })).toEqual([
      'keeps_before_after',
    ])
    expect(failing({ ...good, value: '45 minutes', label: 'daily data sync' })).toEqual([
      'keeps_before_after',
    ])
    expect(failing({ ...good, label: 'daily client data sync, down to 45 minutes' })).toEqual([
      'keeps_before_after',
    ])
    const p = readableProof({ ...good, value: '6' }, RAIL).problems.join('\n')
    expect(p).toContain('value should be the change ("6h → 45m")')
    // a bullet without a before and an after has nothing to keep
    expect(
      failing(
        {
          value: '2.5M+',
          label: 'financial records moved off Oracle',
          did: 'Migrated a database to hybrid cloud',
          where: 'Deloitte',
        },
        'Deployed pipelines to transfer 2.5M+ historical financial records.',
      ),
    ).toEqual([])
  })

  it('has_where: the employer, school or project is on the card', () => {
    expect(failing({ ...good, where: undefined })).toEqual(['has_where'])
    expect(failing({ ...good, where: ' ' })).toEqual(['has_where'])
  })

  it('numbers_from_resume: every number is the bullet’s own, or its worked-out ending', () => {
    expect(
      failing({ ...good, value: '6h → 30m', label: 'daily sync, from 6 hours to 30 minutes' }),
    ).toContain('numbers_from_resume')
    expect(failing({ ...good, did: 'Built ETL with Docker for 40 analysts' })).toEqual([
      'numbers_from_resume',
    ])
    const itc =
      'Authored deployment runbooks, reducing onboarding timelines for regional customer teams by 2 full days measured against the previous undocumented 5-day baseline.'
    const card = {
      label: 'customer onboarding, from 5 days to 3',
      did: 'Wrote deployment runbooks for regional teams',
      where: 'ITC Infotech',
    }
    expect(failing({ ...card, value: '5 → 3 days' }, itc)).toEqual([])
    expect(
      failing({ ...card, value: '5 → 4 days', label: 'onboarding, from 5 days to 4' }, itc),
    ).toContain('numbers_from_resume')
  })

  it('no_excluded_employer: no excluded name, and no redaction placeholder copied', () => {
    expect(failing({ ...good, where: 'Zephyrine' }, RAIL, ['Zephyrine'])).toEqual([
      'no_excluded_employer',
    ])
    expect(
      failing({ ...good, did: 'Built ETL for Zephyrine with Docker' }, RAIL, ['zephyrine']),
    ).toEqual(['no_excluded_employer'])
    expect(failing({ ...good, where: '[Current employer, left out]' })).toEqual([
      'no_excluded_employer',
    ])
    expect(failing({ ...good, where: 'Current FDE role' }, RAIL, ['Zephyrine'])).toEqual([])
  })

  it('within_limits: value 12, label 60, did 12 to 90, where 40 characters', () => {
    expect(failing({ ...good, did: `Built ${'very '.repeat(20)}big ETL` })).toEqual([
      'within_limits',
    ])
    expect(failing({ ...good, where: 'R'.repeat(41) })).toEqual(['within_limits'])
    expect(
      failing({
        ...good,
        label: `daily client data sync, from 6 hours to 45 minutes ${'x'.repeat(10)}`,
      }),
    ).toEqual(['within_limits'])
  })
})

describe('reading a before and an after', () => {
  it.each([
    [RAIL, '6h → 45m', '6 hours', '45 minutes', 'daily client data sync cycles'],
    [
      'Decreased new client infrastructure onboarding time from 3 days to 4 hours by structuring Terraform templates.',
      '3d → 4h',
      '3 days',
      '4 hours',
      'new client infra onboarding time',
    ],
    [
      'Cut blended customer acquisition cost from $48 to $31 by rebuilding creative testing.',
      '$48 → $31',
      '$48',
      '$31',
      'blended customer acquisition cost',
    ],
    [
      'Ran 60+ A/B tests on landing pages, raising trial sign-up conversion from 3.1% to 4.6%.',
      '3.1% → 4.6%',
      '3.1%',
      '4.6%',
      'trial sign-up conversion',
    ],
  ])('%s', (text, value, before, after, what) => {
    expect(changeOf(text)).toEqual({ value, before, after, what })
  })

  it('works out the end from a change against a baseline, and says so', () => {
    expect(
      changeOf(
        'reducing onboarding timelines by 2 full days measured against the previous undocumented 5-day baseline.',
      ),
    ).toEqual({
      value: '5 → 3 days',
      before: '5 days',
      after: '3 days',
      what: 'onboarding timelines',
      derived: '3',
    })
  })

  it('finds no change where there is only one number, or a move between places', () => {
    expect(
      changeOf('Migrated a database from legacy Oracle to a hybrid-cloud environment'),
    ).toBeNull()
    expect(changeOf('processing 50,000+ daily payloads')).toBeNull()
  })
})

describe('what impresses a stranger first', () => {
  it('puts a before and after first, then big scale, then the rest', () => {
    const order = ['99%', '1,500+', '6h → 45m', '12+', '2.5M+', '50GB', '5 → 3 days']
      .map((value) => ({ value }))
      .sort((a, b) => impressive(b) - impressive(a))
      .map((p) => p.value)
    expect(order).toEqual(['6h → 45m', '5 → 3 days', '2.5M+', '1,500+', '50GB', '99%', '12+'])
  })

  it('knows a verb when a line starts with one', () => {
    for (const w of [
      'Built ETL',
      'Led scoping',
      'Migrated data',
      'Wrote runbooks',
      'Containerized apps',
    ])
      expect(startsWithVerb(w)).toBe(true)
    for (const w of ['ETL workflows', 'Daily sync', 'The pipeline', 'Speed'])
      expect(startsWithVerb(w)).toBe(false)
  })
})
