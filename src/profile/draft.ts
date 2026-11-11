import { z } from 'zod'
import type { ChatMessage, LlmProvider } from '../llm/types.ts'
import { callModel } from '../runtime/context.ts'
import { BANNED } from '../script/taste.ts'
import { type Profile, ProfileSchema } from '../script/types.ts'
import { collapse, deterministicDraft, type ParsedResume, proofFromBullet } from './parse.ts'
import { allowedNumbers, impressive, readableProof } from './proof.ts'

/**
 * What the model writes. Like film scripts, it points at sources instead of quoting them:
 * each proof item names the résumé bullet it comes from, and code checks the number is there.
 */
export const DraftSchema = z.object({
  role: z.string().describe('the role they are applying for, as a short title'),
  offer: z.string().describe('one line, max 16 words: what they bring to that role'),
  points: z.array(z.string()).min(3).max(5).describe('strengths, max 10 words each'),
  proof: z
    .array(
      z.object({
        entry: z.string().describe('id of the résumé bullet this comes from, e.g. "e4"'),
        value: z
          .string()
          .describe(
            'the number, max 12 chars; when the bullet goes from a before to an after, the change ("6h → 45m")',
          ),
        label: z
          .string()
          .describe('the result: what the number counts or what changed, max 60 chars'),
        did: z
          .string()
          .describe('what they did and what they built, starting with a verb, 12 to 90 chars'),
        where: z.string().describe('the employer, school or project, max 4 words'),
        // nullable, not optional: strict structured outputs (Groq, OpenAI) need every field
        // required, and an endpoint that rejects the schema falls back to plain JSON, where
        // the model no longer sees the fields at all
        before: z
          .string()
          .nullable()
          .describe('the starting figure, when the bullet has a before and an after; else null'),
        after: z
          .string()
          .nullable()
          .describe('the ending figure, when the bullet has a before and an after; else null'),
      }),
    )
    .min(3)
    .max(8),
})
type DraftOut = z.infer<typeof DraftSchema>
type DraftCard = DraftOut['proof'][number]
/** a draft as checked: before and after may be left out where the bullet has neither */
export type Draft = Omit<DraftOut, 'proof'> & {
  proof: (Omit<DraftCard, 'before' | 'after'> & Partial<Pick<DraftCard, 'before' | 'after'>>)[]
}

export interface DraftMeta {
  model: string
  rounds: number
  violations: string[][]
  /** proof items or points dropped because the model couldn't ground them */
  dropped: string[]
  /** proof the model kept writing so a stranger couldn't follow it, rebuilt from its bullet */
  rebuilt: string[]
  /** the model failed outright (unreachable, or invalid JSON after repairs) */
  error?: string
}

const isHard = (problem: string) => /isn't in the bullet|must stay out|placeholder/.test(problem)

const RULES = `Rules (checked in code; a violation means a rewrite):
- Proof is read by a stranger who has never seen the résumé, so each one says what was done, where, and what changed. Pick the 5 to 8 bullets that would impress that stranger most for this role: a before and an after first, then big scale (millions of records, thousands a day, gigabytes), then the rest.
- "did" says what they did and what they built, starting with a plain verb, 12 to 90 characters: "Built containerized ETL with Docker and PostgreSQL", "Migrated a Tier-1 bank's database to hybrid cloud". Use the bullet's own nouns and tools. Drop résumé padding ("leveraged", "orchestrated", "spearheaded", "custom", "relative to the legacy baseline").
- "label" is the result, max 60 characters: what the number counts, or what changed. "label" never repeats "did".
- When the bullet gives a before and an after ("from 6 hours to 45 minutes", "by 2 days against the 5-day baseline"), "value" is the change ("6h → 45m", "5 → 3 days") and "label" says both ("daily client data sync, from 6 hours to 45 minutes"). Fill "before" and "after". Never use the starting figure alone as the value.
- Otherwise "value" is the number exactly as the bullet writes it ("2.5M+", "99%", "150+").
- Every number in value, label and did comes from that same bullet.
- "where" is the employer, school or project that bullet sits under (shown in [brackets]), shortened to its common name ("Deloitte", not "Deloitte Touche Tohmatsu India"). Where it says "Current <role> role", use exactly that: that employer is never named.
- Points: 3 to 5 strengths a hiring manager for this role cares about, max 10 words each, each based on something the résumé shows. No numbers that aren't in the résumé.
- Offer: one line, max 16 words, in plain words. What this person brings to the role.
- Only use what the résumé says. Never invent tools, employers, results or numbers.
- Plain words. No hype ("results-driven", "passionate", "seamless", "leverage", "cutting-edge").`

export function draftMessages(resume: ParsedResume, role: string): ChatMessage[] {
  const bullets = resume.entries
    .map((e, i) => `e${i + 1} [${e.org || e.section || 'other'}] ${e.text}`)
    .join('\n')
  return [
    {
      role: 'system',
      content: `You turn a résumé into a profile for coldopen, which makes a 30-second film a job seeker sends to a company. The film shows their offer, 3 strengths and 3 proof cards (the number, what changed, what they did, where).\n\n${RULES}\n\nReply with JSON matching the schema: {"role", "offer", "points": [...], "proof": [{"entry", "value", "label", "did", "where", "before", "after"}, ...]}, where "entry" is the bullet id and "before"/"after" are null when the bullet has no before and after.`,
    },
    {
      role: 'user',
      content: `Target role: ${role}\n\nSummary: ${resume.summary || '(none)'}\n\nRésumé bullets (cite by id):\n${bullets}`,
    },
  ]
}

const numbers = (s: string) => (s.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, ''))
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length
const content = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((w) => w.length > 3),
  )
const HYPE = [
  ...BANNED,
  'results-driven',
  'detail-oriented',
  'team player',
  'go-getter',
  'synergize',
]

/** Every rule above, as code. Messages go back to the model verbatim. */
export function checkDraft(d: Draft, resume: ParsedResume, exclude: string[]): string[] {
  const v: string[] = []
  const allNumbers = new Set(numbers(resume.text))
  const vocab = content(resume.text)
  d.proof.forEach((p, i) => {
    const { hard, soft } = proofProblems(p, i, resume, exclude)
    v.push(...hard, ...soft)
  })
  const lines: [string, string, number][] = [
    ['offer', d.offer, 16],
    ...d.points.map((p, i) => [`points[${i}]`, p, 10] as [string, string, number]),
  ]
  for (const [field, text, max] of lines) {
    if (words(text) > max) v.push(`${field} has ${words(text)} words; the limit is ${max}`)
    for (const n of numbers(text))
      if (!allNumbers.has(n)) v.push(`${field} uses "${n}", which isn't in the résumé`)
    const lower = text.toLowerCase()
    for (const h of HYPE) if (lower.includes(h)) v.push(`${field} uses the phrase "${h}"`)
    const own = [...content(text)]
    const unknown = own.filter((w) => !vocab.has(w) && !vocab.has(w.replace(/s$/, '')))
    if (own.length && unknown.length / own.length > 0.5)
      v.push(
        `${field} mostly uses words the résumé doesn't ("${unknown.slice(0, 3).join('", "')}"); describe what it shows`,
      )
  }
  const text = JSON.stringify(d).toLowerCase()
  for (const x of exclude)
    if (x && text.includes(x.toLowerCase()))
      v.push(`the profile mentions "${x}", which must stay out`)
  // every field's text, without the JSON around it (whose arrays have brackets of their own)
  const fields = [
    d.role,
    d.offer,
    ...d.points,
    ...d.proof.flatMap((p) => [p.label, p.did, p.where]),
  ]
  if (fields.some((f) => /left out|redacted|\[|\]/i.test(f ?? '')))
    v.push(
      'the profile copies a redaction placeholder ("[...]", "left out"); say "Current <role> role"',
    )
  return v
}

/**
 * One proof item's problems. Hard ones mean it isn't grounded (a number or a place the bullet
 * doesn't have) and it's dropped; soft ones mean a stranger wouldn't follow it (no act, the
 * before → after lost, padding) and it gets a rewrite, then the bullet's own words.
 */
export function proofProblems(
  p: Draft['proof'][number],
  i: number,
  resume: ParsedResume,
  exclude: string[],
): { hard: string[]; soft: string[] } {
  const hard: string[] = []
  const at = `proof[${i}]`
  const all = resume.text.toLowerCase()
  const entry = resume.entries[Number(p.entry.replace(/\D/g, '')) - 1]
  if (!entry) {
    hard.push(`${at}.entry "${p.entry}" is not a bullet id (e1 to e${resume.entries.length})`)
    return { hard, soft: [] }
  }
  const mine = allowedNumbers(entry.text)
  const valueNums = numbers(p.value)
  if (!valueNums.length || valueNums.some((n) => !mine.has(n)))
    hard.push(
      `${at}.value "${p.value}" is not a number from ${p.entry}: "${entry.text.slice(0, 90)}"`,
    )
  if (p.value.length > 12) hard.push(`${at}.value "${p.value}" is over 12 characters`)
  for (const [field, text] of [
    ['label', p.label],
    ['did', p.did ?? ''],
    ['before', p.before ?? ''],
    ['after', p.after ?? ''],
  ] as const)
    for (const n of numbers(text))
      if (!mine.has(n)) hard.push(`${at}.${field} uses "${n}", which isn't in ${p.entry}`)
  if (p.label.length > 60) hard.push(`${at}.label is over 60 characters`)
  // the bullet's own employer is always fine, even "Current FDE role" the résumé never says
  const own = p.where.trim().toLowerCase() === entry.org.toLowerCase()
  const whereWords = [...content(p.where)]
  if (!own && whereWords.some((w) => !all.includes(w) && !entry.org.toLowerCase().includes(w)))
    hard.push(
      `${at}.where "${p.where}" isn't in the résumé; use the name of ${p.entry}'s employer or project`,
    )
  if (p.where.length > 40) hard.push(`${at}.where is over 40 characters`)

  // readable to a stranger: everything readableProof finds that isn't a grounding problem
  const r = readableProof(
    { value: p.value, label: p.label, did: p.did ?? '', where: p.where },
    entry.text,
    { exclude },
  )
  const soft = r.problems
    .filter((x) => !/isn't in the bullet|over \d+ characters/.test(x))
    .map((x) => `${at}: ${x}`)
  return { hard, soft }
}

/**
 * Write -> check -> revise, like film scripts. Whatever the model still can't ground after
 * the last round is dropped and topped up from the deterministic draft, so a profile never
 * ships with a number the résumé doesn't contain.
 */
export async function draftProfile(opts: {
  resume: ParsedResume
  role: string
  contact?: string
  exclude?: string[]
  llm: LlmProvider | null
  maxRounds?: number
}): Promise<{ profile: Profile; meta: DraftMeta }> {
  const { resume, role } = opts
  const exclude = opts.exclude ?? []
  const fallback = deterministicDraft(resume, {
    role,
    ...(opts.contact ? { contact: opts.contact } : {}),
  })
  if (!opts.llm)
    return {
      profile: fallback,
      meta: { model: 'deterministic', rounds: 1, violations: [], dropped: [], rebuilt: [] },
    }

  const messages = draftMessages(resume, role)
  const history: string[][] = []
  let draft: Draft | null = null
  const max = opts.maxRounds ?? 3
  for (let round = 1; round <= max; round++) {
    let value: unknown
    try {
      ;({ value } = await callModel(
        opts.llm,
        { schema: DraftSchema, messages, temperature: 0 },
        AbortSignal.timeout(180_000),
      ))
    } catch (err) {
      // a later round failing keeps the last draft; a first round failing means the résumé
      // is still drafted, from its own words, rather than the person getting an error
      if (draft) break
      return {
        profile: fallback,
        meta: {
          model: 'deterministic',
          rounds: round,
          violations: [],
          dropped: [],
          rebuilt: [],
          error: (err as Error).message,
        },
      }
    }
    draft = value as Draft
    const v = checkDraft(draft, resume, exclude)
    history.push(v)
    if (v.length === 0) break
    messages.push(
      { role: 'assistant', content: JSON.stringify(draft) },
      {
        role: 'user',
        content: `Revise. Fix every problem below and change nothing else:\n${v.map((x) => `- ${x}`).join('\n')}\nReply with only the corrected JSON.`,
      },
    )
  }

  // keep what's grounded, drop what isn't; a card a stranger still can't follow after the
  // rewrites is built again from its bullet's own words
  const d = draft!
  const dropped: string[] = []
  const rebuilt: string[] = []
  const proof: Profile['proof'] = []
  d.proof.forEach((p, i) => {
    const { hard, soft } = proofProblems(p, i, resume, exclude)
    if (hard.length) {
      dropped.push(`proof[${i}] ${p.value}`)
      return
    }
    const entry = resume.entries[Number(p.entry.replace(/\D/g, '')) - 1]!
    if (soft.length) {
      const own = proofFromBullet(entry)
      if (own && !readableProof(own, entry.text, { exclude }).problems.some(isHard)) {
        rebuilt.push(`proof[${i}] ${p.value}`)
        proof.push(own)
        return
      }
    }
    const did = collapse(p.did ?? '').replace(/\.$/, '')
    proof.push({
      value: p.value.trim(),
      label: collapse(p.label).replace(/\.$/, ''),
      ...(did.length >= 12 && did.length <= 90 ? { did } : {}),
      where: p.where.trim(),
    })
  })
  const pointsOk = d.points.filter((p, i) => {
    const bad = checkDraft({ ...d, proof: [], offer: 'x', points: [p] }, resume, exclude).length > 0
    if (bad) dropped.push(`points[${i}]`)
    return !bad
  })
  const offerOk =
    checkDraft({ ...d, proof: [], points: [], offer: d.offer }, resume, exclude).length === 0
  if (!offerOk) dropped.push('offer')

  for (const p of fallback.proof) {
    if (proof.length >= 3) break
    if (!proof.some((x) => x.value === p.value)) proof.push(p)
  }
  // the film shows the first ones: what impresses a stranger most leads (the sort is stable)
  proof.sort((a, b) => impressive(b) - impressive(a))
  const points = [...pointsOk]
  for (const p of fallback.points) if (points.length < 3 && !points.includes(p)) points.push(p)

  const profile = ProfileSchema.parse({
    preset: 'candidate',
    sender: { name: fallback.sender.name, role: d.role.trim() || role },
    offer: offerOk ? d.offer.replace(/\.$/, '') : fallback.offer,
    points: points.slice(0, 6),
    proof: proof.slice(0, 8),
    ...(fallback.schools ? { schools: fallback.schools } : {}),
    cta: fallback.cta,
  })
  return {
    profile,
    meta: {
      model: opts.llm.name,
      rounds: history.length,
      violations: history,
      dropped,
      rebuilt,
    },
  }
}
