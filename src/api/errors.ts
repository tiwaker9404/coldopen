/**
 * Turns a request that failed validation into words a person can act on.
 *
 * Fastify hands the error handler one entry per Zod issue (from fastify-type-provider-zod):
 * `{ keyword: issue code, instancePath: '/data/proof/0/label', message, params }`. Those
 * messages read like code ("Too small: expected string to have >=3 characters"), and the web
 * app shows whatever the server says, so this is the one place they become sentences.
 */

export interface FieldError {
  /** dotted path inside the request part, e.g. 'proof.0.label' */
  path: string
  message: string
}

export interface HumanError {
  message: string
  fields: FieldError[]
}

interface Issue {
  keyword?: string
  instancePath?: string
  message?: string
  params?: Record<string, unknown>
}

/**
 * What each field is called in the app, keyed by its path with list positions as '#'.
 * A '#' in the name becomes the 1-based position, so 'proof.1.label' reads "what result 2 measures".
 */
const NAMES: Record<string, string> = {
  name: 'the name',
  preset: 'the profile type',
  'sender.name': 'your name',
  'sender.company': 'your company',
  'sender.role': 'your role',
  'sender.linkedin': 'your LinkedIn link',
  'sender.photo': 'the link to your photo',
  'recipient.name': "the candidate's name",
  'recipient.role': "the candidate's role",
  offer: 'what you offer',
  points: 'strengths',
  'points.#': 'strength #',
  proof: 'results',
  'proof.#.value': 'the number in result #',
  'proof.#.label': 'what result # measures',
  'proof.#.where': 'where result # happened',
  'proof.#.did': 'what you did for result #',
  cta: 'the ask',
  'cta.line': 'the ask',
  'cta.contact': 'your contact',
  'cta.book': 'the booking link',
  projects: 'projects',
  'projects.#.name': 'the name of project #',
  'projects.#.url': 'the link for project #',
  'projects.#.line': 'the line about project #',
  creator: 'what you built',
  'creator.name': 'the name of what you built',
  'creator.url': 'the link to what you built',
  'creator.line': 'the line about what you built',
  detail: 'what you noticed using it',
  question: 'your question for them',
  built: 'what you built with it',
  'built.url': 'the link to what you built with it',
  'built.line': 'the line about what you built with it',
  schools: 'schools',
  'schools.#': 'school #',
  skills: 'skills',
  'skills.#': 'skill #',
  url: 'the website',
  urls: 'websites',
  'urls.#': 'website #',
  job: 'the job',
  jobText: 'the job description',
  email: 'the email address',
  id: 'the id',
  profile: 'the profile',
  profileId: 'the profile',
  format: 'the format',
  limit: 'the limit',
}

/** fields that are lists, so "too small" means "add more of them" */
const LISTS = new Set(['points', 'proof', 'projects', 'schools', 'skills', 'urls'])

const TYPES: Record<string, string> = {
  string: 'text',
  number: 'a number',
  int: 'a whole number',
  boolean: 'yes or no',
  array: 'a list',
  object: 'a group of fields',
}

/** Request bodies that wrap a profile put it under `data`; people know it as the profile. */
function segments(issue: Issue): string[] {
  const parts = (issue.instancePath ?? '').split('/').filter(Boolean)
  return parts[0] === 'data' && parts.length > 1 ? parts.slice(1) : parts
}

function nameOf(parts: string[]): string {
  const key = parts.map((p) => (/^\d+$/.test(p) ? '#' : p)).join('.')
  const nth = parts.filter((p) => /^\d+$/.test(p)).map((p) => String(Number(p) + 1))
  const known = NAMES[key]
  if (known) {
    let i = 0
    return known.replace(/#/g, () => nth[i++] ?? '')
  }
  // fall back to the last named segment in plain words: "jobText" -> "job text"
  const last = [...parts].reverse().find((p) => !/^\d+$/.test(p))
  if (!last) return 'this field'
  const words = last.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return nth.length ? `${words} ${nth.at(-1)}` : words
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A message written by hand in a schema ("a booking link starts with https://") is already plain. */
function handWritten(message: string | undefined): string | null {
  if (!message) return null
  if (/^(invalid|too (small|big)|expected|unrecognized)/i.test(message)) return null
  if (/[<>=]{1,2}\s*\d|received |\{|\}/.test(message)) return null
  return cap(message)
}

function sentence(issue: Issue, parts: string[]): string {
  const field = nameOf(parts)
  const p = issue.params ?? {}
  const origin = String(p.origin ?? '')
  const isList = origin === 'array' || origin === 'set' || LISTS.has(parts.at(-1) ?? '')
  const min = Number(p.minimum)
  const max = Number(p.maximum)
  const own = handWritten(issue.message)

  switch (issue.keyword) {
    case 'too_small':
      if (isList) return min <= 1 ? `Add at least one to ${field}` : `Add at least ${min} ${field}`
      if (origin === 'string')
        return min <= 1
          ? `${cap(field)} can't be empty`
          : `${cap(field)} needs at least ${plural(min, 'character')}`
      return `${cap(field)} should be at least ${min}`
    case 'too_big':
      if (isList) return `Keep ${field} to ${max} at most`
      if (origin === 'string') return `${cap(field)} can be at most ${plural(max, 'character')}`
      return `${cap(field)} should be at most ${max}`
    case 'invalid_type': {
      // Zod 4 says "received undefined" when the field was left out
      if (/received undefined/.test(issue.message ?? '')) return `${cap(field)} is missing`
      const expected = TYPES[String(p.expected)] ?? String(p.expected ?? 'something else')
      return `${cap(field)} should be ${expected}`
    }
    case 'invalid_format': {
      if (own) return own
      const pattern = String(p.pattern ?? '')
      if (pattern.includes('https')) return `${cap(field)} should start with https://`
      if (p.format === 'email') return `${cap(field)} should be an email address`
      if (p.format === 'url') return `${cap(field)} should be a web address`
      return `${cap(field)} isn't in a format we can use`
    }
    case 'invalid_value': {
      const values = Array.isArray(p.values) ? p.values.map(String) : []
      return values.length
        ? `${cap(field)} should be one of: ${values.join(', ')}`
        : `${cap(field)} isn't one we can use`
    }
    case 'unrecognized_keys': {
      const keys = Array.isArray(p.keys) ? p.keys.map(String) : []
      return `We don't know ${keys.length === 1 ? 'the field' : 'the fields'} ${keys.join(', ')}`
    }
    default:
      return own ?? `Some of what you entered isn't valid: ${field}`
  }
}

/**
 * One plain message for the whole request plus one line per field, for the form to show
 * next to each input. `context` is the request part that failed (body, querystring, params).
 */
export function humanize(validation: unknown, context?: string): HumanError {
  const issues = (Array.isArray(validation) ? validation : []) as Issue[]
  const fields: FieldError[] = []
  for (const issue of issues) {
    const parts = segments(issue)
    const path = parts.join('.')
    // one line per field: a field can fail two checks, and the first says enough
    if (fields.some((f) => f.path === path)) continue
    fields.push({ path, message: sentence(issue, parts) })
  }
  if (!fields.length) {
    const where = context === 'querystring' || context === 'params' ? 'link' : 'request'
    return { message: `Something in that ${where} isn't valid. Check it and try again.`, fields }
  }
  const first = fields[0]!.message
  const message =
    fields.length === 1
      ? `${first}.`
      : `${plural(fields.length, 'thing')} need fixing. First: ${first.charAt(0).toLowerCase()}${first.slice(1)}.`
  return { message, fields }
}
