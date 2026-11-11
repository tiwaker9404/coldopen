import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProfileData } from '../../dashboard/src/api.ts'
import {
  clean,
  clearField,
  MAX,
  pasteInto,
  prepare,
  validate,
} from '../../dashboard/src/profileForm.ts'
import { ProfileSchema } from '../../src/script/types.ts'

const good: ProfileData = {
  preset: 'candidate',
  sender: { name: 'Ashwin Tiwari', role: 'Solutions engineer' },
  offer: 'An engineer who ships data tools teams use',
  points: ['Built dashboards a leadership team used weekly', 'Shipped an open-source film agent'],
  proof: [{ value: '57%', label: 'reply rate on films', where: 'coldopen' }],
  cta: { line: 'Worth a 15-minute call?', contact: 'ashwin@example.com' },
}

const fieldsOf = (d: ProfileData, name = '') => {
  const r = validate(d, name)
  return r.ok ? {} : Object.fromEntries(r.fields.map((f) => [f.path, f.message]))
}

describe('clean: pasted text becomes one tidy line', () => {
  it('strips résumé bullets and joins the items so they still read apart', () => {
    expect(clean('• Cut churn by a third\n• Led 4 launches\n• Ran onboarding')).toBe(
      'Cut churn by a third; Led 4 launches; Ran onboarding',
    )
    expect(clean('- one\n* two\n1. three\n2) four\n(3) five')).toBe('one; two; three; four; five')
  })

  it('joins a sentence that only wrapped with a space, and collapses stray whitespace', () => {
    expect(clean('  Built dashboards a\n  leadership   team\tused weekly  ')).toBe(
      'Built dashboards a leadership team used weekly',
    )
    expect(clean('Line one.\r\n\r\n• Line two')).toBe('Line one. Line two')
  })

  it('keeps smart quotes, inner dashes and numbers that look like bullets', () => {
    expect(clean('“Fastest” close — ever')).toBe('“Fastest” close — ever')
    expect(clean('-30%')).toBe('-30%')
    expect(clean('1.5x faster')).toBe('1.5x faster')
    expect(clean('it’s 3 - 4 weeks')).toBe('it’s 3 - 4 weeks')
  })

  it('pastes the cleaned text in at the cursor, and leaves an ordinary paste to the browser', () => {
    expect(pasteInto('', '• a\n• b', 0, 0)).toEqual({ value: 'a; b', caret: 4 })
    expect(pasteInto('Led', '\n4 launches', 3, 3)).toEqual({ value: 'Led 4 launches', caret: 14 })
    expect(pasteInto('ab', 'plain', 1, 1)).toBeNull()
  })
})

describe('validate: the same rules as ProfileSchema, said per field', () => {
  it('passes a good profile and names it after the sender', () => {
    const r = validate(good, '')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.body.name).toBe('Ashwin Tiwari, Solutions engineer')
      expect(ProfileSchema.safeParse(r.body.data).success).toBe(true)
    }
  })

  it('points at a result label that is too short, on the row you typed it in', () => {
    const d = {
      ...good,
      // a blank row above is dropped, but the error still lands on the third row
      proof: [good.proof[0]!, { value: '', label: '', where: '' }, { value: '3', label: 'ab' }],
    }
    const f = fieldsOf(d)
    expect(Object.keys(f)).toEqual(['proof.2.label'])
    expect(f['proof.2.label']).toBe('What result 3 measures needs at least 3 characters')
  })

  it('says a proof number over 12 characters is too long, with the limit', () => {
    expect(MAX.proofValue).toBe(12)
    const f = fieldsOf({ ...good, proof: [{ value: '1,234,567,890%', label: 'rows a day' }] })
    expect(f['proof.0.value']).toBe('The number in result 1 can be at most 12 characters')
  })

  it('asks for https:// on booking and project links', () => {
    const f = fieldsOf({
      ...good,
      cta: { ...good.cta, book: 'cal.com/me/15min' },
      projects: [{ name: 'coldopen', url: 'http://github.com/me/coldopen', line: 'Films' }],
    })
    expect(f['cta.book']).toBe('A booking link starts with https://')
    expect(f['projects.0.url']).toBe('A project link starts with https://')
  })

  it('drops a fully blank project row but flags one that is half filled', () => {
    const blank = { name: '', url: '', line: '' }
    expect(validate({ ...good, projects: [blank] }, '').ok).toBe(true)
    const f = fieldsOf({
      ...good,
      projects: [blank, { name: 'unkillable', url: 'https://github.com/me/unkillable', line: '' }],
    })
    expect(f).toEqual({ 'projects.1.line': 'Add one line on what it does' })
  })

  it('matches ProfileSchema on what it rejects', () => {
    const cases: ProfileData[] = [
      { ...good, points: ['Only one strength'] },
      { ...good, offer: 'ab' },
      { ...good, sender: { name: '' } },
      { ...good, proof: [{ value: '9', label: 'x'.repeat(61) }] },
      { ...good, cta: { ...good.cta, line: 'Hi' } },
    ]
    for (const d of cases) {
      expect(validate(d, '').ok).toBe(ProfileSchema.safeParse(prepare(d, '').body.data).success)
      expect(validate(d, '').ok).toBe(false)
    }
    expect(fieldsOf({ ...good, points: ['Only one strength', ''] })).toEqual({
      points: 'Add at least 2 strengths',
    })
    expect(fieldsOf({ ...good, sender: { name: '' } })).toEqual({ 'sender.name': 'Add your name' })
  })

  it('cleans pasted bullets on save, and catches what is still too long', () => {
    const r = validate(
      { ...good, points: ['• Built dashboards\n', '  - Shipped a film agent'] },
      '',
    )
    expect(r.ok && r.body.data.points).toEqual(['Built dashboards', 'Shipped a film agent'])
    const long = '• Cut churn by a third\n• Led 4 launches\n• Ran onboarding for 40 accounts'
    const f = fieldsOf({ ...good, proof: [{ value: '33%', label: long }] })
    expect(f['proof.0.label']).toBe('What result 1 measures can be at most 60 characters')
  })

  it('typing in a field clears its own error and its list’s', () => {
    const e = { 'proof.0.label': 'x', proof: 'y', offer: 'z' }
    expect(clearField(e, 'proof.0.label')).toEqual({ offer: 'z' })
    expect(clearField(e, 'points.1')).toBe(e)
  })
})

describe('saved profiles come back from the editor unchanged', () => {
  const dir = join(import.meta.dirname, '../../profiles')
  const files = [
    ...readdirSync(join(dir, 'examples')).map((f) => join(dir, 'examples', f)),
    ...readdirSync(dir)
      .filter((f) => f.endsWith('.example.json'))
      .map((f) => join(dir, f)),
  ]
  it.each(files.map((f) => [f.split('/').pop()!, f]))('%s', (_, file) => {
    const data = JSON.parse(readFileSync(file, 'utf8')) as ProfileData
    const r = validate(data, 'Saved name')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.body.name).toBe('Saved name')
      expect(JSON.parse(JSON.stringify(r.body.data))).toEqual(data)
    }
  })
})

describe('the creator line: something you built that made the film', () => {
  // a profile as GET /v1/profiles returned it before the creator line existed
  const saved = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../fixtures/profiles/saved-candidate.json'), 'utf8'),
  ) as { name: string; data: ProfileData }
  const creator = {
    name: 'coldopen',
    url: 'https://github.com/alex-rivera/coldopen',
    line: 'I built the tool that made this film',
  }

  it('a profile with a creator round-trips', () => {
    const data = { ...saved.data, creator }
    const r = validate(data, saved.name)
    expect(r.ok).toBe(true)
    if (r.ok) expect(JSON.parse(JSON.stringify(r.body.data))).toEqual(data)
    expect(ProfileSchema.parse(data)).toEqual(data)
    // half filled is pointed at, not dropped
    const half = fieldsOf({ ...saved.data, creator: { ...creator, url: 'github.com/x' } })
    expect(half['creator.url']).toBe('A link to what you built starts with https://')
  })

  it('a profile without one still validates', () => {
    expect(ProfileSchema.safeParse(saved.data).success).toBe(true)
    const r = validate(saved.data, saved.name)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(JSON.parse(JSON.stringify(r.body.data))).toEqual(saved.data)
      expect('creator' in JSON.parse(JSON.stringify(r.body.data))).toBe(false)
    }
    // a blank creator section in the editor saves as no creator at all
    const blank = validate({ ...saved.data, creator: { name: '', url: '', line: ' ' } }, saved.name)
    expect(blank.ok && 'creator' in JSON.parse(JSON.stringify(blank.body.data))).toBe(false)
  })
})

describe('what you did, under each result', () => {
  // a profile as GET /v1/profiles returned it before results had "what you did"
  const saved = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../fixtures/profiles/saved-candidate.json'), 'utf8'),
  ) as { name: string; data: ProfileData }
  const did = 'Built containerized ETL with Docker and PostgreSQL'

  it('keeps an old profile without it valid and unchanged', () => {
    expect(saved.data.proof.every((p) => p.did === undefined)).toBe(true)
    expect(ProfileSchema.safeParse(saved.data).success).toBe(true)
    const r = validate(saved.data, saved.name)
    expect(r.ok).toBe(true)
    if (r.ok) expect(JSON.parse(JSON.stringify(r.body.data))).toEqual(saved.data)
  })

  it('round-trips through the editor, tidied, and is left out when blank', () => {
    const typed: ProfileData = {
      ...good,
      proof: [
        {
          value: '6h → 45m',
          label: 'daily client data sync',
          where: 'Rail Inc.',
          did: `  ${did}\n`,
        },
        { value: '57%', label: 'reply rate on films', where: 'coldopen', did: '  ' },
      ],
    }
    const r = validate(typed, '')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.body.data.proof).toEqual([
      { value: '6h → 45m', label: 'daily client data sync', where: 'Rail Inc.', did },
      { value: '57%', label: 'reply rate on films', where: 'coldopen' },
    ])
    // saved and opened again, it's the same
    const again = validate(r.body.data, r.body.name)
    expect(again.ok && again.body.data).toEqual(r.body.data)
    expect(ProfileSchema.parse(r.body.data).proof[0]!.did).toBe(did)
  })

  it('says, on its own row, when it is too short or too long', () => {
    expect(MAX.proofDid).toBe(90)
    const f = fieldsOf({
      ...good,
      proof: [
        { value: '1', label: 'blank row stays', where: 'x' },
        { value: '6h → 45m', label: 'daily client data sync', did: 'Built ETL' },
        { value: '9', label: 'nine things', did: `Built ${'x'.repeat(90)}` },
      ],
    })
    expect(f['proof.1.did']).toBe('What you did for result 2 needs at least 12 characters')
    expect(f['proof.2.did']).toBe('What you did for result 3 can be at most 90 characters')
    // a row with only "what you did" typed is kept, so it can say what's missing
    const { body } = prepare({ ...good, proof: [{ value: '', label: '', did }] }, '')
    expect(body.data.proof).toEqual([{ value: '', label: '', did }])
  })
})
