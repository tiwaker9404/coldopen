import { z } from 'zod'

/** Who is sending the film, and what they offer. Lives in a JSON file per team or person. */
export const ProfileSchema = z.object({
  /**
   * sales: a seller pitches a company. candidate: a job seeker pitches a company.
   * recruiter: a recruiter pitches a role to one candidate; proof and points are the
   * candidate's own record (from their résumé), and the film speaks to them as "you".
   * hiring: a team announces an open role to everyone (a LinkedIn post); the points are the
   * role's own lines and the proof is numbers from the company's site, filled in at film time.
   */
  preset: z.enum(['sales', 'candidate', 'recruiter', 'hiring']).default('sales'),
  sender: z.object({
    name: z.string().min(1),
    company: z.string().optional(),
    role: z.string().optional(),
  }),
  /** recruiter films: the candidate the film is made for */
  recipient: z
    .object({ name: z.string().trim().min(1).max(80), role: z.string().max(80).optional() })
    .optional(),
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
    .max(8),
  cta: z.object({
    line: z.string().min(3).max(60),
    contact: z.string().min(3).max(80),
    /** a booking link (Calendly, Cal.com...): the share page's main button */
    book: z
      .string()
      .regex(/^https:\/\/\S{4,300}$/, 'a booking link starts with https://')
      .optional(),
  }),
  /**
   * things they built, with a link: each film shows the one closest to the company and role
   * on its share page and in the email ("Something I built that's close to what you do")
   */
  projects: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(60),
        url: z.string().regex(/^https:\/\/\S{4,300}$/, 'a project link starts with https://'),
        /** one line on what it does, in plain words */
        line: z.string().trim().min(3).max(120),
      }),
    )
    .max(8)
    .optional(),
  /**
   * something you built that made this film, so messages and the end card can say so (for
   * example coldopen). Unlike projects, it's about the film itself, not the company's work.
   */
  creator: z
    .object({
      name: z.string().trim().min(2).max(40),
      url: z
        .string()
        .regex(/^https:\/\/\S{4,300}$/, 'a link to what you built starts with https://'),
      /** one line on what it is, in plain words */
      line: z.string().trim().min(3).max(120),
    })
    .optional(),
  /** schools they went to ("Duke University"): who to reach includes alumni at the company */
  schools: z.array(z.string().trim().min(2).max(60)).max(4).optional(),
  /** skills and tools they have, in their words ("Kubernetes", "Salesforce"): counted by Fit check */
  skills: z.array(z.string().trim().min(1).max(40)).max(40).optional(),
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
