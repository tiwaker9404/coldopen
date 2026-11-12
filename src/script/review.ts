import type { Fact } from '../brand/types.ts'
import { readableProof } from '../profile/proof.ts'
import type { QaReport } from '../render/render.ts'
import { type FactContext, jobPitchIn, loosePronoun, notAlone } from './checks.ts'
import type { Profile, Script, ScriptMeta } from './types.ts'

/**
 * The review a sender sees before a film goes out: each of the six scenes with plain flags for
 * anything a founder would find odd, and the one-click fix for each. Pure: everything it reads
 * was saved with the film when it was made (the QA report, the brand and the quotable facts),
 * plus the sender's other recent films, to spot a line they all share.
 */

export const FLAGS = [
  'fact_out_of_context',
  'proof_unclear',
  'no_logo',
  'font_fallback',
  'headline_cut',
  'low_contrast',
  'templated_line',
  'job_words',
] as const
export type FlagCode = (typeof FLAGS)[number]

/** a line the sender can rewrite in the edit route, by its name there */
export type LineKey = 'hook' | 'noticed' | 'why' | 'headline' | 'points' | 'cta'

/** A fact the film may quote instead, with the words that go under it. */
export interface ReviewFact {
  id: string
  text: string
  kind: Fact['kind']
  /** "From their changelog, Oct 2026" */
  caption: string
  url?: string
}

/** What the film recorded about the brand when it was made (see film.ts). */
export interface FilmBrand {
  /** what the chip shows: their logo, or their name as a wordmark */
  logo: 'image' | 'wordmark'
  /** the captured logo's size, in page pixels */
  logoSize?: { width: number; height: number }
  /** the free fonts used for brand fonts that couldn't be embedded, by role */
  fallbacks: { display?: string; body?: string }
  fonts: { display: string; body: string }
  contrast: { field: string; part: 'text' | 'accent'; ratio: number; min: number }[]
  /** what they say they do (their headline and description), to judge if a quote is about them */
  about?: { headline: string; description: string }
}

export type Fix =
  | { kind: 'fact'; label: string; options: ReviewFact[] }
  | {
      kind: 'proof'
      label: string
      /** which card to replace, by its place on screen */
      slot: number
      options: { index: number; value: string; label: string; where?: string; did?: string }[]
    }
  | { kind: 'edit'; label: string; line: LineKey }
  | { kind: 'wordmark'; label: string }
  | { kind: 'none'; label: string }

export interface Flag {
  code: FlagCode
  /** one plain sentence: what's wrong, as a founder would see it */
  text: string
  fix: Fix
}

export const SCENES = ['hook', 'site', 'insight', 'pitch', 'proof', 'cta'] as const
export type SceneKind = (typeof SCENES)[number]
const SCENE_NAMES: Record<SceneKind, string> = {
  hook: 'The greeting',
  site: 'Their homepage',
  insight: 'What they published',
  pitch: 'What you’d try',
  proof: 'Your results',
  cta: 'The ask',
}

export interface ReviewScene {
  index: number
  kind: SceneKind
  name: string
  /** under the fact scene's quote: "From their homepage" */
  caption?: string
  flags: Flag[]
}

export interface Review {
  /** nothing flagged: the film panel says "Ready to send" */
  ready: boolean
  count: number
  scenes: ReviewScene[]
  /** the results the film shows, as indices into the profile's proof (for "Use another proof") */
  proof: number[]
}

/** The parts of a finished film the review reads. Older films may lack brand and facts. */
export interface ReviewInput {
  company: string
  profile: Profile
  script: Script
  scriptMeta?: ScriptMeta | null
  qa?: QaReport | null
  highlights?: {
    quote: { text: string; caption?: string }
    proof: { value: string; label: string; where?: string; did?: string }[]
  } | null
  /** the proof the film showed, as indices into profile.proof (the pick, else the script's) */
  proof?: number[]
  brand?: FilmBrand | null
  /** the facts the film could quote, the featured one included */
  facts?: ReviewFact[] | null
  /** the sender asked for their name as the logo */
  wordmark?: boolean
}

/** another recent film by the same sender, for spotting shared template lines */
export interface RecentFilm {
  company: string
  script: Script
  scriptMeta?: ScriptMeta | null
}

/** the smallest logo that still reads as one (the extract eval's bar) */
const LOGO_MIN = 18

const LINES: [LineKey, SceneKind, string][] = [
  ['hook', 'hook', 'The greeting'],
  ['noticed', 'site', 'What you noticed'],
  ['why', 'insight', 'Why it matters'],
  ['headline', 'pitch', 'The headline'],
  ['points', 'pitch', 'A point'],
  ['cta', 'cta', 'The ask'],
]

const lineText = (s: Script, k: LineKey): string[] =>
  k === 'hook'
    ? [s.hook]
    : k === 'noticed'
      ? [s.noticed]
      : k === 'why'
        ? [s.insight.why]
        : k === 'headline'
          ? [s.pitch.headline]
          : k === 'points'
            ? s.pitch.points
            : [s.cta]

/** a line with the company's name taken out, to compare lines across films */
function shape(line: string, company: string): string {
  const name = company.trim()
  const first = name.split(/\s+/)[0] ?? ''
  let t = line.toLowerCase()
  for (const n of [name, first].filter((x) => x.length >= 2))
    t = t.split(n.toLowerCase()).join('{company}')
  return t
    .replace(/[^\p{L}\p{N}{} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** lines the built-in writer wrote: all of them, or the ones swapped in for the model's */
function builtIn(meta: ScriptMeta | null | undefined): Set<LineKey> | 'all' {
  if (!meta || meta.model === 'deterministic' || meta.usedFallback) return 'all'
  const out = new Set<LineKey>()
  for (const r of meta.replaced) {
    const k = r.replace(/^insight\./, '').replace(/^pitch\./, '')
    if (LINES.some(([key]) => key === k)) out.add(k as LineKey)
  }
  return out
}

const card = (p: { value: string; label: string; did?: string }) =>
  `${p.did ?? ''} ${p.value} ${p.label}`.trim()

/** Does this proof card read on its own? Its own words stand in for the résumé bullet. */
export function proofReads(p: {
  value: string
  label: string
  where?: string
  did?: string
}): boolean {
  const r = readableProof({ ...p, where: p.where ?? '' }, card(p))
  return r.checks.has_action && r.checks.has_result && r.checks.has_where && r.checks.within_limits
}

/** what a proof card is missing, in the sender's terms */
function proofProblem(p: { value: string; label: string; where?: string; did?: string }): string {
  const r = readableProof({ ...p, where: p.where ?? '' }, card(p))
  const missing = [
    !r.checks.has_action && 'what you did',
    !r.checks.has_result && 'what changed',
    !r.checks.has_where && 'where it happened',
  ].filter(Boolean)
  if (missing.length)
    return `“${p.value} ${p.label}” doesn’t say ${missing.join(' or ')}, so a stranger can’t tell what it means.`
  return `“${p.value} ${p.label}” is too long to read on screen.`
}

/** Why the quoted line won't read on its own, in plain words, or null when it does. */
export function factProblem(text: string, company: FactContext): string | null {
  const loose = loosePronoun(text)
  if (loose)
    return `The quote says “${loose}” without saying what ${loose.toLowerCase() === 'they' ? 'they are' : 'it is'}, so it won’t make sense on its own.`
  const why = notAlone({ text }, company)
  return why ? `The quote won’t make sense on its own: ${why}.` : null
}

const sameText = (a: string, b: string) =>
  a.replace(/["“”]/g, '').trim().toLowerCase() === b.replace(/["“”]/g, '').trim().toLowerCase()

/**
 * Every scene of a finished film, with what a founder would find odd and the fix for each.
 * `recent` is the sender's other recent films (up to 10), newest first.
 */
export function reviewFilm(film: ReviewInput, recent: RecentFilm[] = []): Review {
  const flags = new Map<SceneKind, Flag[]>(SCENES.map((k) => [k, []]))
  const add = (k: SceneKind, f: Flag) => flags.get(k)!.push(f)
  const company: FactContext = { name: film.company, ...(film.brand?.about ?? {}) }
  const { script, profile } = film

  // the quote: stands alone, with nothing left pointing at a line before it
  const featured =
    film.facts?.find((f) => f.id === script.insight.factId) ??
    (film.highlights?.quote.text ? { text: film.highlights.quote.text, kind: 'quote' } : null)
  const caption = film.highlights?.quote.caption
  if (featured && featured.kind !== 'requirement') {
    const why = factProblem(featured.text, company)
    if (why) {
      const options = (film.facts ?? [])
        .filter(
          (f) =>
            f.id !== script.insight.factId &&
            !sameText(f.text, featured.text) &&
            (f.kind === 'requirement' || !factProblem(f.text, company)),
        )
        .slice(0, 3)
      add('insight', {
        code: 'fact_out_of_context',
        text: why,
        fix: options.length
          ? { kind: 'fact', label: 'Use another fact', options }
          : { kind: 'edit', label: 'Edit this line', line: 'why' },
      })
    }
  }

  // proof: each card reads on its own, or there's another one that does
  const shown = film.proof ?? script.proof
  const cards = shown.map((i) => profile.proof[i]).filter((p) => p !== undefined)
  const spare = profile.proof
    .map((p, index) => ({ index, ...p }))
    .filter((p) => !shown.includes(p.index) && proofReads(p))
  cards.forEach((p, slot) => {
    if (proofReads(p)) return
    add('proof', {
      code: 'proof_unclear',
      text: proofProblem(p),
      fix: spare.length
        ? { kind: 'proof', label: 'Use another proof', slot, options: spare }
        : {
            kind: 'none',
            label: 'Add “What you did” and where to this result in your profile',
          },
    })
  })

  // the logo: a real one, big enough to read, or their name the sender chose to show
  const brand = film.brand
  if (brand && !film.wordmark) {
    const small =
      brand.logo === 'image' &&
      brand.logoSize &&
      Math.min(brand.logoSize.width, brand.logoSize.height) < LOGO_MIN
    if (brand.logo === 'wordmark' || small)
      add('hook', {
        code: 'no_logo',
        text:
          brand.logo === 'wordmark'
            ? `We couldn’t find ${film.company}’s logo, so the film spells their name in their font. Check it looks right.`
            : `${film.company}’s logo came out favicon-sized, so it may look blurry.`,
        fix: { kind: 'wordmark', label: 'Use their name as the logo' },
      })
  }
  if (brand) {
    const swapped = [
      brand.fallbacks.display && `${brand.fonts.display} (shown in ${brand.fallbacks.display})`,
      brand.fallbacks.body &&
        brand.fonts.body !== brand.fonts.display &&
        `${brand.fonts.body} (shown in ${brand.fallbacks.body})`,
    ].filter(Boolean)
    if (swapped.length)
      add('hook', {
        code: 'font_fallback',
        text: `${film.company}’s font couldn’t be used in the film, so it uses the closest free one: ${swapped.join(', ')}.`,
        fix: { kind: 'none', label: 'Nothing to fix; just check it still looks like them' },
      })
    for (const c of brand.contrast.filter((x) => x.ratio < x.min))
      add(c.field === 'light' ? 'site' : c.field === 'dark' ? 'proof' : 'insight', {
        code: 'low_contrast',
        text: `Some ${c.part === 'text' ? 'text' : 'highlights'} on the ${c.field === 'brand' ? 'brand-colored' : c.field} scenes is hard to read (${c.ratio.toFixed(1)}:1, needs ${c.min}:1).`,
        fix: { kind: 'none', label: 'Their colors leave no readable choice; check it on a phone' },
      })
  }

  // framing and fit: the highlighted headline in frame, every line on screen
  const qa = film.qa
  if (qa?.frame && qa.frame.margin < 0)
    add('site', {
      code: 'headline_cut',
      text: 'Their headline runs off the edge when the homepage zooms in.',
      fix: { kind: 'edit', label: 'Edit this line', line: 'noticed' },
    })
  for (const issue of qa?.issues ?? []) {
    if (issue.kind !== 'overflow' && issue.kind !== 'scene-overflow') continue
    const where = sceneOf(issue, film)
    add(where.scene, {
      code: 'headline_cut',
      text: issue.text
        ? `“${issue.text}” doesn’t fit on screen, so it’s cut off.`
        : `Something on ${SCENE_NAMES[where.scene].toLowerCase()} doesn’t fit on screen.`,
      fix:
        where.scene === 'proof'
          ? { kind: 'none', label: 'Shorten this result in your profile' }
          : { kind: 'edit', label: 'Edit this line', line: where.line },
    })
  }

  // lines: no job pitch from a job seeker, and no built-in line their other films all share
  const mine = builtIn(film.scriptMeta)
  for (const [key, scene, name] of LINES) {
    for (const text of lineText(script, key)) {
      if (profile.preset === 'candidate' && key !== 'points') {
        const pitch = jobPitchIn(text, film.company)
        if (pitch.length)
          add(scene, {
            code: 'job_words',
            text: `${name} says “${pitch[0]}”, which reads like a job application. Talk about their product instead.`,
            fix: { kind: 'edit', label: 'Edit this line', line: key },
          })
      }
      if (mine !== 'all' && !mine.has(key)) continue
      const s = shape(text, film.company)
      const shared = recent
        .slice(0, 10)
        .filter((r) => lineText(r.script, key).some((t) => shape(t, r.company) === s)).length
      if (shared >= 2)
        add(scene, {
          code: 'templated_line',
          text: `${name} is the same in ${shared} of your recent films, so it can read like a template.`,
          fix: { kind: 'edit', label: 'Edit this line', line: key },
        })
    }
  }

  const scenes = SCENES.map((kind, index) => ({
    index,
    kind,
    name: SCENE_NAMES[kind],
    ...(kind === 'insight' && caption ? { caption } : {}),
    flags: flags.get(kind)!,
  }))
  const count = scenes.reduce((n, s) => n + s.flags.length, 0)
  return { ready: count === 0, count, scenes, proof: shown }
}

/** which scene and line a QA issue is about, from the text that overflowed */
function sceneOf(
  issue: QaReport['issues'][number],
  film: ReviewInput,
): { scene: SceneKind; line: LineKey } {
  const starts = (a: string, b: string) => {
    const x = a.toLowerCase().replace(/[“”"]/g, '').trim().slice(0, 24)
    const y = b.toLowerCase().replace(/[“”"]/g, '').trim()
    return x.length >= 3 && (y.startsWith(x) || x.startsWith(y.slice(0, 24)))
  }
  if (issue.text) {
    for (const [key, scene] of LINES)
      if (lineText(film.script, key).some((l) => starts(issue.text!, l)))
        return { scene, line: key }
    if (film.highlights?.quote.text && starts(issue.text, film.highlights.quote.text))
      return { scene: 'insight', line: 'why' }
    if (
      film.highlights?.proof.some(
        (p) => starts(issue.text!, p.value) || starts(issue.text!, p.did ?? ''),
      )
    )
      return { scene: 'proof', line: 'points' }
  }
  const cls = (issue.scene ?? '').split(/\s+/)
  const scene = SCENES.find((k) => cls.includes(k)) ?? 'hook'
  const line = LINES.find(([, s]) => s === scene)?.[0] ?? 'hook'
  return { scene, line }
}
