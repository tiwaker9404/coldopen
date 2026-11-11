/**
 * The profile editor's form logic, kept pure so it can be tested without a browser.
 *
 * clean() tidies pasted text (résumé bullets, line breaks, stray spaces) into one line.
 * prepare() turns what's in the form into the body PUT /v1/profiles/:id takes.
 * validate() checks that body against ProfileSchema itself, the same schema the server uses,
 * and words every problem with the server's own humanize(), so the editor and the API can
 * never disagree about what's allowed or how it's said.
 */
import { z } from 'zod'
import { type FieldError, humanize } from '../../src/api/errors.ts'
import { ProfileSchema } from '../../src/script/types.ts'
import type { ProfileData } from './api.ts'

/* --------------------------------------------------------------------- clean */

// a list marker at the start of a line: •, ▪, ✓, *, a dash with a space, or "1." / "2)" / "(3)".
// A dash or number needs the space after it, so "-30%" and "1.5x" are left alone.
const BULLET = /^(?:[•◦▪▫‣⁃●○■□►▸➤✓✔*]+\s*|[-–—]+\s+|(?:\d{1,2}[.)]|\(\d{1,2}\))\s+)/u

/**
 * One clean line: trimmed, runs of spaces and tabs collapsed, line breaks joined, and list
 * bullets stripped. Lines that were separate bullets are joined with "; " so they still read
 * as separate items; a sentence that just wrapped joins with a space. Smart quotes, dashes
 * inside the text and everything else are kept as typed.
 */
export function clean(text: string): string {
  const lines = text.split(/\r\n|[\r\n\u2028\u2029]/)
  let out = ''
  for (const raw of lines) {
    const start = raw.trimStart()
    const bulleted = BULLET.test(start)
    const line = start.replace(BULLET, '').replace(/\s+/g, ' ').trim()
    if (!line) continue
    if (!out) out = line
    else out += bulleted && !/[.;:,!?]$/.test(out) ? `; ${line}` : ` ${line}`
  }
  return out
}

/**
 * What a paste into an input becomes: the cleaned text dropped in at the selection. Null when
 * cleaning changes nothing, so the browser's own paste (and its undo) can go ahead.
 */
export function pasteInto(
  value: string,
  text: string,
  start: number,
  end: number,
): { value: string; caret: number } | null {
  const tidy = clean(text)
  if (tidy === text) return null
  const before = value.slice(0, start)
  const glue = before && !/\s$/.test(before) && tidy ? ' ' : ''
  const next = `${before}${glue}${tidy}${value.slice(end)}`
  return { value: next, caret: before.length + glue.length + tidy.length }
}

/* -------------------------------------------------------------------- limits */

const S = ProfileSchema.shape
const P = S.proof.element.shape
const J = S.projects.unwrap().element.shape
const C = S.creator.unwrap().shape

/** each field's longest allowed text, read from ProfileSchema so the counters can't drift */
export const MAX = {
  offer: S.offer.maxLength ?? 120,
  point: S.points.element.maxLength ?? 120,
  proofValue: P.value.maxLength ?? 12,
  proofLabel: P.label.maxLength ?? 60,
  proofWhere: P.where.unwrap().maxLength ?? 40,
  projectName: J.name.maxLength ?? 60,
  projectLine: J.line.maxLength ?? 120,
  creatorName: C.name.maxLength ?? 40,
  creatorLine: C.line.maxLength ?? 120,
  ctaLine: S.cta.shape.line.maxLength ?? 60,
  ctaContact: S.cta.shape.contact.maxLength ?? 80,
  school: S.schools.unwrap().element.maxLength ?? 60,
  skill: S.skills.unwrap().element.maxLength ?? 40,
  name: 80,
} as const

/** the PUT /v1/profiles/:id body (server.ts), around the shared ProfileSchema */
const Body = z.object({ name: z.string().min(1).max(MAX.name), data: ProfileSchema })
export type ProfileBody = { name: string; data: ProfileData }

/* ------------------------------------------------------------------- prepare */

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'profile'

/** the id a new profile is saved under, from its name */
export const profileId = (name: string) => slug(name)

/** list positions in the body, mapped back to the rows on screen (blank rows are dropped) */
interface Rows {
  points: number[]
  proof: number[]
  projects: number[]
}

/**
 * The form as the server wants it: every text cleaned, rows left fully blank dropped, and
 * optional fields left out when empty. A row that's only half filled stays, so validate()
 * can point at it instead of it quietly vanishing.
 */
export function prepare(d: ProfileData, name: string): { body: ProfileBody; rows: Rows } {
  const rows: Rows = { points: [], proof: [], projects: [] }
  const points: string[] = []
  d.points.forEach((p, i) => {
    const t = clean(p)
    if (!t) return
    points.push(t)
    rows.points.push(i)
  })
  const proof: ProfileData['proof'] = []
  d.proof.forEach((p, i) => {
    const value = clean(p.value)
    const label = clean(p.label)
    const where = clean(p.where ?? '')
    if (!value && !label && !where) return
    proof.push({ value, label, ...(where ? { where } : {}) })
    rows.proof.push(i)
  })
  const projects: NonNullable<ProfileData['projects']> = []
  ;(d.projects ?? []).forEach((x, i) => {
    const p = { name: clean(x.name), url: clean(x.url), line: clean(x.line) }
    if (!p.name && !p.url && !p.line) return
    projects.push(p)
    rows.projects.push(i)
  })
  // what you built that made the film: left out when blank, kept when half filled so it's checked
  const made = d.creator
    ? { name: clean(d.creator.name), url: clean(d.creator.url), line: clean(d.creator.line) }
    : null
  const creator = made && (made.name || made.url || made.line) ? made : undefined
  const company = clean(d.sender.company ?? '')
  const role = clean(d.sender.role ?? '')
  const book = clean(d.cta.book ?? '')
  const { book: _book, ...cta } = d.cta

  const data: ProfileData = {
    ...d,
    sender: {
      name: clean(d.sender.name),
      ...(company ? { company } : {}),
      ...(role ? { role } : {}),
    },
    offer: clean(d.offer),
    points,
    proof,
    cta: {
      ...cta,
      line: clean(d.cta.line),
      contact: clean(d.cta.contact),
      ...(book ? { book } : {}),
    },
    projects: projects.length ? projects : undefined,
    creator,
  }
  if (d.skills) data.skills = [...new Set(d.skills.map(clean).filter(Boolean))]
  if (d.schools) data.schools = [...new Set(d.schools.map(clean).filter(Boolean))]

  const job = d.preset === 'candidate'
  const label =
    clean(name) ||
    [data.sender.name, job ? data.sender.role : data.sender.company].filter(Boolean).join(', ')
  return { body: { name: label, data }, rows }
}

/* ------------------------------------------------------------------ validate */

/** what to say when a field the film needs was left empty, by path with '#' for a row */
const EMPTY: Record<string, string> = {
  'sender.name': 'Add your name',
  offer: 'Add one line on what you bring',
  'proof.#.value': 'Add the number',
  'proof.#.label': 'Say what this number measures',
  'cta.line': 'Add the ask the film ends on',
  'cta.contact': 'Add an email or a link',
  'projects.#.name': 'Give this project a name',
  'projects.#.url': 'Add the link, starting with https://',
  'projects.#.line': 'Add one line on what it does',
  'creator.name': 'Give what you built a name',
  'creator.url': 'Add the link, starting with https://',
  'creator.line': 'Add one line on what it is',
}

export type Checked =
  | { ok: true; body: ProfileBody }
  | { ok: false; message: string; fields: FieldError[] }

/**
 * Checks the form against ProfileSchema. Each problem comes back with the path of the field
 * on screen ('proof.2.label' is the third result row, even if a blank row above was dropped)
 * and one plain sentence for it.
 */
export function validate(d: ProfileData, name: string): Checked {
  const { body, rows } = prepare(d, name)
  const r = Body.safeParse(body)
  if (r.success) return { ok: true, body }
  return { ok: false, ...explain(r.error.issues, rows, body) }
}

/** a body path ('data.proof.1.label') as the path of the field on screen ('proof.2.label') */
function onScreen(path: PropertyKey[], rows: Rows): string[] {
  const parts = path.map(String)
  const inner = parts[0] === 'data' ? parts.slice(1) : parts
  const [list, n, ...rest] = inner
  if (list && n !== undefined && /^\d+$/.test(n)) {
    if (list === 'points' || list === 'proof' || list === 'projects') {
      const row = rows[list][Number(n)]
      return [list, String(row ?? n), ...rest]
    }
    // skills and schools are one comma-separated box each
    if (list === 'skills' || list === 'schools') return [list]
  }
  return inner
}

function valueAt(body: ProfileBody, path: PropertyKey[]): unknown {
  let at: unknown = body
  for (const k of path) at = at && typeof at === 'object' ? (at as never)[k as never] : undefined
  return at
}

/** Zod issues, reworded the way the server rewords them, keyed by the field on screen */
export function explain(
  issues: z.core.$ZodIssue[],
  rows: Rows,
  body: ProfileBody,
): { message: string; fields: FieldError[] } {
  // the shape fastify-type-provider-zod hands the server's error handler
  // an empty profile name comes from an empty sender name, which says it better
  const real = issues.filter((i) => !(i.path.join('.') === 'name' && i.code === 'too_small'))
  const shaped = real.map((issue) => {
    const { path, code, message, ...params } = issue
    return {
      keyword: code,
      instancePath: `/${onScreen(path, rows).join('/')}`,
      message,
      params,
      empty: valueAt(body, path) === '',
    }
  })
  const { fields } = humanize(shaped)
  const empties = new Set(
    shaped.filter((s) => s.empty).map((s) => s.instancePath.slice(1).replaceAll('/', '.')),
  )
  const worded = fields.map((f) => {
    const key = f.path.replace(/\.\d+(?=\.|$)/g, '.#')
    const own = empties.has(f.path) ? EMPTY[key] : undefined
    return own ? { path: f.path, message: own } : f
  })
  const first = worded[0]?.message ?? ''
  return {
    message:
      worded.length <= 1
        ? `${first}.`
        : `${worded.length} things need fixing. First: ${first.charAt(0).toLowerCase()}${first.slice(1)}.`,
    fields: worded,
  }
}

/** a field's error, or the error of the list it's in ("Add at least 2 strengths") */
export function errorsByField(fields: FieldError[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of fields) out[f.path] ??= f.message
  return out
}

/** typing in a field clears its own error and the error of the list it belongs to */
export function clearField(errors: Record<string, string>, path: string): Record<string, string> {
  const parts = path.split('.')
  const drop = new Set(parts.map((_, i) => parts.slice(0, i + 1).join('.')))
  if (![...drop].some((p) => p in errors)) return errors
  return Object.fromEntries(Object.entries(errors).filter(([k]) => !drop.has(k)))
}
