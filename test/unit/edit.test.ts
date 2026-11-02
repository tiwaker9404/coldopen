import { describe, expect, it } from 'vitest'
import { applyEdit, precheckEdit } from '../../src/script/checks.ts'
import type { Script } from '../../src/script/types.ts'
import { attachment } from '../../src/share/download.ts'
import { profile } from '../helpers/index.ts'

const script: Script = {
  hook: 'Hi Acme team',
  noticed: 'Acme says 40,000 teams use it',
  insight: { factId: 'f1', why: 'I cut close time by 31%' },
  pitch: { headline: 'An analyst who ships dashboards', points: ['one', 'two'] },
  proof: [0, 1],
  cta: 'Talk this week?',
}

describe('editing a script', () => {
  it('changes only the lines given, trimmed', () => {
    const e = applyEdit(script, { hook: '  Hello Acme  ', points: ['a', ' ', 'b'] })
    expect(e.hook).toBe('Hello Acme')
    expect(e.pitch.points).toEqual(['a', 'b'])
    expect(e.noticed).toBe(script.noticed)
    expect(e.insight.factId).toBe('f1')
  })

  it('allows numbers the film or profile already had, and nothing else', () => {
    const known = `${script.noticed} ${script.insight.why}`
    expect(
      precheckEdit(applyEdit(script, { hook: '40,000 teams, Acme' }), profile('sales'), known),
    ).toEqual([])
    expect(
      precheckEdit(applyEdit(script, { cta: 'Saw 12x growth?' }), profile('sales'), known),
    ).toEqual([
      'The ask says "12x", which isn\'t in your profile or the film. Numbers have to come from one of those',
    ])
    expect(
      precheckEdit(applyEdit(script, { points: ['only one'] }), profile('sales'), known),
    ).toContain('Keep at least 2 points')
    expect(precheckEdit(applyEdit(script, { hook: '' }), profile('sales'), known)).toContain(
      'The greeting is empty',
    )
  })
})

describe('download names', () => {
  it('names the file, keeps its extension and strips anything unsafe', () => {
    expect(attachment('Linear - Alex Rivera', 'film-square.mp4')).toBe(
      'attachment; filename="Linear - Alex Rivera.mp4"',
    )
    expect(attachment('Linear.mp4', 'film-square.mp4')).toBe('attachment; filename="Linear.mp4"')
    expect(attachment('../../etc/"x"\r\nSet-Cookie: a', 'poster.jpg')).toBe(
      'attachment; filename="....etcxSet-Cookie a.jpg"',
    )
    expect(attachment('', 'poster.jpg')).toBeNull()
    expect(attachment(null, 'poster.jpg')).toBeNull()
  })
})
