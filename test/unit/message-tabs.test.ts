import { describe, expect, it } from 'vitest'
import type { Messages } from '../../dashboard/src/api.ts'
import {
  disclosures,
  draftOf,
  HINT,
  messageTabs,
  noteCount,
  openingTab,
} from '../../dashboard/src/messageTabs.ts'
import { draftMessages } from '../../src/outreach/messages.ts'
import { ProfileSchema } from '../../src/script/types.ts'
import { profile } from '../helpers/index.ts'

const out = {
  company: 'Parcelpine',
  job: { title: 'Operations Analyst', url: 'https://jobs.lever.co/parcelpine/1' },
  highlights: {
    quote: { text: 'Dashboards operations teams use every day', source: 'your post' },
    proof: [{ value: '40%', label: 'faster month-end close', where: 'Initech' }],
  },
  script: {
    hook: 'h',
    noticed: 'n',
    insight: { factId: 'j1', why: 'w' },
    pitch: { headline: 'Why I fit your Operations Analyst role', points: ['a', 'b'] },
    proof: [0],
    cta: 'c',
  },
}
const link = 'https://share.example/f/x'
const candidate = draftMessages(out as never, profile('candidate'), link) as Messages
const hiringProfile = ProfileSchema.parse({
  ...profile('candidate'),
  preset: 'hiring',
  sender: { name: 'Hannah Brooks', role: 'Head of operations', company: 'Parcelpine' },
})
const hiring = draftMessages(out as never, hiringProfile, link) as Messages
const ids = (m: Messages) => messageTabs(m).map((t) => t.label)

describe('the film panel’s messages, in the order you send them', () => {
  it('lists the LinkedIn sequence, then the email and the follow-up', () => {
    expect(ids(candidate)).toEqual([
      'Connection note',
      'After they accept',
      'InMail',
      'Email',
      'Follow-up',
    ])
    expect(openingTab(candidate, false)).toBe('note')
  })

  it('opens a hiring film on its LinkedIn post, with no InMail tab', () => {
    expect(hiring.inmail).toBeUndefined()
    expect(ids(hiring)).toEqual([
      'LinkedIn post',
      'Connection note',
      'After they accept',
      'Email',
      'Follow-up',
    ])
    expect(openingTab(hiring, false)).toBe('post')
  })

  it('opens on the follow-up when one is due', () => {
    expect(openingTab(candidate, true)).toBe('followUp')
  })

  it('counts the connection note against 200 characters, and says the film comes later', () => {
    expect(noteCount(candidate.linkedin)).toBe(`${candidate.linkedin.length} of 200 characters`)
    expect(candidate.linkedin.length).toBeLessThanOrEqual(200)
    expect(HINT.note).toBe(
      'Connect, Add a note, paste. No link: the film goes in the message once they accept.',
    )
    expect(HINT.afterAccept).toBe('Send this once they accept your request.')
    expect(HINT.inmail).toMatch(/free only if they have an Open Profile/)
  })

  it('names the draft each tab shows, as the API does', () => {
    expect(draftOf('note')).toBe('note')
    expect(draftOf('followUp')).toBe('followUp')
    expect(draftOf('followUp', true)).toBe('lastNote')
    expect(draftOf('post')).toBeNull()
  })
})

describe('what a draft discloses', () => {
  it('says nothing for a model draft with no flags or notes', () => {
    const m = { writer: { email: 'model' as const }, flags: {}, notes: {} }
    for (const t of messageTabs(candidate))
      expect(disclosures(m, draftOf(t.id))).toEqual({ why: [], changed: [] })
  })

  it('says why an email is the template version, in the check’s own words', () => {
    const m = {
      writer: { email: 'template' as const, note: 'model' as const },
      flags: {
        email: [
          { rule: 'grounded', ok: false, why: 'It says 60%, which isn’t in your profile.' },
          { rule: 'length', ok: true },
        ],
      },
      notes: {},
    }
    expect(disclosures(m, 'email')).toEqual({
      why: ['It says 60%, which isn’t in your profile.'],
      changed: [],
    })
    expect(disclosures(m, 'note')).toEqual({ why: [], changed: [] })
  })

  it('shows only what was changed when code adjusted a kept model email', () => {
    const m = {
      writer: { email: 'model' as const },
      flags: {},
      notes: { email: ['The funding line was left out: it made the email too long.'] },
    }
    expect(disclosures(m, 'email')).toEqual({
      why: [],
      changed: ['The funding line was left out: it made the email too long.'],
    })
  })

  it('never claims a model draft fell back, even if a flag rode along', () => {
    const m = {
      writer: { inmail: 'model' as const },
      flags: { inmail: [{ rule: 'length', ok: false, why: 'Too long.' }] },
    }
    expect(disclosures(m, 'inmail').why).toEqual([])
  })
})
