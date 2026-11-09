import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ApiError, failure, SERVER_TROUBLE } from '../../dashboard/src/api.ts'
import { humanize } from '../../src/api/errors.ts'
import { ProfileSchema } from '../../src/script/types.ts'
import { profile } from '../helpers/index.ts'

/** the same shape fastify-type-provider-zod hands the error handler */
function issuesOf(schema: z.ZodType, value: unknown) {
  const r = schema.safeParse(value)
  if (r.success) throw new Error('expected the value to fail')
  return r.error.issues.map(({ path, code, message, ...params }) => ({
    keyword: code,
    instancePath: `/${path.join('/')}`,
    message,
    params,
  }))
}

const body = z.object({ name: z.string().min(1).max(80), data: ProfileSchema })
/** the parts of a profile these cases break */
interface Editable {
  offer?: string
  preset: string
  points: string[]
  proof: { value: string; label: string }[]
  cta: { book?: string }
}
const withProfile = (change: (p: Editable) => void) => {
  const p = structuredClone(profile('sales')) as unknown as Editable
  change(p)
  return humanize(issuesOf(body, { name: 'Maya', data: p }), 'body')
}

describe('humanize', () => {
  it('says how short a field is in plain words, and where', () => {
    const h = withProfile((p) => {
      p.proof[0]!.label = 'x'
    })
    expect(h.fields).toEqual([
      { path: 'proof.0.label', message: 'What result 1 measures needs at least 3 characters' },
    ])
    expect(h.message).toBe('What result 1 measures needs at least 3 characters.')
  })

  it('says how long a field can be', () => {
    const h = withProfile((p) => {
      p.proof[0]!.value = '1,234,567,890 users'
    })
    expect(h.fields[0]).toEqual({
      path: 'proof.0.value',
      message: 'The number in result 1 can be at most 12 characters',
    })
  })

  it('turns a pattern check into what the link should look like', () => {
    const h = withProfile((p) => {
      p.cta.book = 'cal.com/maya'
    })
    expect(h.fields[0]).toEqual({
      path: 'cta.book',
      message: 'A booking link starts with https://',
    })
    const bare = humanize(
      issuesOf(z.object({ site: z.string().regex(/^https:\/\//) }), { site: 'x.com' }),
    )
    expect(bare.fields[0]!.message).toBe('Site should start with https://')
  })

  it('names a missing field', () => {
    const h = withProfile((p) => {
      delete p.offer
    })
    expect(h.fields[0]).toEqual({ path: 'offer', message: 'What you offer is missing' })
  })

  it('asks for more items when a list is too short', () => {
    const h = withProfile((p) => {
      p.points = ['Only one strength here']
    })
    expect(h.fields[0]).toEqual({ path: 'points', message: 'Add at least 2 strengths' })
  })

  it('counts several problems in one sentence and lists each field once', () => {
    const h = withProfile((p) => {
      const q = p
      q.offer = ''
      q.points = []
    })
    expect(h.fields.map((f) => f.path)).toEqual(['offer', 'points'])
    expect(h.message).toBe(
      '2 things need fixing. First: what you offer needs at least 3 characters.',
    )
  })

  it('falls back to a plain sentence for checks it has no words for', () => {
    const h = humanize([
      { keyword: 'not_multiple_of', instancePath: '/data/stepSize', message: 'Invalid input' },
    ])
    expect(h.fields[0]).toEqual({
      path: 'stepSize',
      message: "Some of what you entered isn't valid: step size",
    })
    expect(humanize([], 'querystring').message).toBe(
      "Something in that link isn't valid. Check it and try again.",
    )
  })

  it('never echoes Zod wording or symbols', () => {
    const h = withProfile((p) => {
      const q = p
      q.offer = 'x'.repeat(200)
      q.proof = []
      q.preset = 'nope'
    })
    for (const f of [h.message, ...h.fields.map((x) => x.message)])
      expect(f).not.toMatch(/expected|received|>=|<=|Too (small|big)|Invalid/)
  })
})

describe('what the app says when a call fails', () => {
  it('passes the server sentence and fields through', () => {
    const e = failure(400, {
      error: {
        code: 'invalid_request',
        message: 'Add at least 2 strengths.',
        fields: [{ path: 'points', message: 'Add at least 2 strengths' }],
      },
    })
    expect(e).toBeInstanceOf(ApiError)
    expect(e).toMatchObject({
      status: 400,
      code: 'invalid_request',
      message: 'Add at least 2 strengths.',
    })
    expect(e.fields).toHaveLength(1)
  })

  it('says the app is waking up when the host answers for it', () => {
    for (const s of [502, 503, 504])
      expect(failure(s, null)).toMatchObject({
        code: 'waking',
        message: expect.stringMatching(/waking up/),
      })
  })

  it('never shows "internal error" or a bare status', () => {
    expect(failure(500, { error: { code: 'internal', message: 'internal error' } }).message).toBe(
      SERVER_TROUBLE,
    )
    expect(failure(418, null).message).toBe("That didn't work (error 418). Try again.")
  })
})
