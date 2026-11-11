import { readFileSync } from 'node:fs'
import { type Board, boardKey } from './boards.ts'
import type { YcBoard } from './yc-build.ts'

/**
 * Companies whose public job boards coldopen searches by default: AI, developer tools, data and
 * fintech companies that hire engineers, solutions and forward deployed engineers, analysts and
 * go-to-market roles. Each board is checked against its live API by the "Job boards" workflow;
 * people add any other Greenhouse, Lever or Ashby board from the app.
 */
const LIST: [Board['ats'], string, string, string][] = [
  // [ats, board token, name, website]
  ['greenhouse', 'anthropic', 'Anthropic', 'https://www.anthropic.com/'],
  ['greenhouse', 'databricks', 'Databricks', 'https://www.databricks.com/'],
  ['greenhouse', 'stripe', 'Stripe', 'https://stripe.com/'],
  ['greenhouse', 'figma', 'Figma', 'https://www.figma.com/'],
  ['greenhouse', 'vercel', 'Vercel', 'https://vercel.com/'],
  ['greenhouse', 'airtable', 'Airtable', 'https://www.airtable.com/'],
  ['greenhouse', 'cloudflare', 'Cloudflare', 'https://www.cloudflare.com/'],
  ['greenhouse', 'datadog', 'Datadog', 'https://www.datadoghq.com/'],
  ['greenhouse', 'mongodb', 'MongoDB', 'https://www.mongodb.com/'],
  ['greenhouse', 'gitlab', 'GitLab', 'https://about.gitlab.com/'],
  ['greenhouse', 'samsara', 'Samsara', 'https://www.samsara.com/'],
  ['greenhouse', 'scaleai', 'Scale AI', 'https://scale.com/'],
  ['greenhouse', 'brex', 'Brex', 'https://www.brex.com/'],
  ['greenhouse', 'gusto', 'Gusto', 'https://gusto.com/'],
  ['greenhouse', 'okta', 'Okta', 'https://www.okta.com/'],
  ['greenhouse', 'elastic', 'Elastic', 'https://www.elastic.co/'],
  ['greenhouse', 'pagerduty', 'PagerDuty', 'https://www.pagerduty.com/'],
  ['greenhouse', 'twilio', 'Twilio', 'https://www.twilio.com/'],
  ['greenhouse', 'gleanwork', 'Glean', 'https://www.glean.com/'],
  ['greenhouse', 'fivetran', 'Fivetran', 'https://www.fivetran.com/'],
  ['greenhouse', 'grafanalabs', 'Grafana Labs', 'https://grafana.com/'],
  ['ashby', 'temporal', 'Temporal', 'https://temporal.io/'],
  ['greenhouse', 'cockroachlabs', 'Cockroach Labs', 'https://www.cockroachlabs.com/'],
  ['greenhouse', 'mercury', 'Mercury', 'https://mercury.com/'],
  ['greenhouse', 'affirm', 'Affirm', 'https://www.affirm.com/'],
  ['greenhouse', 'robinhood', 'Robinhood', 'https://robinhood.com/'],
  ['greenhouse', 'coinbase', 'Coinbase', 'https://www.coinbase.com/'],
  ['greenhouse', 'lattice', 'Lattice', 'https://lattice.com/'],
  ['greenhouse', 'asana', 'Asana', 'https://asana.com/'],
  ['greenhouse', 'intercom', 'Intercom', 'https://www.intercom.com/'],
  ['ashby', 'anyscale', 'Anyscale', 'https://www.anyscale.com/'],
  ['greenhouse', 'c3iot', 'C3 AI', 'https://c3.ai/'],
  ['greenhouse', 'snorkelai', 'Snorkel AI', 'https://snorkel.ai/'],
  ['greenhouse', 'togetherai', 'Together AI', 'https://www.together.ai/'],
  ['lever', 'palantir', 'Palantir', 'https://www.palantir.com/'],
  ['ashby', 'plaid', 'Plaid', 'https://plaid.com/'],
  ['lever', 'spotify', 'Spotify', 'https://www.spotify.com/'],
  ['ashby', 'openai', 'OpenAI', 'https://openai.com/'],
  ['ashby', 'ramp', 'Ramp', 'https://ramp.com/'],
  ['ashby', 'notion', 'Notion', 'https://www.notion.com/'],
  ['ashby', 'linear', 'Linear', 'https://linear.app/'],
  ['ashby', 'supabase', 'Supabase', 'https://supabase.com/'],
  ['ashby', 'cohere', 'Cohere', 'https://cohere.com/'],
  ['ashby', 'perplexity', 'Perplexity', 'https://www.perplexity.ai/'],
  ['ashby', 'harvey', 'Harvey', 'https://www.harvey.ai/'],
  ['ashby', 'sierra', 'Sierra', 'https://sierra.ai/'],
  ['ashby', 'decagon', 'Decagon', 'https://decagon.ai/'],
  ['ashby', 'langchain', 'LangChain', 'https://www.langchain.com/'],
  ['ashby', 'merge', 'Merge', 'https://www.merge.dev/'],
  ['ashby', 'modal', 'Modal', 'https://modal.com/'],
  ['ashby', 'replit', 'Replit', 'https://replit.com/'],
  ['ashby', 'cursor', 'Cursor', 'https://cursor.com/'],
  ['ashby', 'elevenlabs', 'ElevenLabs', 'https://elevenlabs.io/'],
  ['ashby', 'claylabs', 'Clay', 'https://www.clay.com/'],
  ['ashby', 'vanta', 'Vanta', 'https://www.vanta.com/'],
  ['ashby', 'writer', 'Writer', 'https://writer.com/'],
  ['ashby', 'pinecone', 'Pinecone', 'https://www.pinecone.io/'],
  ['ashby', 'deepgram', 'Deepgram', 'https://deepgram.com/'],
  ['ashby', 'baseten', 'Baseten', 'https://www.baseten.co/'],
  ['ashby', 'posthog', 'PostHog', 'https://posthog.com/'],
  ['ashby', 'resend', 'Resend', 'https://resend.com/'],
  ['ashby', 'mintlify', 'Mintlify', 'https://mintlify.com/'],
  ['ashby', 'warp', 'Warp', 'https://www.warp.dev/'],
  ['ashby', 'luminai', 'Luminai', 'https://www.luminai.com/'],
  ['ashby', 'netic', 'Netic', 'https://www.netic.ai/'],
  ['ashby', 'david-ai', 'David AI', 'https://www.withdavid.ai/'],
  ['ashby', 'cognition', 'Cognition', 'https://cognition.ai/'],
  ['ashby', 'browserbase', 'Browserbase', 'https://www.browserbase.com/'],
  ['ashby', 'livekit', 'LiveKit', 'https://livekit.io/'],
  ['ashby', 'zip', 'Zip', 'https://ziphq.com/'],
]

/**
 * Hiring YC companies' boards, from src/jobs/yc.json (rebuilt weekly by the "YC boards"
 * workflow from YC's own company directory).
 */
export const YC_BOARDS: YcBoard[] = (() => {
  try {
    const raw = JSON.parse(readFileSync(new URL('./yc.json', import.meta.url), 'utf8'))
    return Array.isArray(raw)
      ? (raw as YcBoard[]).map((y) =>
          y.site ? { ...y, site: y.site.replace(/^http:/, 'https:') } : y,
        )
      : []
  } catch {
    return []
  }
})()

const ycByKey = new Map(YC_BOARDS.map((y) => [boardKey(y), y]))

const host = (url: string | undefined) => {
  try {
    return new URL(url ?? '').hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}
const ycByHost = new Map(YC_BOARDS.filter((y) => y.site).map((y) => [host(y.site), y]))

/** The YC company behind a board or a website, if it's one of the hiring ones */
export function ycOf(by: { board?: Pick<Board, 'ats' | 'token'>; site?: string }) {
  const y =
    (by.board && ycByKey.get(boardKey(by.board))) || (by.site && ycByHost.get(host(by.site)))
  return y ? { batch: y.batch, slug: y.slug } : null
}

const CURATED: Board[] = LIST.map(([ats, token, name, site]) => ({ ats, token, name, site }))

/** The curated companies first, then every hiring YC company with a public board */
export const DEFAULT_BOARDS: Board[] = [
  ...CURATED,
  ...YC_BOARDS.filter((y) => !CURATED.some((c) => boardKey(c) === boardKey(y))).map(
    ({ ats, token, name, site }) => ({ ats, token, name, ...(site ? { site } : {}) }),
  ),
]

/** The curated list alone, for the weekly board check */
export const CURATED_BOARDS = CURATED

/** H-1B approvals per board, from src/jobs/visa.json (rebuilt monthly from USCIS's data) */
const VISA: Record<string, { approvals: number; year: number }> = (() => {
  try {
    const raw = JSON.parse(readFileSync(new URL('./visa.json', import.meta.url), 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
})()

/** The company's H-1B approvals in the latest fiscal year, when it had any */
export function visaOf(board: string): { approvals: number; year: number } | null {
  return VISA[board] ?? null
}

/** Each board's latest SEC Form D in the last 3 months, from src/jobs/raised.json (daily) */
const RAISED: Record<string, { date: string; filer: string; amount?: number }> = (() => {
  try {
    const raw = JSON.parse(readFileSync(new URL('./raised.json', import.meta.url), 'utf8'))
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
})()

/** how many companies have a recent Form D on file: the filter shows only when there are some */
export const RAISED_COUNT = Object.keys(RAISED).length

/** How far back a round counts as recent for the filter and badge: about 3 months */
export const RAISED_DAYS = 90

/**
 * Round sizes, from the dollars a Form D says were sold. Form D doesn't name the round, so these
 * are sizes, with the round that size usually is as a hint.
 */
export const ROUND_SIZES = {
  seed: { label: 'Under $3M', hint: 'usually pre-seed or seed', max: 3_000_000 },
  a: { label: '$3M to $20M', hint: 'usually Series A', max: 20_000_000 },
  b: { label: '$20M to $80M', hint: 'usually Series B', max: 80_000_000 },
  c: { label: '$80M and up', hint: 'usually Series C or later', max: Number.POSITIVE_INFINITY },
} as const
export type RoundSize = keyof typeof ROUND_SIZES

/** Which size a round was, or null when the filing didn't state a plain amount */
export function sizeOf(amount: number | undefined | null): RoundSize | null {
  if (!amount || amount <= 0) return null
  return (Object.keys(ROUND_SIZES) as RoundSize[]).find((k) => amount < ROUND_SIZES[k].max)!
}

/** The first day that counts, YYYY-MM-DD */
export function raisedSince(now = new Date()): string {
  return new Date(now.getTime() - RAISED_DAYS * 86_400_000).toISOString().slice(0, 10)
}

/** When the company filed a Form D (a private round), if it did in the last 3 months */
export function raisedOf(board: string): { date: string; filer: string; amount?: number } | null {
  const r = RAISED[board]
  return r && r.date >= raisedSince() ? r : null
}

const boardByHost = new Map(
  DEFAULT_BOARDS.filter((b) => b.site).map((b) => [host(b.site), boardKey(b)] as const),
)

/**
 * Every board's latest Form D as filed, by the company's website host, without the 3-month cut:
 * Network this week dates it against its own pinned `now`
 */
export function raisedByHost(): Record<string, { date: string; amount?: number }> {
  const out: Record<string, { date: string; amount?: number }> = {}
  for (const [key, r] of Object.entries(RAISED)) {
    const b = DEFAULT_BOARDS.find((x) => boardKey(x) === key)
    const h = b?.site ? host(b.site) : ''
    if (h) out[h] = r.amount ? { date: r.date, amount: r.amount } : { date: r.date }
  }
  return out
}

/** The company's latest Form D, found by its website (a film knows the site, not the board) */
export function raisedBySite(site: string): { date: string; filer: string } | null {
  const h = host(/^https?:\/\//.test(site) ? site : `https://${site}`)
  const key = h && boardByHost.get(h)
  return key ? raisedOf(key) : null
}
