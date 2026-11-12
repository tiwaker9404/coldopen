# Taste rules

Personalized video only works if it doesn't read like a mail merge. These rules are given to the model in its prompt and also enforced in code ([src/script/checks.ts](../src/script/checks.ts)). A violation sends the script back to the model with the exact problem quoted, up to four drafts. After that, any line that still breaks a rule is swapped for the deterministic writer's version of that line, rather than cut short to fit. The model's good lines are kept. A film never ships with a violation.

## Structure: the model points, sources speak

The model writes six short lines and makes two choices: which fact from the company's site to feature, and which of the sender's proof points to show. It never writes the fact or the proof. Those are rendered from their sources, so:

- the quote on screen is copied from what the company published: their homepage, or a recent changelog, blog, engineering or news post, their podcast's episode notes, or their docs. A caption under it says where ("From their homepage", "From their changelog, Oct 2026", "From their podcast, episode notes, Sep 2026"), dated only when the source gives a date, and an eval checks the quote appears there verbatim
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
- The featured fact must be a real fact ID from the extracted list, and a stat whenever the site has one. A number on screen lands harder than a sentence. With no stat, a changelog or engineering line about what they built in the last 120 days comes before a homepage claim.
- **It has to stand alone** (`standsAlone` in [src/script/checks.ts](../src/script/checks.ts)). The fact scene shows one line with nothing around it but its caption, so only facts that read whole to a stranger are offered to the model or the built-in writer: a full sentence of 6 to 25 words that names the company or what it does (a measured result on their own page counts), doesn't start by pointing at something else ("It also…", "This", "They", "These", "The above") or use "it", "this", "that" or "they" mid-line with nothing in the line for it to mean ("We'll show it live in 20 minutes": show what?), and isn't a question, a cut-off line, a menu, a name and title, "Learn more", "Click here", or cookie or legal text. A job post's requirements are quoted as they are, captioned "From your <role> post". If nothing on a site stands alone, the film still uses what's there.
- The hook or the observation must name the company.

## Review before sending

Checks catch what code can measure while the film is made. The review (`reviewFilm` in [src/script/review.ts](../src/script/review.ts), the film panel's Review tab and `GET /v1/films/:id/review`) reads the finished film the way a founder would, scene by scene, and flags in plain words:

- **The quote doesn't stand alone**, by the rule above. Fix: quote another fact, from the next 3 that do, each with its caption.
- **Proof a stranger can't read:** a result that doesn't say what you did, what changed or where. Fix: show another result from your profile that does.
- **No logo**, or one that came out favicon-sized. The film never leaves the chip blank: it sets their name in their own font and color. Fix: keep their name as the logo.
- **A font stand-in:** their font couldn't be embedded (Apple's system font, say), so the film uses the closest free one of the same class (Inter, Fraunces or JetBrains Mono).
- **A line cut off**, or the headline zoomed out of frame; **low contrast**, should no brand color reach WCAG AA.
- **A template line:** a built-in line that 2 or more of your last 10 films share. **Job words** in a job seeker's lines, as the safety net for the voice rules.

The film says "Ready to send" only when nothing is flagged. Every fix makes a new take through the edit route, without reading their site again.

## Every line has a job

Checked in code, because a model that obeys word limits can still write empty lines:

- **Hook:** greets them in at least 3 words, not just their name.
- **What we noticed:** says something about their homepage. Restating their headline doesn't count, unless it's quoted as a quote.
- **Why it matters:** connects the fact to you: it names your company or the problem you solve (or, for a job seeker, says what you'd do). Repeating the fact, which is already on screen, or paying a compliment doesn't count.
- **Pitch headline:** at least 4 words that name what you offer, not a slogan. A job seeker's names what you'd try or build with their product ("What I'd build next for Parcelpine's returns"), never "why I fit".
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

A job seeker's connection note, after-accept message, InMail and email are also checked in the voice below (`candidate: true` in the check context; `voiceFor()` fills in the rest):

| Rule                | What it checks                                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not_job_pitch`     | No job words (`JOB_WORDS`: role, position, opening, hiring, apply, application, candidate, résumé, job…), subject included. A title quoted from their own post doesn't count inside quotation marks                  |
| `thanks`            | The after-accept message, InMail and email end with thanks (`THANKS`: "Thanks for reading", "Thank you for your time"…) just before the signature                                                                    |
| `no_proof_numbers`  | None of the proof values the film shows. The 15-minute offer and the film's length don't count                                                                                                                       |
| `curious`           | The email and after-accept message ask one question about their work: it shares a word with their site, posts or your notes on their product, or it's your saved question word for word                              |
| `one_ask`           | In the voice: the email asks its curious question and may add the 15-minute offer as a second question (or say it as a statement), never two asks for time. The note may ask one curious question, never for time    |
| `homework_grounded` | A first-person product claim ("I tried", "I used", "I built", "when I") in the email or after-accept message matches your saved detail or built line (overlap ≥ 0.5) or names what you built. No homework, no claims |

A failed rule comes back as a flag with a plain sentence saying why, which the film panel shows under "Why this is the template version". When code changes a kept draft (for example, leaving out the funding line to stay under 125 words), that's a note, not a flag.

### Begging and referral words

Matched case-insensitively as whole phrases, with curly apostrophes counted as straight ones:

> refer me, referral, any openings, any opportunities, grateful if you could, I'd be grateful if you, would mean the world, pass my resume, pick your brain, just checking in, desperate, please consider me, sorry to bother

"I'd be grateful for" used to be on the list. It's off now, because it blocked real thanks ("I'd be grateful for any thoughts").

They live in `BEGGING` in [src/script/taste.ts](../src/script/taste.ts). The ask is always one small, clear thing: a 15-minute call, after you've offered the film.

## Networking messages

A job seeker's messages go to people who already know from the profile that the sender is looking: founders, recruiting, people doing the job. What earns their time is a curious person who did real homework on their product. So these messages ask for insight, not a job, and the referral comes later, from the relationship. The rules live in [src/outreach/voice.ts](../src/outreach/voice.ts) (`VOICE_RULES` for the model, `JOB_WORDS` and `THANKS` for the checks), and the templates in [src/outreach/messages.ts](../src/outreach/messages.ts) are written to them. Sales, recruiter and hiring messages keep their own voice.

1. **Their work first.** The first line is about them: what you used, read or built with their product, never the role or a number. _Why:_ openers about the person's own product get answered. Ben Lang's founder emails open with a product detail only a user would notice.
2. **One thing that isn't on the résumé.** Your homework (a product detail, a small build, a docs or changelog observation), or the line saying you built the tool that made the film. _Why:_ building something for the company is the strongest signal, and the film is already a version of it.
3. **The film is a gift with a reason to open it.** One line about what's in it, in terms of their work ("I put what I'd try next with your rate API into a 30-second film"), never "I made a film for your role". _Why:_ the film makes you memorable; the line around it has to make them want to open it.
4. **One real question about their work.** Something you wondered while using the product or reading their post (your saved question, word for word, when you have one), then a soft 15-minute offer as a statement. _Why:_ a question about what they're building is easier to answer than a request for a call.
5. **Thanks for their time.** "Thanks for reading" or "Thank you for your time": grateful, never begging. _Why:_ in Boomerang's study of 350,000 emails, closings with thanks got replies 62% of the time against 46% without.
6. **No job words, no numbers.** No "role, position, opening, hiring, apply, candidate, résumé, job" in the note, after-accept message, InMail or email, and no proof numbers: the film shows them. _Why:_ "the goal of a cold email is to get time, not to get hired" (Eli Kamerow), and a number they've already seen reads as a pitch.
7. **Sounds like a person.** Contractions, plain words, under 125 words, no flattery, and the banned list still applies. _Why:_ a YC founder found only 22 of 172 daily applicants looked like a person; sounding human is the edge.

On LinkedIn, a free account gets three personalized invites a month and 200 characters each. A note barely changes acceptance but nearly doubles replies after accepting (9.36% vs 5.44% across 20M+ requests), so the note is short and about their work, and the message after they accept carries the film. A job seeker follows up once, a week on (or 2 days after a watch), with something new: a fresh fact from their site, a newer post, or something you tried since. Then let it go. One follow-up that adds something lifts replies by about 66%.

The email opens one of two ways, half and half by film: with your homework, or with your question for them. Today shows which one gets more replies (`/v1/me/openers`). Each film counts under the opener it had when you marked it sent.

**Before (the old proof opener, roughly):**

> I saw the Operations Analyst role at Parcelpine. 40% faster month-end close at Initech. I made a 30-second film for your Operations Analyst role at Parcelpine: [link] … Could we find 15 minutes this week?

**After:**

> Subject: Parcelpine's new carrier-rate API
>
> Hi Dana,
>
> I tried Parcelpine's rate API this weekend to compare two carriers for a side project, and the per-zone breakdown saved me a spreadsheet. I put what I'd build next with it into a 30-second film: [GIF]
>
> I built the tool that made it, coldopen, so I spend a lot of time on how small teams reach people.
>
> One thing I wondered: are most of your customers calling the API directly, or going through the Shopify app? If you ever have 15 minutes, I'd love to hear how you think about it.
>
> Thanks for reading,
> Ashwin

Why the after works: it opens with something only a user would know, the film line says what's in it for them, it shows something that isn't on the résumé, it asks one question they can answer, and it ends with thanks. It never says "role" and never repeats a number from the film.

**When the model writes them.** A job seeker's prompt carries what the film noticed, their latest post, your homework (verbatim, marked as your own words) and your creator line, plus `VOICE_RULES`. It carries no proof and no role title: the film shows the proof, and a title in the prompt ends up in the message. The model writes the email in parts (opening, tease with `[film]`, creator line, question, offer) and code lays them out as the templates are, adding the greeting, "Thanks for reading," and the signature. A saved question the model rephrased is put back word for word. A draft that fails a voice rule goes back once with what to do ("drop the word "role"; talk about their product", "take out the claim your homework doesn't make"), then falls back to its template. Drafts written before today's rules, or before homework you saved later, aren't rewritten on their own: the templates stand in, and "Write it again" in the film panel (`POST /v1/films/:id/messages/rewrite`) has the model write them from your homework.

Every claim of experience must come from what you saved. A template only says "I tried…" or "I built…" in your own words (your detail, your built line, your creator line). A saved line that would break a rule (a job word, a number from the film) is left out, never edited, and the draft opens on their homepage instead.

Sources: [Next Play, the guide to getting a job with cold email](https://nextplayso.substack.com/p/the-guide-to-getting-a-job-with-cold); [cold outreach research notes](https://quartz-e47.pages.dev/zasoby/strategie/cold_outreach_research) (Aline Lerner, Eli Kamerow, Nick Singh, a YC founder on HN); [Boomerang on email sign-offs](https://blog.boomerangapp.com/2017/01/how-to-end-an-email-email-sign-offs/); [Expandi on notes vs no notes](https://expandi.io/blog/linkedin-connection-message-templates/); [LinkedIn note limits on free accounts](https://www.hublead.io/linkedin-character-limit); [cold email follow-up data](https://cut-the-saas.com/guides/cold-email-templates).

## A job seeker's film

The people who see a job seeker's film know from the profile that the sender is looking, so the film reads like a curious builder's take on their product, not an application (the same research as the networking messages above: ask for insight, not a job).

- **Pitch headline:** what you'd try or build with their product, or for its customers, in 4 to 10 words grounded in your points and the fact the film quotes. The built-in writer picks one of four lines per company (`HEADLINES`, with `variant()`), each with a slot for their thing: the topic the quoted fact shares with their homepage ("Parcelpine's returns"), else the company. Two companies rarely share a line.
- **Why it matters:** what you'd do with the fact ("I'd …"). With a job post, the fact is still one of its requirements, quoted word for word, and the line says what you'd do about it.
- **The ask:** a warm invitation about their work, at most 8 words, a question ("Trade notes on Parcelpine's returns?", "Could we talk about Lumen Health sometime?"; `CTAS`). Never "hire me", "interview", "role" or "job".
- **`not_job_pitch`:** the hook, noticed, why, headline and ask never use a `JOB_WORDS` word (voice.ts) or "hire me" / "interview". Text in quotation marks (their requirement, their headline) and the company's own name don't count. The hook's small line says "A 30-second film for <Company>", even when the film began from their post.
- **Proof stays:** the proof scene is the one place numbers belong.
- **Who built the tool:** when your profile has a creator, the end card says "Made with <name>, which I built" under the ask, small, in the scene's main text color (AA on their colors), and fits square, wide and tall. The share page carries the same line, linked to the creator's URL. Sellers, recruiters and hiring films don't show it, and are otherwise unchanged (`test/unit/film-presets.test.ts` snapshots them).

In messages, a proof whose value is a change ("6h → 45m") is quoted by its label alone ("report prep, from 6 hours to 45 minutes"), so its numbers aren't said twice (`proofPhrase()`, checked by `no_repeated_numbers`).

## Design rules (also enforced)

- Every text color meets WCAG AA (4.5:1) on its background, and accents meet 3:1. The brand's own colors are tried first, then the same hue shaded until it passes, then near-black or white.
- Text is fitted to its line budget after the brand fonts load, in all three formats. Anything that still doesn't fit is reported by QA.
- The company's own fonts are embedded into the film. If a font can't be fetched, a bundled serif or sans takes its place, matched to the original's category.
