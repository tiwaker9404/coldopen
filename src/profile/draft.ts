import { z } from 'zod'
import type { ChatMessage, LlmProvider } from '../llm/types.ts'
import { callModel } from '../runtime/context.ts'
import { BANNED } from '../script/taste.ts'
import { type Profile, ProfileSchema } from '../script/types.ts'
import { collapse, deterministicDraft, type ParsedResume } from './parse.ts'

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
        value: z.string().describe('the number exactly as the bullet states it, max 12 chars'),
        label: z.string().describe('what the number counts, max 9 words'),
        where: z.string().describe('the employer, school or project, max 4 words'),
      }),
    )
    .min(3)
    .max(8),
})
export type Draft = z.infer<typeof DraftSchema>

export interface DraftMeta {
  model: string
  rounds: number
  violations: string[][]
  /** proof items or points dropped because the model couldn't ground them */
  dropped: string[]
}

const RULES = `Rules (checked in code; a violation means a rewrite):
- Proof: pick the 5 to 8 bullets with the strongest numbers for this role. "value" is the number exactly as the bullet writes it ("2.5M+", "45 minutes", "99%"). "label" says what it counts in plain words, max 9 words, and only uses numbers from the same bullet. "where" is the employer, school or project that bullet sits under, shortened to its common name ("Deloitte", not "Deloitte Touche Tohmatsu India").
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
      content: `You turn a résumé into a profile for coldopen, which makes a 30-second film a job seeker sends to a company. The film shows their offer, 3 strengths and 3 proof numbers.\n\n${RULES}\n\nReply with JSON matching the schema.`,
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
  const all = resume.text.toLowerCase()
  const allNumbers = new Set(numbers(resume.text))
  const vocab = content(resume.text)
  d.proof.forEach((p, i) => {
    const at = `proof[${i}]`
    const entry = resume.entries[Number(p.entry.replace(/\D/g, '')) - 1]
    if (!entry) {
      v.push(`${at}.entry "${p.entry}" is not a bullet id (e1 to e${resume.entries.length})`)
      return
    }
    const mine = new Set(numbers(entry.text))
    const valueNums = numbers(p.value)
    if (!valueNums.length || valueNums.some((n) => !mine.has(n)))
      v.push(
        `${at}.value "${p.value}" is not a number from ${p.entry}: "${entry.text.slice(0, 90)}"`,
      )
    if (p.value.length > 12) v.push(`${at}.value "${p.value}" is over 12 characters`)
    for (const n of numbers(p.label))
      if (!mine.has(n)) v.push(`${at}.label uses "${n}", which isn't in ${p.entry}`)
    if (words(p.label) > 9) v.push(`${at}.label has ${words(p.label)} words; the limit is 9`)
    const whereWords = [...content(p.where)]
    if (whereWords.some((w) => !all.includes(w)))
      v.push(
        `${at}.where "${p.where}" isn't in the résumé; use the name of ${p.entry}'s employer or project`,
      )
    if (p.where.length > 40) v.push(`${at}.where is over 40 characters`)
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
  return v
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
      meta: { model: 'deterministic', rounds: 1, violations: [], dropped: [] },
    }

  const messages = draftMessages(resume, role)
  const history: string[][] = []
  let draft: Draft | null = null
  const max = opts.maxRounds ?? 3
  for (let round = 1; round <= max; round++) {
    const { value } = await callModel(
      opts.llm,
      { schema: DraftSchema, messages, temperature: 0 },
      AbortSignal.timeout(180_000),
    )
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

  // keep what's grounded, drop what isn't
  const d = draft!
  const dropped: string[] = []
  const proofOk = d.proof.filter((p, i) => {
    const bad = checkDraft({ ...d, points: [], offer: 'x', proof: [p] }, resume, exclude).length > 0
    if (bad) dropped.push(`proof[${i}] ${p.value}`)
    return !bad
  })
  const pointsOk = d.points.filter((p, i) => {
    const bad = checkDraft({ ...d, proof: [], offer: 'x', points: [p] }, resume, exclude).length > 0
    if (bad) dropped.push(`points[${i}]`)
    return !bad
  })
  const offerOk =
    checkDraft({ ...d, proof: [], points: [], offer: d.offer }, resume, exclude).length === 0
  if (!offerOk) dropped.push('offer')

  const proof: Profile['proof'] = proofOk.map((p) => ({
    value: p.value.trim(),
    label: collapse(p.label).replace(/\.$/, ''),
    where: p.where.trim(),
  }))
  for (const p of fallback.proof) {
    if (proof.length >= 3) break
    if (!proof.some((x) => x.value === p.value)) proof.push(p)
  }
  const points = [...pointsOk]
  for (const p of fallback.points) if (points.length < 3 && !points.includes(p)) points.push(p)

  const profile = ProfileSchema.parse({
    preset: 'candidate',
    sender: { name: fallback.sender.name, role: d.role.trim() || role },
    offer: offerOk ? d.offer.replace(/\.$/, '') : fallback.offer,
    points: points.slice(0, 6),
    proof: proof.slice(0, 8),
    cta: fallback.cta,
  })
  return {
    profile,
    meta: { model: opts.llm.name, rounds: history.length, violations: history, dropped },
  }
}
