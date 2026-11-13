import { describe, expect, it } from 'vitest'
import { untried } from '../../src/autopilot/pick.ts'

const p = (company: string, site: string) => ({ company, site, reasons: [] })
const PICKED = [
  p('Acme', 'https://acme.com'),
  p('Globex', 'https://www.globex.com'),
  p('Initech', 'https://initech.io'),
  p('Umbrella', 'umbrella.dev'),
]

describe('untried', () => {
  it('keeps the stored order and leaves out companies already tried, however the site is written', () => {
    const left = untried(PICKED, ['globex.com', 'https://acme.com/about', ''])
    expect(left.map((x) => x.company)).toEqual(['Initech', 'Umbrella'])
  })

  it('leaves out a pick with no website, and gives everything back when nothing was tried', () => {
    expect(untried([...PICKED, p('Nosite', '')], []).map((x) => x.company)).toEqual([
      'Acme',
      'Globex',
      'Initech',
      'Umbrella',
    ])
  })
})
