import { describe, expect, it } from 'vitest'
import { dayOf, isOn, pickToday } from '../../src/autopilot/pick.ts'
import { AutopilotSchema, DEFAULT_SETTINGS, webhookOk } from '../../src/autopilot/settings.ts'

const at = (iso: string) => Date.parse(iso)
const t = (company: string, site: string) => ({ company, site, reasons: [`${company} fits`] })
const LIST = [
  t('Acme', 'https://acme.com'),
  t('Nosite', ''),
  t('Globex', 'https://www.globex.com/about'),
  t('Initech', 'https://initech.io'),
  t('Umbrella', 'https://umbrella.dev'),
  t('Hooli', 'https://hooli.xyz'),
]

describe('dayOf and isOn', () => {
  it('reads the day in Pacific time, so Friday evening is still Friday', () => {
    // 03:00 UTC Saturday is 19:00 Friday in Los Angeles
    expect(dayOf(at('2026-11-14T03:00:00Z'))).toEqual({ date: '2026-11-13', weekday: 5 })
    expect(dayOf(at('2026-11-14T09:00:00Z'))).toEqual({ date: '2026-11-14', weekday: 6 })
  })

  it('turns Sunday into Monday at Pacific midnight on both sides of a daylight saving change', () => {
    // autumn: clocks went back on Sunday 1 November 2026, so midnight is 08:00 UTC
    expect(dayOf(at('2026-11-02T07:59:00Z'))).toEqual({ date: '2026-11-01', weekday: 7 })
    expect(dayOf(at('2026-11-02T08:00:00Z'))).toEqual({ date: '2026-11-02', weekday: 1 })
    // spring: clocks went forward on Sunday 8 March 2026, so midnight is 07:00 UTC
    expect(dayOf(at('2026-03-09T06:59:00Z'))).toEqual({ date: '2026-03-08', weekday: 7 })
    expect(dayOf(at('2026-03-09T07:00:00Z'))).toEqual({ date: '2026-03-09', weekday: 1 })
  })

  it('runs on its weekdays only, and never when it is off', () => {
    const on = { ...DEFAULT_SETTINGS, on: true }
    expect(isOn(on, at('2026-11-13T18:00:00Z'))).toBe(true) // Friday
    expect(isOn(on, at('2026-11-14T18:00:00Z'))).toBe(false) // Saturday
    expect(isOn(on, at('2026-11-15T18:00:00Z'))).toBe(false) // Sunday
    expect(isOn({ ...on, days: [6] }, at('2026-11-14T18:00:00Z'))).toBe(true)
    expect(isOn(DEFAULT_SETTINGS, at('2026-11-13T18:00:00Z'))).toBe(false)
    // just after midnight on Monday after the autumn change
    expect(isOn(on, at('2026-11-02T08:30:00Z'))).toBe(true)
  })
})

describe('pickToday', () => {
  const now = at('2026-11-13T18:00:00Z')

  it('keeps the list order and stops at films a weekday', () => {
    const r = pickToday({ targets: LIST, settings: { perDay: 3 }, madeToday: [], now })
    expect(r.picks.map((p) => p.company)).toEqual(['Acme', 'Globex', 'Initech'])
    expect(r.picks[0]!.reasons).toEqual(['Acme fits'])
  })

  it('skips a company with no website, and says why', () => {
    const r = pickToday({ targets: LIST, settings: { perDay: 20 }, madeToday: [], now })
    expect(r.picks.map((p) => p.company)).not.toContain('Nosite')
    expect(r.skipped).toEqual([{ site: '', why: 'Nosite has no website to make the film from' }])
    expect(r.picks).toHaveLength(5)
  })

  it('counts the films already made today against the cap, and does not film them twice', () => {
    const r = pickToday({
      targets: LIST,
      settings: { perDay: 3 },
      madeToday: ['globex.com', 'https://hooli.xyz/'],
      now,
    })
    // 3 a day with 2 made leaves room for one, and Globex isn't filmed again
    expect(r.picks.map((p) => p.company)).toEqual(['Acme'])
    const more = pickToday({
      targets: LIST,
      settings: { perDay: 4 },
      madeToday: ['globex.com', 'hooli.xyz'],
      now,
    })
    expect(more.picks.map((p) => p.company)).toEqual(['Acme', 'Initech'])
    expect(more.skipped.map((s) => s.why)).toEqual([
      'Nosite has no website to make the film from',
      'Globex already got a film today',
    ])
  })

  it('picks nothing once the day is spoken for', () => {
    const r = pickToday({
      targets: LIST,
      settings: { perDay: 1 },
      madeToday: ['acme.com', 'initech.io'],
      now,
    })
    expect(r).toEqual({ picks: [], skipped: [] })
  })

  it('gives the same answer every time for the same input', () => {
    const input = { targets: LIST, settings: { perDay: 2 }, madeToday: ['acme.com'], now }
    expect(pickToday(input)).toEqual(pickToday(input))
  })
})

describe('the settings', () => {
  it('takes 1 to 25 films a weekday, and says the range otherwise', () => {
    for (const perDay of [1, 20, 25])
      expect(AutopilotSchema.safeParse({ ...DEFAULT_SETTINGS, perDay }).success).toBe(true)
    for (const perDay of [0, 26, 2.5]) {
      const r = AutopilotSchema.safeParse({ ...DEFAULT_SETTINGS, perDay })
      expect(r.success).toBe(false)
      expect(r.error?.issues[0]?.message).toBe(
        'films a weekday must be a whole number from 1 to 25',
      )
    }
  })

  it('takes only https Slack and Discord webhooks', () => {
    expect(webhookOk('https://hooks.slack.com/services/T0/B0/xyz')).toBe(true)
    expect(webhookOk('https://discord.com/api/webhooks/123/abc')).toBe(true)
    for (const bad of [
      'http://hooks.slack.com/services/T0/B0/xyz',
      'https://hooks.slack.com.evil.com/services/x',
      'https://discord.com/channels/1/2',
      'https://evil.com/?hooks.slack.com',
      'https://user@hooks.slack.com/services/x',
      'not a link',
    ])
      expect(webhookOk(bad)).toBe(false)
    // an empty webhook means none
    expect(AutopilotSchema.parse({ ...DEFAULT_SETTINGS, webhook: '  ' }).webhook).toBeNull()
  })
})
