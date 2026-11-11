/**
 * How a job seeker's messages sound, written down once: the words they never use, the thanks
 * they end on, the rules the model is given, and the homework line an email opens with. The
 * people these messages go to (founders, recruiting, people doing the job) already know from
 * the profile that the sender is looking. What earns a reply is a curious person who did real
 * homework on their product, asks one question they can answer, and says thanks. checks.ts
 * enforces these for candidate messages; messages.ts writes its templates to them.
 * Pure: no network, no clock.
 */

/**
 * The sender's own homework for one film, saved after it was made (PUT /v1/films/:id/homework):
 * a detail from using the product, their question for these people, and something small they
 * built with it. Each is null until saved. These are the sender's words: nothing in a message
 * may claim an experience they didn't write here.
 */
export interface SenderHomework {
  detail: string | null
  question: string | null
  built: { url: string; line: string } | null
}

/**
 * Words that make a networking message read as a job pitch. They know he's looking; saying so
 * turns "a curious person wrote to me" into "an applicant wrote to me". Matched as whole words,
 * with a plural "s", case-insensitively, outside quotation marks: a title quoted from their own
 * post is their words, not a pitch. Follow-ups and the referral ask (later) are the exception.
 */
export const JOB_WORDS = [
  'role',
  'position',
  'opening',
  'openings',
  'hiring',
  'apply',
  'applying',
  'application',
  'candidate',
  'résumé',
  'resume',
  'job',
] as const

/**
 * How the after-accept message, InMail and email end, just before the signature. Thanks in a
 * help-seeking email lifts replies (Boomerang: 62% with thanks against 46% without), and it's
 * grateful without begging.
 */
export const THANKS = [
  'thanks for reading',
  'thank you for your time',
  'thanks for considering it',
  'thanks either way',
  'thank you',
] as const

/** What the templates sign off with */
export const SIGN_OFF = 'Thanks for reading,'

/** The 15-minute offer, as a statement: their question comes first, the call is optional */
export const OFFER = "If you ever have 15 minutes, I'd love to hear how you think about it."

/** Text inside quotation marks (straight or curly) is their words, so job words there don't count */
const QUOTED = /"[^"\n]*"|“[^”\n]*”/g

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The job words in a text, outside quotation marks, each once, in list order */
export function jobWordsIn(text: string): string[] {
  const t = text.replace(QUOTED, ' ').toLowerCase()
  return JOB_WORDS.filter((w) =>
    // letters with accents (résumé) count as word characters, so "resumed" isn't "resume"
    new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}s?($|[^\\p{L}\\p{N}])`, 'u').test(t),
  )
}

/**
 * Whether a message ends on thanks: the last thanks phrase is followed only by its punctuation
 * and a signature (a name, contact lines, "– Alex"), never by more message.
 */
export function endsWithThanks(body: string): boolean {
  const t = body.replace(/[‘’]/g, "'").toLowerCase()
  const at = Math.max(
    ...THANKS.map((p) => {
      const re = new RegExp(`(^|[^a-z])${escapeRe(p)}(?![a-z])`, 'g')
      let last = -1
      for (const m of t.matchAll(re)) last = m.index + m[0].length
      return last
    }),
  )
  if (at < 0) return false
  const rest = t
    .slice(at)
    // the phrase's own punctuation ("Thanks for reading,"), then an inline "– Alex"
    .replace(/^[,.]/, '')
    .replace(/^[ \t]*[–—-][ \t]*/, '\n')
  const [line, ...after] = rest.split('\n')
  // a thanks in the middle of a sentence ("thank you for your time on…") isn't the ending
  if (line!.trim()) return false
  // what's left is the signature: a few short lines, no questions, no sentences
  const sig = after.map((l) => l.trim()).filter(Boolean)
  return sig.length <= 3 && sig.every((l) => l.split(/\s+/).length <= 5 && !/\?|[.!]\s/.test(l))
}

/**
 * The rules the model is given for a job seeker's messages (step 3 puts them in its prompt).
 * The code checks the same things: not_job_pitch, thanks, no_proof_numbers, curious, one_ask
 * and homework_grounded in checks.ts.
 */
export const VOICE_RULES = `
Voice rules for these messages (checked in code; a violation means a rewrite):
1. Their work first. The first line is about them: what the sender used, read or built with their product. Never the role, never a number.
2. One thing that isn't on the résumé: the sender's homework (a product detail, a small build, something from their docs or changelog), or the line about what the sender built that made this film.
3. The film is a gift with a reason to open it. One line saying what's in it in terms of their work ("what I'd try next with your retry API, in 30 seconds"), never "I made a film for your role".
4. One real question about their work: something the sender wondered while using the product or reading their post. If the sender saved a question, use it word for word. The 15-minute offer is soft, and comes after the question.
5. Thanks for their time. End with "Thanks for reading" or "Thank you for your time". Grateful, never begging.
6. No job words and no numbers. Never write ${JOB_WORDS.filter((w) => w !== 'openings' && w !== 'résumé').join(', ')}. No proof numbers: the film shows them.
7. Sound like a person. Contractions, plain words, under 125 words, no flattery. Only claim an experience ("I tried", "I used", "I built") that the sender's homework says.
`.trim()

/* ------------------------------------------------------------ the homework line */

/** "The one thing I kept hitting" -> "the one thing I kept hitting", keeping "I" and names */
export const lower = (s: string) =>
  /^[A-Z][a-z]/.test(s) && !/^I\b/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s

/** A line of the sender's own, mid-sentence: also "A carrier rate comparer" -> "a carrier…" */
export const lowerStart = (s: string) => (/^A\s/.test(s) ? `a${s.slice(1)}` : lower(s))

/** The sender's detail, in their voice ("I read your post…") or after "I've been using…" */
export const detailLine = (company: string, detail: string) =>
  /^I\b/.test(detail)
    ? `${detail.replace(/[.!]$/, '')}.`
    : `I've been using ${company}, and ${lower(detail)}.`

/** What the sender built with their product, in their words, with its link */
export const builtLine = (company: string, built: { url: string; line: string }) =>
  `I built something small with ${company}: ${lowerStart(built.line.trim().replace(/[.!]$/, ''))} (${built.url}).`

/**
 * A summary cut at 200 characters ends in "…". A message never ends a sentence on a cut word:
 * it ends at the last whole clause instead, or leaves the line out when what's left is too
 * short to say anything.
 */
export function wholeClause(s: string): string {
  if (!/…$/.test(s)) return s
  const t = s.replace(/[\s.,;:–—-]*…$/, '')
  const at = Math.max(...[', ', '; ', ': ', ' – ', ' — '].map((b) => t.lastIndexOf(b)))
  const head = at > 0 ? t.slice(0, at).trim() : ''
  return head.split(/\s+/).length >= 5 ? head : ''
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)

/**
 * The summary repeats the title when it opens with the title's first words ("Route planning,
 * now with live traffic" / "Route planning now reroutes trucks…") or carries most of them.
 */
function echoes(title: string, line: string): boolean {
  const t = words(title)
  const l = words(line)
  if (!t.length) return false
  if (t.length >= 2 && l[0] === t[0] && l[1] === t[1]) return true
  return t.filter((w) => l.includes(w)).length / t.length >= 0.6
}

/**
 * What they published, said once. When the summary already says what the title says, the
 * summary stands alone; otherwise the title names the post.
 */
export function researchSentence(title: string, raw: string): string {
  const line = raw.trim().replace(/\.$/, '')
  if (!title) return `I read your recent post, and ${lower(line)}.`
  if (echoes(title, line)) return `I read that ${lower(line)}.`
  return `I read "${title}", and ${lower(line)}.`
}

export type HomeworkLine =
  | { kind: 'built'; line: string }
  | { kind: 'detail'; line: string }
  | { kind: 'post'; line: string }

/**
 * The line a message opens with, in order: what the sender built with their product, their
 * detail from using it, else their latest post (the item pickResearch chose: its title and the
 * line from it), else nothing. Only the sender's homework or the company's own words, so the
 * opening never claims an experience nobody had.
 */
export function homeworkLine(
  company: string,
  homework: SenderHomework | null | undefined,
  post?: { title?: string; line: string } | null,
): HomeworkLine | null {
  if (homework?.built) return { kind: 'built', line: builtLine(company, homework.built) }
  const detail = homework?.detail
    ?.replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]$/, '')
  if (detail) return { kind: 'detail', line: detailLine(company, detail) }
  const said = post?.line ? wholeClause(post.line.replace(/\s+/g, ' ').trim()) : ''
  if (said) return { kind: 'post', line: researchSentence(post?.title?.trim() ?? '', said) }
  return null
}
