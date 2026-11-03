import { describe, expect, it } from 'vitest'
import { rowsOf } from '../../analytics/snapshot.ts'

describe('hiring signals snapshot', () => {
  it('writes one CSV row per role, quoted where it needs to be', () => {
    const [row] = rowsOf(
      { ats: 'ashby', token: 'acme', name: 'Acme, Inc.' },
      [
        {
          id: 'ashby:acme:1',
          board: 'ashby:acme',
          company: 'Acme',
          title: 'Forward Deployed Engineer',
          url: 'https://x',
          location: 'San Francisco, CA',
          remote: false,
          workplace: 'hybrid',
          posted: '2026-10-30T00:00:00.000Z',
          pay: { min: 150000, max: 200000, currency: 'USD' },
        },
      ],
      '2026-11-02',
    )
    expect(row).toBe(
      '2026-11-02,ashby:acme,"Acme, Inc.",,false,ashby:acme:1,Forward Deployed Engineer,"San Francisco, CA",true,false,hybrid,,mid,,2026-10-30T00:00:00.000Z,150000,200000,USD',
    )
  })
})
