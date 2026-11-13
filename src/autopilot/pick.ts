import type { Target } from '../jobs/targets.ts'
import { hostOf, WEEK_ZONE } from '../jobs/targets.ts'
import type { AutopilotSettings } from './settings.ts'

/**
 * Which companies today's Autopilot films are for. Pure and dated by `now`, like targets():
 * it takes Network this week's list in its order, so the best-scored companies go first, and
 * never makes anything itself. Days are Pacific, as the weekly target's are.
 */

export interface Day {
  /** the Pacific date, YYYY-MM-DD */
  date: string
  /** ISO weekday: Monday 1 … Sunday 7 */
  weekday: number
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** The Pacific date and weekday at `now`, across daylight saving changes */
export function dayOf(now: number, zone = WEEK_ZONE): Day {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  )
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: WEEKDAYS.indexOf(p.weekday!) + 1 }
}

/** Does Autopilot run today? Only when it's on and today is one of its days */
export function isOn(settings: Pick<AutopilotSettings, 'on' | 'days'>, now: number): boolean {
  return settings.on && settings.days.includes(dayOf(now).weekday)
}

export interface Picked {
  site: string
  company: string
  reasons: string[]
}

export interface Skipped {
  site: string
  why: string
}

export interface PickInput {
  /** Network this week's companies, best first */
  targets: Pick<Target, 'site' | 'company' | 'reasons'>[]
  settings: Pick<AutopilotSettings, 'perDay'>
  /** the websites of films Autopilot already made today */
  madeToday: string[]
  /** kept for the run's record; the pick itself doesn't depend on the hour */
  now: number
}

/**
 * Today's companies: Network this week's, in order, until the day's films are spoken for.
 * One with no website can't be filmed, and one already filmed today isn't filmed twice; both
 * are listed as skipped, with why. The rest of the list after the cap is left alone.
 */
export function pickToday({ targets, settings, madeToday }: PickInput): {
  picks: Picked[]
  skipped: Skipped[]
} {
  const made = new Set(madeToday.map(hostOf).filter(Boolean))
  const room = Math.max(0, settings.perDay - made.size)
  const picks: Picked[] = []
  const skipped: Skipped[] = []
  const taken = new Set<string>()
  for (const t of targets) {
    if (picks.length >= room) break
    const host = hostOf(t.site)
    if (!host) {
      skipped.push({ site: t.site, why: `${t.company} has no website to make the film from` })
      continue
    }
    if (made.has(host)) {
      skipped.push({ site: t.site, why: `${t.company} already got a film today` })
      continue
    }
    // the same company twice in the list (two spellings of one site) gets one film
    if (taken.has(host)) continue
    taken.add(host)
    picks.push({ site: t.site, company: t.company, reasons: t.reasons })
  }
  return { picks, skipped }
}
