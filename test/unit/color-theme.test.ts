import { describe, expect, it } from 'vitest'
import { contrast, derivePalette, oklch, parseColor, toHex } from '../../src/brand/color.ts'
import type { BrandKit } from '../../src/brand/types.ts'
import { deriveFields } from '../../src/render/theme.ts'
import { profile } from '../helpers/index.ts'

const rgb = (h: string) => parseColor(h)!

describe('color math', () => {
  it('parses css colors', () => {
    expect(parseColor('rgb(255, 0, 0)')).toMatchObject({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toMatchObject({ a: 0.5 })
    expect(parseColor('rgb(10 20 30 / 50%)')).toMatchObject({ a: 0.5 })
    expect(toHex(parseColor('#abc')!)).toBe('#aabbcc')
  })

  it('matches WCAG contrast', () => {
    expect(contrast(rgb('#000000'), rgb('#ffffff'))).toBeCloseTo(21, 0)
    expect(contrast(rgb('#777777'), rgb('#ffffff'))).toBeCloseTo(4.48, 1)
  })

  it('measures colorfulness perceptually', () => {
    expect(oklch(rgb('#888888')).c).toBeLessThan(0.01)
    expect(oklch(rgb('#ff6b2c')).c).toBeGreaterThan(0.15)
  })

  it('picks the brand color from buttons over a big neutral background', () => {
    const p = derivePalette({
      backgrounds: [
        { hex: '#ffffff', weight: 1_000_000 },
        { hex: '#f4f4f4', weight: 200_000 },
      ],
      texts: [{ hex: '#222222', weight: 5000 }],
      brand: [
        { hex: '#2f6bff', weight: 12_000 },
        { hex: '#2e6afe', weight: 6000 },
      ],
    })
    expect(p.background).toBe('#ffffff')
    expect(p.text).toBe('#222222')
    expect(p.primary).toBe('#2f6bff')
    expect(p.accent).not.toBe(p.primary)
  })
})

function randomHex() {
  return `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, '0')}`
}

describe('film fields are always accessible', () => {
  it('meets 4.5:1 text and 3:1 accents for 500 random brand palettes', () => {
    for (let i = 0; i < 500; i++) {
      const colors = {
        background: randomHex(),
        text: randomHex(),
        primary: randomHex(),
        accent: randomHex(),
        dark: randomHex(),
        swatches: [{ hex: randomHex(), weight: 1 }],
      }
      const kit = { colors } as unknown as BrandKit
      const fields = deriveFields(kit, profile('sales'))
      for (const f of [fields.dark, fields.light, fields.brand, fields.sender]) {
        expect(contrast(rgb(f.fg), rgb(f.bg))).toBeGreaterThanOrEqual(4.5)
        expect(contrast(rgb(f.accent), rgb(f.bg))).toBeGreaterThanOrEqual(3)
      }
      expect(contrast(rgb(fields.dark.bg), rgb('#000000'))).toBeLessThan(
        contrast(rgb(fields.light.bg), rgb('#000000')),
      )
    }
  })
})
