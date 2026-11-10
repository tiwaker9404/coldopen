/**
 * The demo build's stand-in for the API: every read is answered from fixtures.json, recorded
 * from a real coldopen by scripts/demo-fixtures.ts, and every write is turned down in plain
 * words. Only the demo build loads this file (see api() in ../api.ts), so the live app never
 * carries the fixtures.
 */
import { ApiError } from '../api.ts'
import recorded from './fixtures.json' with { type: 'json' }

export const LIVE_APP = 'https://coldopen-nk8o.onrender.com'
export const READ_ONLY = `This is the demo. Nothing is saved; make your own film at ${LIVE_APP.replace('https://', '')}.`

const answers = recorded.answers as Record<string, unknown>

/** The recorded answer for a path: exact first, then the same route with other filters. */
export function answerFor(path: string): unknown {
  if (path in answers) return answers[path]
  const route = path.split('?')[0]
  const same = Object.keys(answers).find((k) => k.split('?')[0] === route)
  return same === undefined ? undefined : answers[same]
}

export async function demoApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  if (method !== 'GET') throw new ApiError(403, READ_ONLY, 'demo_read_only')
  const body = answerFor(path)
  if (body === undefined) throw new ApiError(404, "The demo doesn't have this page.", 'not_found')
  // a copy, so a screen that edits what it was given can't change the next answer
  return structuredClone(body) as T
}
