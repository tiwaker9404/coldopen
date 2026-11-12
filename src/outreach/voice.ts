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

/**
 * The 15-minute offer, as a statement tied to the question just asked: their question comes
 * first, the call is optional. "I'd love to hear how you think about it" read as vague (judge).
 */
export const OFFER = "Happy to trade notes on that for 15 minutes if it's useful."
/** The offer when the question opened the email, a few lines up */
export const OFFER_LATER = "Happy to trade notes on that question for 15 minutes if it's useful."

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
3. The film is a gift with a reason to open it. One line naming the film's first idea for their product, in a few words ("I put one idea for <company> into a 30-second film: <the idea>"), never "I made a film for your role".
4. One real question about their work, naming a specific thing (a product, a feature or a number) from their post, their site or the homework, never a category of people ("most of your customers"). If the sender saved a question, use it word for word. The 15-minute offer is soft, tied to the question, and comes after it.
5. Thanks for their time. End with "Thanks for reading" or "Thank you for your time". Grateful, never begging.
6. No job words and no numbers. Never write ${JOB_WORDS.filter((w) => w !== 'openings' && w !== 'résumé').join(', ')}. No proof numbers: the film shows them.
7. Sound like a person. Contractions, plain words, under 125 words, no flattery. Only claim an experience ("I tried", "I used", "I built") that the sender's homework says, in any line of any message. Only name a product or feature of theirs that their post, their site or the homework names: never make one up.
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

/* ------------------------------------------------------------ the tease and what they published */

/**
 * The film line, naming the film's first idea in a few words: "I put one idea for Northwind
 * Freight into a 30-second film: stream carrier check-ins into one live view." The judge read
 * "what I'd try next with …" as abstract; the idea itself is the reason to open it.
 */
export const ideaTease = (company: string, idea: string, length: string) =>
  `I put one idea for ${company} into a ${length} film: ${idea.trim().replace(/[.!]$/, '')}.`

/** Where a line they published is from, as the opening says it: "changelog", "engineering blog" */
const SAID_IN: Record<string, string> = {
  changelog: 'changelog',
  engineering: 'engineering blog',
  blog: 'blog',
  news: 'news page',
  podcast: 'podcast notes',
  docs: 'docs',
}

/**
 * The opening when the sender saved no homework: the newest specific thing they published (a
 * changelog or engineering line, with its month), not the homepage tagline. In their words,
 * quoted, so it claims nothing about the sender.
 */
export function publishedOpening(
  company: string,
  line: { text: string; kind: string; month?: string | undefined },
): string {
  const where = SAID_IN[line.kind] ?? 'site'
  const when = line.month ? ` from ${line.month}` : ''
  return `I read ${company}'s ${where} entry${when}: "${line.text.trim().replace(/[.]$/, '')}".`
}

/**
 * Words that name a category of people or say nothing specific: a question about "most of your
 * customers" or "what you're building" could go to any company, so it doesn't count as curious.
 */
export const GENERIC_NOUNS = new Set(
  'shipper shippers customer customers team teams company companies user users people client clients brand brands business businesses product products platform platforms work thing things part parts hardest building build built right now today folks companies merchants partners'.split(
    ' ',
  ),
)

// verbs that start or end a pair without naming a thing ("move dock", "carrier runs")
const VERBISH = new Set(
  'become becomes stream sync unify ship put triage prototype tighten log roll catch build showing using making letting helping getting saying kept hitting move moves book books see sees saw get gets got walks walk tracked track sends sent make makes show shows run runs send sends take takes give gives turn turns help helps keep keeps let lets find finds start starts flows flow saves save reach reaches lands land use uses offer offers'.split(
    ' ',
  ),
)

const STOPS = new Set(
  'the and for with that this your you our are was from into have has its their they them than what when which who will just about over more most only also like now new on of to in a an at by or as is it be so if then both every each all any own before after through how back something someone fastest clearest once around much many one view per minute minutes hour hours day days week weeks month months year years percent'.split(
    ' ',
  ),
)

/**
 * A specific thing a line names, for a question to ask about: a two-word name in it that their
 * other text says too ("dock appointment"), else one in it at all, else a word their other text
 * shares. Never a category of people (GENERIC_NOUNS) or the company's own name. Null when the
 * line names nothing a question could hold on to.
 */
export function specificThing(
  line: string,
  elsewhere: string,
  company = '',
  /** only a name their other text says too: for the sender's own words, which name anything */
  strict = false,
): string | null {
  // their brand word ("Northwind"), not the plain words of a name ("Freight")
  const name = new Set(company.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 1))
  const ok = (w: string) =>
    /^[a-z][a-z-]{2,}$/.test(w) && !STOPS.has(w) && !GENERIC_NOUNS.has(w) && !name.has(w)
  const ws = line
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const other = ` ${elsewhere
    .toLowerCase()
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')} `
  const pairs: string[] = []
  for (let i = 0; i + 1 < ws.length; i++) {
    const [a, b] = [ws[i]!, ws[i + 1]!]
    // "routing agents", "dock appointment"; not "runs late" (an -s verb then an adverb)
    if (
      ok(a) &&
      ok(b) &&
      !VERBISH.has(a) &&
      !VERBISH.has(b) &&
      !/(ly|ed)$/.test(b) &&
      !/ed$/.test(a) &&
      !/[^s]s$/.test(a)
    )
      pairs.push(`${a} ${b}`)
  }
  const said = (p: string) => other.includes(` ${p.replace(/s$/, '')}`)
  const found = strict
    ? (pairs.find(said) ?? ws.filter((w) => ok(w) && !VERBISH.has(w) && w.length >= 4).find(said))
    : (pairs.find(said) ??
      pairs[0] ??
      ws.filter(ok).find((w) => said(w)) ??
      // the longest plain word in their own line ("documentation", "freight")
      ws
        .filter((w) => ok(w) && !VERBISH.has(w) && !/(ed|ly)$/.test(w) && w.length >= 5)
        .sort((a, b) => b.length - a.length)[0])
  if (!found) return null
  // as the line writes it ("rate API", not "rate api")
  const at = line.toLowerCase().indexOf(found)
  const written = at >= 0 ? line.slice(at, at + found.length) : found
  // a capital only because it starts their sentence ("Route planning") comes down
  return at === 0 && /^[A-Z][a-z]+(\s[a-z]|$)/.test(written)
    ? written[0]!.toLowerCase() + written.slice(1)
    : written
}
