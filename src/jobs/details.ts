import { itemsFromText, pickRequirements } from '../job/post.ts'
import type { Board, FetchFn, Pay } from './boards.ts'
import { boardKey, payOf } from './boards.ts'

/**
 * A job's requirements from its board's own description, without opening a browser: the same
 * picking the film uses on a job page (what they ask for first, benefits and legal text dropped),
 * run on the description's text.
 */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  bull: '•',
  middot: '·',
}

export function decode(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1]?.toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/**
 * A description's HTML as lines: list items become "• " bullets, headings and paragraphs their
 * own lines, so the pasted-text reader can tell headings from requirements.
 */
export function htmlToText(html: string): string {
  // Greenhouse escapes its HTML once (and sometimes its ampersands twice)
  let h = html
  for (let i = 0; i < 2 && /&lt;\/?[a-z]/i.test(h); i++) h = decode(h)
  const flat = (s: string) =>
    s
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  // until nothing changes: "<scr<script></script>ipt>" can't leave a script tag behind
  for (let before = ''; before !== h; ) {
    before = h
    h = h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
  }
  return decode(
    h
      // a list item is one bullet line, whatever paragraphs or spans are inside it
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n• ${flat(inner)}\n`)
      // headings, and paragraphs that are only bold text, are section headings
      .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_m, t: string) => `\n### ${flat(t)}\n`)
      .replace(
        /<p[^>]*>\s*<(strong|b)[^>]*>([^<]{2,80})<\/\1>\s*:?\s*<\/p>/gi,
        (_m, _t, t: string) => `\n### ${flat(t)}\n`,
      )
      .replace(/<\/(p|div|ul|ol|section|tr)>/gi, '\n')
      .replace(/<(br|hr)\s*\/?>/gi, '\n')
      .replace(/<(p|div|ul|ol|section)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .replace(/^### \s*$/gm, '')
    .trim()
}

export function requirementsFromText(text: string): string[] {
  const items = itemsFromText(text)
  // a post with lists says what it wants in them; its paragraphs are the pitch
  const bullets = items.filter((i) => i.bullet)
  return pickRequirements(bullets.length >= 3 ? bullets : items, 10)
}

export const requirementsFromHtml = (html: string) => requirementsFromText(htmlToText(html))

type Raw = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/**
 * Requirements for every job in a Lever or Ashby board's listing, which already carries the
 * descriptions. Greenhouse lists without them; those are read one job at a time.
 */
export function detailsFromBoard(b: Board, body: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const key = boardKey(b)
  if (b.ats === 'lever' && Array.isArray(body)) {
    for (const j of body as Raw[]) {
      const lists = Array.isArray(j.lists) ? (j.lists as Raw[]) : []
      const html = lists.map((l) => `<h3>${str(l.text)}</h3><ul>${str(l.content)}</ul>`).join('')
      out.set(`${key}:${j.id}`, requirementsFromHtml(html || str(j.description)))
    }
  } else if (b.ats === 'ashby') {
    const jobs = (body as { jobs?: Raw[] })?.jobs
    for (const j of Array.isArray(jobs) ? jobs : []) {
      const html = str(j.descriptionHtml)
      out.set(
        `${key}:${j.id}`,
        html ? requirementsFromHtml(html) : requirementsFromText(str(j.descriptionPlain)),
      )
    }
  }
  return out
}

/** One Greenhouse job's requirements, from its own API page (which carries the description) */
export async function greenhouseRequirements(
  token: string,
  id: string,
  opts: { fetch?: FetchFn; timeoutMs?: number } = {},
): Promise<string[]> {
  return (await greenhouseDetails(token, id, opts)).requirements
}

/** A Greenhouse post's requirements and the pay range it lists, from the post's own page */
export async function greenhouseDetails(
  token: string,
  id: string,
  opts: { fetch?: FetchFn; timeoutMs?: number } = {},
): Promise<{ requirements: string[]; pay: Pay | null }> {
  const f = opts.fetch ?? fetch
  const res = await f(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(id)}?pay_transparency=true`,
    {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    },
  )
  if (!res.ok) throw new Error(`greenhouse job ${id}: HTTP ${res.status}`)
  const j = (await res.json()) as Raw
  const range = ((j.pay_input_ranges as Raw[] | undefined) ?? [])[0]
  const pay = range
    ? payOf(
        Number(range.min_cents) / 100,
        Number(range.max_cents) / 100,
        range.currency_type,
        /hour/i.test(str(range.title)) ? 'hour' : 'year',
      )
    : null
  return { requirements: requirementsFromHtml(str(j.content)), pay }
}
