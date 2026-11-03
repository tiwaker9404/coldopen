import { describe, expect, it } from 'vitest'
import { ANSWERED, fitOf } from '../../src/job/fit.ts'
import { asScore, cosine, type Embedder, semanticFit } from '../../src/job/semantic.ts'
import type { Profile } from '../../src/script/types.ts'

const profile = {
  points: ['Shipped LLM agents to production'],
  proof: [],
  skills: [],
  offer: 'An engineer',
} as unknown as Profile

// a fake model: texts about language models point one way, everything else another
const fake: Embedder = {
  model: 'fake',
  embed: async (texts) =>
    texts.map((t) =>
      /LLM|language model/i.test(t) ? new Float32Array([1, 0.1]) : new Float32Array([0, 1]),
    ),
}

describe('semantic fit', () => {
  it('scores cosine similarity', () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([1, 0]))).toBeCloseTo(1)
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0)
  })

  it('puts the cut-off at "answered" and keeps everything under it below', () => {
    expect(asScore(0.7, 0.7)).toBeCloseTo(ANSWERED)
    expect(asScore(0.69, 0.7)).toBeLessThan(ANSWERED)
    expect(asScore(0.9, 0.7)).toBeGreaterThan(ANSWERED)
    expect(asScore(2, 0.7)).toBeLessThanOrEqual(1)
  })

  it('answers a requirement that shares no words with the record', async () => {
    const req = 'Experience deploying large language model applications'
    expect(fitOf([req], profile)!.answered).toBe(0)
    const sem = semanticFit(fake, 0.8)
    const meaning = await sem.best(profile, [req, 'Native iOS in Swift'])
    expect(meaning.get(req)!.with).toBe('Shipped LLM agents to production')
    const fit = fitOf([req, 'Native iOS in Swift'], profile, meaning)!
    expect(fit.answered).toBe(1)
    expect(fit.best?.requirement).toBe(req)
  })

  it('embeds each text once', async () => {
    let n = 0
    const counted: Embedder = {
      model: 'x',
      embed: async (t) => {
        n += t.length
        return fake.embed(t)
      },
    }
    const sem = semanticFit(counted, 0.8)
    await sem.best(profile, ['a', 'b'])
    await sem.best(profile, ['a', 'b', 'c'])
    expect(n).toBe(1 + 2 + 1)
  })
})

describe('semantic fit without waiting', () => {
  it('scores what is embedded and embeds the rest for next time', async () => {
    const sem = semanticFit(fake, 0.8)
    const req = 'Experience deploying large language model applications'
    expect(sem.known(profile, [req]).size).toBe(0)
    await new Promise((r) => setTimeout(r, 10))
    expect(sem.known(profile, [req]).get(req)!.score).toBeGreaterThan(ANSWERED)
  })
})
