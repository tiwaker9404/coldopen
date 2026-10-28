import { z } from 'zod'

/** Who is sending the film, and what they offer. Lives in a JSON file per team or person. */
export const ProfileSchema = z.object({
  preset: z.enum(['sales', 'candidate']).default('sales'),
  sender: z.object({
    name: z.string().min(1),
    company: z.string().optional(),
    role: z.string().optional(),
  }),
  /** one line: what you offer, in the recipient's terms */
  offer: z.string().min(3).max(120),
  /** value props / strengths the script may tailor (never invent new ones) */
  points: z.array(z.string().min(3).max(120)).min(2).max(6),
  /** hard evidence; the film shows these verbatim, the model only picks which */
  proof: z
    .array(
      z.object({
        value: z.string().min(1).max(12),
        label: z.string().min(3).max(60),
        /** where it happened ("Rail Inc.", "Deloitte"); context is what makes a number credible */
        where: z.string().min(2).max(40).optional(),
      }),
    )
    .min(1)
    .max(5),
  cta: z.object({ line: z.string().min(3).max(60), contact: z.string().min(3).max(80) }),
  /** optional sender brand for the end card */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
})
export type Profile = z.infer<typeof ProfileSchema>

/** What the model writes. Short lines plus pointers into sources it may not alter. */
export const ScriptSchema = z.object({
  hook: z.string().describe('2-6 words, greets the company by name'),
  noticed: z.string().describe('one specific observation about their homepage, max 12 words'),
  insight: z.object({
    factId: z.string().describe('id of the fact from their site to feature, e.g. "f3"'),
    why: z.string().describe('max 14 words: why that fact matters for what the sender offers'),
  }),
  pitch: z.object({
    headline: z.string().describe('max 10 words'),
    points: z
      .array(z.string())
      .min(2)
      .max(3)
      .describe('each max 10 words, tailored from the profile points'),
  }),
  proof: z
    .array(z.number().int().min(0))
    .min(1)
    .max(3)
    .describe('indices into the profile proof list'),
  cta: z.string().describe('max 8 words'),
})
export type Script = z.infer<typeof ScriptSchema>

export interface ScriptMeta {
  model: string
  rounds: number
  violations: string[][]
  /** every line came from the deterministic writer */
  usedFallback: boolean
  /** lines the model couldn't get right, swapped for the deterministic writer's version */
  replaced: string[]
}
