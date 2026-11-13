import { z } from 'zod'

/**
 * Autopilot's settings, as PUT /v1/autopilot takes them. The web app's form checks against
 * this same schema, so the two can't disagree about what's allowed or how it's said.
 */

export const FORMATS = ['square', 'landscape', 'portrait'] as const
export const PER_DAY_MIN = 1
export const PER_DAY_MAX = 25

/** where a run's summary can go: a Slack or Discord incoming webhook, nothing else */
export function webhookOk(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
    if (u.hostname === 'hooks.slack.com') return u.pathname.length > 1
    if (u.hostname === 'discord.com') return u.pathname.startsWith('/api/webhooks/')
    return false
  } catch {
    return false
  }
}

export const WEBHOOK_RULE =
  'the webhook must be an https link on hooks.slack.com or discord.com/api/webhooks'

export const AutopilotSchema = z.object({
  on: z.boolean(),
  perDay: z
    .number({ error: 'films a weekday must be a whole number from 1 to 25' })
    .int('films a weekday must be a whole number from 1 to 25')
    .min(PER_DAY_MIN, 'films a weekday must be a whole number from 1 to 25')
    .max(PER_DAY_MAX, 'films a weekday must be a whole number from 1 to 25'),
  /** ISO weekdays, Monday = 1 */
  days: z
    .array(z.number().int().min(1).max(7))
    .max(7)
    .transform((d) => [...new Set(d)].sort((a, b) => a - b)),
  profileId: z.string().max(40).nullable(),
  format: z.enum(FORMATS),
  webhook: z
    .string()
    .trim()
    .max(500)
    .nullable()
    .transform((w) => (w ? w : null))
    .refine((w) => w === null || webhookOk(w), WEBHOOK_RULE),
})

export type AutopilotSettings = z.output<typeof AutopilotSchema>

export const DEFAULT_SETTINGS: AutopilotSettings = {
  on: false,
  perDay: 20,
  days: [1, 2, 3, 4, 5],
  profileId: null,
  format: 'square',
  webhook: null,
}
