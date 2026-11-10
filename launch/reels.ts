/**
 * The role reels' clip lists (launch/reels/*.json), read and checked. Pure, so the timing and
 * the sources are unit-tested; launch/role-reel.ts renders them.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const TITLE_S = 3.4
export const ITEM_S = 3.8
export const END_S = 4.4
export const FORMATS = { square: { w: 1080, h: 1080 }, wide: { w: 1920, h: 1080 } } as const
export type ReelFormat = keyof typeof FORMATS

/** what launch/stills.ts captures; a reel can only use these */
export const STILLS = [
  'today',
  'jobs',
  'startups',
  'board',
  'tour',
  'film-tour',
  'film',
  'messages',
  'views',
  'developers',
  'evals',
] as const

/** a moment of one of the demo's films, by company, or a still captured by launch/stills.ts */
export type Item =
  | { film: string; from: number; caption: string }
  | { still: string; caption: string }

export interface Reel {
  /** who it's for: GTM, FDE, SE or SWE */
  role: string
  title: string
  items: Item[]
  end: string
}

export const reelLength = (r: Pick<Reel, 'items'>) => TITLE_S + r.items.length * ITEM_S + END_S

const ROOT = join(import.meta.dirname, '..')

/** The demo's films by company: the real engine's output, published with the landing page. */
export function demoFilms(): Map<string, string> {
  const recorded = JSON.parse(
    readFileSync(join(ROOT, 'dashboard/src/demo/fixtures.json'), 'utf8'),
  ) as { answers: Record<string, unknown> }
  const list = recorded.answers['/v1/films?limit=120'] as {
    data: { id: string; company: string; files: { film: string } }[]
  }
  return new Map(
    list.data.map((f) => [
      f.company,
      join(ROOT, 'site/media/demo', f.id, f.files.film.split('/').pop()!),
    ]),
  )
}

/** Everything wrong with a reel, in plain words; empty when it's ready to render. */
export function checkReel(
  r: Reel,
  opts: { stillsDir?: string; films?: Map<string, string> } = {},
): string[] {
  const v: string[] = []
  const len = reelLength(r)
  if (len < 28 || len > 32) v.push(`${r.role} runs ${len.toFixed(1)}s; keep it between 28 and 32`)
  if (!r.title.trim() || !r.end.trim()) v.push(`${r.role} needs a title and an end line`)
  for (const [i, it] of r.items.entries()) {
    if (!it.caption.trim()) v.push(`${r.role} item ${i + 1} has no caption`)
    if (it.caption.length > 90) v.push(`${r.role} item ${i + 1}'s caption is too long to read`)
    if ('film' in it) {
      const file = opts.films?.get(it.film)
      if (opts.films && !file) v.push(`${r.role} item ${i + 1}: no demo film for ${it.film}`)
      else if (file && !existsSync(file)) v.push(`${r.role} item ${i + 1}: ${file} is missing`)
      if (it.from < 0 || it.from + ITEM_S > 29.2)
        v.push(`${r.role} item ${i + 1} starts at ${it.from}s, past the film's end`)
    } else if (!(STILLS as readonly string[]).includes(it.still))
      v.push(
        `${r.role} item ${i + 1}: "${it.still}" isn't one of the stills launch/stills.ts takes`,
      )
    else if (opts.stillsDir && !existsSync(join(opts.stillsDir, `${it.still}.png`)))
      v.push(`${r.role} item ${i + 1}: still "${it.still}" wasn't captured`)
  }
  return v
}

export function loadReel(file: string): Reel {
  return JSON.parse(readFileSync(file, 'utf8')) as Reel
}
