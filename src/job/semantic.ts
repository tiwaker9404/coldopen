import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile } from '../script/types.ts'
import { ANSWERED, proofText } from './fit.ts'

/**
 * Fit by meaning, not just shared words: a small sentence-embedding model (run in-process on
 * the CPU through ONNX, no API) scores how close a line of someone's record is to a
 * requirement. "Shipped LLM agents to production" answers "experience deploying large language
 * model applications" though they share no word that matters.
 *
 * The cut-off for "answers it" is picked by the fit eval (evals/fit), on half of a hand-labeled
 * set and scored on the other half, and read from evals/fit/threshold.json.
 */

export const DEFAULT_MODEL = 'Xenova/bge-small-en-v1.5'

export interface Embedder {
  model: string
  embed(texts: string[]): Promise<Float32Array[]>
}

/** Loads a sentence-embedding model (downloaded once, then cached on disk) */
export async function loadEmbedder(model = DEFAULT_MODEL): Promise<Embedder> {
  const { pipeline } = await import('@huggingface/transformers')
  const extract = await pipeline('feature-extraction', model, { dtype: 'q8' })
  return {
    model,
    async embed(texts) {
      if (!texts.length) return []
      const out = await extract(texts, { pooling: 'mean', normalize: true })
      const [n, d] = out.dims as [number, number]
      const data = out.data as Float32Array
      return Array.from({ length: n }, (_, i) => data.slice(i * d, (i + 1) * d))
    },
  }
}

/** Cosine similarity of two vectors (the model's are already unit length) */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    na += a[i]! * a[i]!
    nb += b[i]! * b[i]!
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/** The eval's cut-off for a model, or a conservative one when it hasn't been measured */
export function thresholdFor(model: string): number {
  try {
    const t = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../evals/fit/threshold.json'), 'utf8'),
    ) as Record<string, number>
    return t[model] ?? 0.8
  } catch {
    return 0.8
  }
}

/**
 * A similarity, as a score on the keyword matcher's scale: at the cut-off it counts as answered
 * (ANSWERED), and below it, it never does.
 */
export function asScore(sim: number, threshold: number): number {
  if (sim >= threshold) return Math.min(1, ANSWERED + (sim - threshold))
  return Math.max(0, (sim / threshold) * ANSWERED - 0.01)
}

/** What a record line says, for matching by meaning */
export function recordLines(profile: Profile): string[] {
  return [...profile.proof.map(proofText), ...profile.points, ...(profile.skills ?? [])].filter(
    (l) => l.trim(),
  )
}

export interface Semantic {
  model: string
  threshold: number
  /** for each requirement, the record line closest in meaning and its score (keyword scale) */
  best(
    profile: Profile,
    requirements: string[],
  ): Promise<Map<string, { score: number; with: string }>>
  /**
   * The same, from what's already embedded, without waiting: requirements not embedded yet are
   * left out and embedded in the background, so they count on the next look.
   */
  known(profile: Profile, requirements: string[]): Map<string, { score: number; with: string }>
  /**
   * How close each line is, by meaning, to the closest of `about` (a company's facts), on the
   * keyword scale: a proof that reads like their business scores higher.
   */
  closeness(lines: string[], about: string[]): Promise<number[]>
}

/** Embeddings kept by text, so a requirement or a record line is embedded once */
export function semanticFit(
  embedder: Embedder,
  threshold = thresholdFor(embedder.model),
): Semantic {
  const cache = new Map<string, Float32Array>()
  const MAX = 20_000
  async function vectors(texts: string[]): Promise<Float32Array[]> {
    const missing = [...new Set(texts.filter((t) => !cache.has(t)))]
    for (let i = 0; i < missing.length; i += 64) {
      const batch = missing.slice(i, i + 64)
      const vs = await embedder.embed(batch)
      for (const [j, t] of batch.entries()) cache.set(t, vs[j]!)
    }
    if (cache.size > MAX)
      for (const k of [...cache.keys()].slice(0, cache.size - MAX)) cache.delete(k)
    return texts.map((t) => cache.get(t)!)
  }
  function match(lines: string[], lv: Float32Array[], rv: Float32Array) {
    let top = { score: 0, with: '' }
    lines.forEach((l, j) => {
      const s = asScore(cosine(rv, lv[j]!), threshold)
      if (s > top.score) top = { score: s, with: l }
    })
    return top
  }
  // one background job at a time, so a slow CPU embeds at its own pace
  let queue = Promise.resolve()
  const pending = new Set<string>()
  function later(texts: string[]) {
    const fresh = texts.filter((t) => !cache.has(t) && !pending.has(t))
    if (!fresh.length) return
    for (const t of fresh) pending.add(t)
    queue = queue
      .then(() => vectors(fresh))
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        for (const t of fresh) pending.delete(t)
      })
  }
  return {
    model: embedder.model,
    threshold,
    async best(profile, requirements) {
      const lines = recordLines(profile)
      const out = new Map<string, { score: number; with: string }>()
      if (!lines.length || !requirements.length) return out
      const [lv, rv] = [await vectors(lines), await vectors(requirements)]
      for (const [i, r] of requirements.entries()) out.set(r, match(lines, lv, rv[i]!))
      return out
    },
    async closeness(lines, about) {
      const texts = about.filter((t) => t.trim())
      if (!lines.length || !texts.length) return lines.map(() => 0)
      const [lv, av] = [await vectors(lines), await vectors(texts)]
      return lv.map((v) => Math.max(...av.map((a) => asScore(cosine(v, a), threshold))))
    },
    known(profile, requirements) {
      const lines = recordLines(profile)
      const out = new Map<string, { score: number; with: string }>()
      later([...lines, ...requirements])
      if (!lines.length || lines.some((l) => !cache.has(l))) return out
      const lv = lines.map((l) => cache.get(l)!)
      for (const r of requirements) {
        const rv = cache.get(r)
        if (rv) out.set(r, match(lines, lv, rv))
      }
      return out
    },
  }
}

let shared: Promise<Semantic | null> | null = null
let ready: Semantic | null = null

/**
 * The app's semantic matcher when FIT_SEMANTIC is on (the model name, or "on" for the default),
 * loaded once in the background; null while it loads or when it's off or failed to load.
 */
export function appSemantic(): Promise<Semantic | null> {
  const want = process.env.FIT_SEMANTIC
  if (!want || want === 'off') return Promise.resolve(null)
  shared ??= loadEmbedder(want === 'on' ? DEFAULT_MODEL : want)
    .then((e) => {
      ready = semanticFit(e)
      return ready
    })
    .catch((err: unknown) => {
      console.warn(`semantic fit off: ${(err as Error).message}`)
      return null
    })
  return shared
}

/** The matcher if it has loaded, without waiting: starts loading it the first time */
export function semanticNow(): Semantic | null {
  void appSemantic()
  return ready
}
