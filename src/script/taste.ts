/**
 * Taste you can write down. These rules are given to the model AND enforced in code, so a
 * film never ships with slop, invented numbers or flattery. Keep this list opinionated.
 */

export const LIMITS = {
  hook: 6,
  noticed: 12,
  why: 14,
  headline: 10,
  point: 10,
  cta: 8,
} as const

/** Phrases that mark copy as machine-written or salesy. Matched case-insensitively. */
export const BANNED = [
  'revolutionize',
  'revolutionizing',
  'game-changer',
  'game changer',
  'unlock',
  'unleash',
  'supercharge',
  'seamless',
  'seamlessly',
  'cutting-edge',
  'cutting edge',
  'state-of-the-art',
  'next-level',
  'next level',
  'synergy',
  'leverage',
  'empower',
  'elevate',
  'in today’s',
  "in today's",
  'fast-paced',
  'look no further',
  'take it to the next',
  'harness the power',
  'delve',
  'tapestry',
  'landscape',
  'world-class',
  'best-in-class',
  'robust',
  'holistic',
  'transformative',
  'innovative',
  'amazing',
  'incredible',
  'impressive',
  'love what you',
  'huge fan',
  'i hope this',
  'just wanted to',
  'reach out',
  'touch base',
  'circle back',
  'quick question',
  'excited to',
  'thrilled',
  'passionate',
] as const

export const TASTE_RULES = `
Taste rules (these are checked in code; a violation means a rewrite):
- Be specific. Mention one concrete thing that is actually on their homepage.
- Plain words. Write like a sharp person talking, not like marketing copy.
- Short. Respect every word limit exactly: hook <= ${LIMITS.hook}, noticed <= ${LIMITS.noticed}, why <= ${LIMITS.why}, headline <= ${LIMITS.headline}, each point <= ${LIMITS.point}, cta <= ${LIMITS.cta} words.
- Sentence case. No ALL CAPS, no exclamation marks, no emoji, no hashtags.
- No flattery ("amazing", "impressive", "love what you're doing") and no filler ("just wanted to", "reach out").
- Never use these words: ${BANNED.slice(0, 24).join(', ')}.
- Never invent numbers, customers or results. Any number you write must appear in the facts or the sender profile.
- The insight must point at a real fact id from the list. Its exact text is shown on screen, so pick the fact that best connects their goal to what the sender offers.
- The pitch connects the sender's offer to that fact. Tailor the profile points to this company; do not add claims the profile doesn't make.
`.trim()
