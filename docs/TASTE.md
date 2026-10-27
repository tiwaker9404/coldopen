# Taste rules

Personalized video only works if it doesn't read like a mail merge. These rules are given to the model in its prompt and also enforced in code ([src/script/checks.ts](../src/script/checks.ts)). A violation sends the script back to the model with the exact problem quoted, up to three drafts. After that, limits are enforced mechanically, and if that still isn't clean, a deterministic writer takes over. A film never ships with a violation.

## Structure: the model points, sources speak

The model writes six short lines and makes two choices: which fact from the company's site to feature, and which of the sender's proof points to show. It never writes the fact or the proof. Those are rendered from their sources, so:

- the quote on screen is copied from the company's homepage, and an eval checks it appears there verbatim
- the proof on screen is copied from the sender's profile
- a statistic the model makes up has nowhere to appear

## Word limits

| Line             | Max words | Why                                                     |
| ---------------- | --------: | ------------------------------------------------------- |
| Hook             |         6 | Read in under a second, before anyone scrolls           |
| What we noticed  |        12 | Sits above a moving screenshot; it has to be glanceable |
| Why it matters   |        14 | One idea, not a paragraph                               |
| Pitch headline   |        10 | Display type at 7.6% of the frame height                |
| Each pitch point |        10 | Three of them fit without shrinking                     |
| Ask              |         8 | One question, easy to say yes to                        |

## Grounding

- Every number in the model's lines must appear in the company's facts or the sender's profile.
- The featured fact must be a real fact ID from the extracted list.
- The hook or the observation must name the company.

## Tone

- Specific beats general: mention one concrete thing that's on their homepage.
- Plain words, sentence case. No exclamation marks, emoji, hashtags or ALL CAPS words.
- No flattery and no filler.

## Banned phrases

Matched case-insensitively anywhere in a line:

> revolutionize, revolutionizing, game-changer, game changer, unlock, unleash, supercharge, seamless, seamlessly, cutting-edge, cutting edge, state-of-the-art, next-level, next level, synergy, leverage, empower, elevate, in today's, fast-paced, look no further, take it to the next, harness the power, delve, tapestry, landscape, world-class, best-in-class, robust, holistic, transformative, innovative, amazing, incredible, impressive, love what you, huge fan, i hope this, just wanted to, reach out, touch base, circle back, quick question, excited to, thrilled, passionate

To add your own house rules, edit [src/script/taste.ts](../src/script/taste.ts). The prompt and the checks both read from it, so the model is told about a rule the moment it's enforced.

## Design rules (also enforced)

- Every text color meets WCAG AA (4.5:1) on its background, and accents meet 3:1. The brand's own colors are tried first, then the same hue shaded until it passes, then near-black or white.
- Text is fitted to its line budget after the brand fonts load, in all three formats. Anything that still doesn't fit is reported by QA.
- The company's own fonts are embedded into the film. If a font can't be fetched, a bundled serif or sans takes its place, matched to the original's category.
