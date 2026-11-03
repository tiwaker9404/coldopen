import { describe, expect, it } from 'vitest'
import { bodyOf, MAX_DROP, merge, NoBoard, type YcBoard } from '../../src/jobs/yc-build.ts'

const board = (slug: string): YcBoard => ({
  ats: 'ashby',
  token: slug,
  name: slug,
  batch: 'W25',
  slug,
})

describe('YC board refresh', () => {
  it('retries a busy board and gets it', async () => {
    let n = 0
    const body = await bodyOf({ ats: 'ashby', token: 'acme', name: 'Acme' }, async () => {
      if (++n < 3) throw new Error('Acme: ashby board returned HTTP 429')
      return { jobs: [] }
    }, [0, 0, 0])
    expect(body).toEqual({ jobs: [] })
    expect(n).toBe(3)
  })

  it('tells a missing board from one it could not reach', async () => {
    await expect(
      bodyOf({ ats: 'lever', token: 'x', name: 'X' }, async () => {
        throw new Error('X: lever board returned HTTP 404')
      }),
    ).rejects.toBeInstanceOf(NoBoard)
    await expect(
      bodyOf({ ats: 'lever', token: 'x', name: 'X' }, async () => {
        throw new Error('X: lever board returned HTTP 503')
      }, [0]),
    ).rejects.not.toBeInstanceOf(NoBoard)
  })

  it('keeps last run’s board for a company it could not check, if it is still hiring', () => {
    const { boards, kept } = merge(
      [board('a')],
      [board('a'), board('b'), board('c'), board('d')],
      new Set(['b', 'c']),
      new Set(['a', 'b', 'd']),
    )
    // b: couldn't check, still hiring -> kept; c: no longer hiring; d: checked, no board
    expect(boards.map((b) => b.slug).sort()).toEqual(['a', 'b'])
    expect(kept).toBe(1)
  })

  it('refuses a list that shrinks by more than a fifth', () => {
    expect(MAX_DROP).toBe(0.2)
  })
})
