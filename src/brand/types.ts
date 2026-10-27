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

export const FactSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(['headline', 'description', 'stat', 'quote', 'claim']),
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
    headlineBox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).nullable(),
  }),
  extractedAt: z.string(),
})
export type BrandKit = z.infer<typeof BrandKitSchema>
