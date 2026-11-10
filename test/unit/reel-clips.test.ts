import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkReel, demoFilms, loadReel, reelLength } from '../../launch/reels.ts'

const DIR = join(import.meta.dirname, '../../launch/reels')
const reels = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => loadReel(join(DIR, f)))

describe('the role reels', () => {
  it('has one reel each for GTM, FDE, SE and SWE', () => {
    expect(reels.map((r) => r.role).sort()).toEqual(['FDE', 'GTM', 'SE', 'SWE'])
  })

  it('runs 28 to 32 seconds, uses only real films and captured stills, and reads in time', () => {
    const films = demoFilms()
    for (const r of reels) {
      expect(checkReel(r, { films }), r.role).toEqual([])
      expect(reelLength(r)).toBeGreaterThanOrEqual(28)
      expect(reelLength(r)).toBeLessThanOrEqual(32)
    }
  })

  it('says what is wrong with a reel that is too long or points at nothing', () => {
    const films = demoFilms()
    const bad = {
      role: 'X',
      title: 'T',
      end: 'E',
      items: [
        ...Array.from({ length: 7 }, () => ({ still: 'jobs', caption: 'ok' })),
        { still: 'made-up', caption: 'a still nobody captures' },
        { film: 'Nobody Inc', from: 2, caption: 'a film that was never made' },
      ],
    }
    const v = checkReel(bad, { films }).join('\n')
    expect(v).toMatch(/runs 42\.0s/)
    expect(v).toMatch(/"made-up" isn't one of the stills/)
    expect(v).toMatch(/no demo film for Nobody Inc/)
  })
})
