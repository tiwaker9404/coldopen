import { z } from 'zod'

export const FontFaceSchema = z.object({
  src: z.string(),
  weight: z.string().default('400'),
  style: z.string().default('normal'),
  unicodeRange: z.string().optional(),
})

export const FontRefSchema = z.object({
  family: z.string(),
  category: z.enum(['serif', 'sans', 'mono']),
  weight: z.number(),
  faces: z.array(FontFaceSchema),
})
export type FontRef = z.infer<typeof FontRefSchema>

const BoxSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
export type Box = z.infer<typeof BoxSchema>

export const FactSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** "requirement": a line from the job post the film answers (only when one is given) */
  kind: z.enum(['headline', 'description', 'stat', 'quote', 'claim', 'requirement']),
  /** where it sits on the page, in page pixels from the top (unknown for meta tags and posts) */
  box: BoxSchema.optional(),
  /** below the fold: a screenshot of the part of the page it's on, and its box in that image */
  shot: z.object({ file: z.string(), box: BoxSchema }).optional(),
})
export type Fact = z.infer<typeof FactSchema>

export const BrandKitSchema = z.object({
  url: z.string(),
  host: z.string(),
  name: z.string(),
  title: z.string(),
  description: z.string(),
  headline: z.string(),
  subheads: z.array(z.string()),
  nav: z.array(z.string()),
  facts: z.array(FactSchema),
  colors: z.object({
    background: z.string(),
    text: z.string(),
    primary: z.string(),
    accent: z.string(),
    dark: z.string(),
    swatches: z.array(z.object({ hex: z.string(), weight: z.number() })),
  }),
  fonts: z.object({ display: FontRefSchema, body: FontRefSchema }),
  logo: z.object({ dataUrl: z.string(), width: z.number(), height: z.number() }).nullable(),
  screenshot: z.object({
    file: z.string(),
    width: z.number(),
    height: z.number(),
    headlineBox: z
      .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
      .nullable(),
  }),
  extractedAt: z.string(),
  /** the role the film answers, when made from a job post; its requirements are in facts */
  job: z.object({ title: z.string(), url: z.string().optional() }).optional(),
})
export type BrandKit = z.infer<typeof BrandKitSchema>
