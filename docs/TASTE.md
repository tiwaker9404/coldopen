# Taste rules

Personalized video only works if it doesn't read like a mail merge. These rules are given to the model in its prompt and also enforced in code ([src/script/checks.ts](../src/script/checks.ts)). A violation sends the script back to the model with the exact problem quoted, up to four drafts. After that, any line that still breaks a rule is swapped for the deterministic writer's version of that line, rather than cut short to fit. The model's good lines are kept. A film never ships with a violation.

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
- The featured fact must be a real fact ID from the extracted list, and a stat whenever the site has one. A number on screen lands harder than a sentence.
- The hook or the observation must name the company.

## Every line has a job

Checked in code, because a model that obeys word limits can still write empty lines:

- **Hook:** greets them in at least 3 words, not just their name.
- **What we noticed:** says something about their homepage. Restating their headline doesn't count, unless it's quoted as a quote.
- **Why it matters:** connects the fact to you: it names your company or the problem you solve (or, for a job seeker, says what you'd do). Repeating the fact, which is already on screen, or paying a compliment doesn't count.
- **Pitch headline:** at least 4 words that name what you offer, not a slogan.
- **Proof:** at least 2 items, so the scene never looks empty.

## Tone

- Specific beats general: mention one concrete thing that's on their homepage.
- Plain words, sentence case. No exclamation marks, emoji, hashtags or ALL CAPS words.
- No flattery and no filler.

## Banned phrases

Matched case-insensitively anywhere in a line:

> revolutionize, drive growth, great work, great job, kudos, congrats, deeper insights, made easy, shows the impact, boost your, revolutionizing, game-changer, game changer, unlock, unleash, supercharge, seamless, seamlessly, cutting-edge, cutting edge, state-of-the-art, next-level, next level, synergy, leverage, empower, elevate, in today's, fast-paced, look no further, take it to the next, harness the power, delve, tapestry, landscape, world-class, best-in-class, robust, holistic, transformative, innovative, amazing, incredible, impressive, love what you, huge fan, i hope this, just wanted to, reach out, touch base, circle back, quick question, excited to, thrilled, passionate

To add your own house rules, edit [src/script/taste.ts](../src/script/taste.ts). The prompt and the checks both read from it, so the model is told about a rule the moment it's enforced.

## Message rules

The messages that go with a film are checked too ([src/outreach/checks.ts](../src/outreach/checks.ts)). A model draft that breaks a rule is sent back once with the reasons. If it still fails, its template is used instead, and every template passes the same rules on every fixture. Limits live in `MESSAGE_LIMITS` only.

| Rule                | What it checks                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `length`            | Connection note at most 200 characters (a free LinkedIn account's limit); after-accept message 500; InMail subject 60 and body 400; email and follow-ups at most 125 words, not counting a line that's only a link |
| `grounded`          | Every number appears in their site, the film, the job post, your profile or their recent posts. The film's own length ("30-second") needs no source                                                                |
| `no_begging`        | None of the begging or referral words below                                                                                                                                                                        |
| `one_ask`           | The note asks nothing (the ask comes once they accept). The after-accept message, InMail and email ask exactly one question. A follow-up never asks two                                                            |
| `names_company`     | The note, after-accept message, InMail and email name the company                                                                                                                                                  |
| `no_link`           | The note has no link: a note with a link reads as spam                                                                                                                                                             |
| `has_link`          | The after-accept message, InMail and email carry the film's link exactly once                                                                                                                                      |
| `banned`            | None of the banned phrases above                                                                                                                                                                                   |
| `no_exclamation`    | No exclamation marks                                                                                                                                                                                               |
| `research_grounded` | The email's research line stays close to what their post says: a word overlap of at least 0.6 with the post. A restatement, never an invention                                                                     |
| `film_once`         | The email says "film" or "video" once, in the line code writes before the link                                                                                                                                     |

A failed rule comes back as a flag with a plain sentence saying why, which the film panel shows under "Why this is the template version". When code changes a kept draft (for example, leaving out the funding line to stay under 125 words), that's a note, not a flag.

### Begging and referral words

Matched case-insensitively as whole phrases, with curly apostrophes counted as straight ones:

> refer me, referral, any openings, any opportunities, grateful if you could, I'd be grateful for, pass my resume, pick your brain, just checking in, desperate, please consider me, sorry to bother

They live in `BEGGING` in [src/script/taste.ts](../src/script/taste.ts). The ask is always one small, clear thing: a 15-minute call, after you've offered the film.

## Design rules (also enforced)

- Every text color meets WCAG AA (4.5:1) on its background, and accents meet 3:1. The brand's own colors are tried first, then the same hue shaded until it passes, then near-black or white.
- Text is fitted to its line budget after the brand fonts load, in all three formats. Anything that still doesn't fit is reported by QA.
- The company's own fonts are embedded into the film. If a font can't be fetched, a bundled serif or sans takes its place, matched to the original's category.
