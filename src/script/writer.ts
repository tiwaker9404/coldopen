import type { BrandKit, Fact } from '../brand/types.ts'
import { answers, proofText } from '../job/fit.ts'
import type { ChatMessage } from '../llm/types.ts'
import { JOB_WORDS } from '../outreach/voice.ts'
import { isDuty } from '../profile/pitch.ts'
import { rankProof } from '../profile/proof.ts'
import { checkScript, clampScript, jobPitchIn, overlap, quotableFacts, words } from './checks.ts'
import { aboutText, ideasFor, pitchAsIdeas, proofFor, theirThings } from './ideas.ts'
import { monthOf } from './storyboard.ts'
import { LIMITS, TASTE_RULES } from './taste.ts'
import type { Profile, Script, ScriptMeta } from './types.ts'

export const SYSTEM_PROMPT = `You write the script for a 30-second personalized video that a sender makes for one specific company.
The film plays as six short scenes: a hook greeting the company, what the sender noticed on their homepage (shown over a screenshot of it), one real fact from their site with why it matters, the pitch, the sender's proof, and a call to action.

${TASTE_RULES}

Reply with only a JSON object of this exact shape:
{"hook": string, "noticed": string, "insight": {"factId": string, "why": string}, "pitch": {"headline": string, "points": [string, string, string]}, "proof": [number, ...], "cta": string}`

/** what a job seeker's lines never say, as the prompt lists it */
const CANDIDATE_NEVER = `${JOB_WORDS.filter((w) => w !== 'openings' && w !== 'résumé')
  .map((w) => `"${w}"`)
  .join(', ')}, "hire me" or "interview"`

const PRESETS: Record<Profile['preset'], string> = {
  sales:
    'The sender sells the offer below to companies like this one. The film has one job: earn a reply by proving the sender understood this business. Talk about their customers and outcomes, not your features.',
  candidate: `The sender is a curious builder writing to people at this company about their product. They know from the sender's profile that the sender is looking for work, so the film never says so: it reads like a builder's take on what they make, not an application. Show that the sender understands what the company builds and who it serves. pitch.headline names what the sender would try or build with this company's product, or for its customers, in 4 to 10 words grounded in the sender's points and the fact you quote ("What I'd build next for <their thing>"), never "why I fit". pitch.points are 2 or 3 ideas for their product, each at most ${LIMITS.idea} words, written "I'd <verb> <their thing> — like <what the sender did, short>": the thing is one of THEIR THINGS or a word from their facts, and the "like …" is one proof's "did" or a project, said short ("like the <thing they made> I <verb>ed"). Never copy one of the sender's points as a pitch point. insight.why says what the sender would do with that fact ("I'd …"). The cta is a warm invitation to talk about their work, at most 8 words ("Trade notes on <their thing>?", "15 minutes on what's next?"). Never write ${CANDIDATE_NEVER} in the hook, noticed, why, headline or cta. Write in the first person ("I").`,
  hiring:
    'The sender is on the team at this company and is announcing an open role to everyone, as a LinkedIn post. The company facts are your own company. Speak to whoever is watching as "you" and about your company as "we" or "our". Make the role feel concrete and worth applying for, without hype. The call to action points to the job post.',
  recruiter:
    'The sender is a recruiter at this company, and the film is made for one candidate (named below) to pitch them the role. The company facts are your own company; the points and proof are the candidate\'s own record, taken from their résumé. Speak to the candidate as "you" and about your company as "we" or "our". Show them why their record fits this role. The call to action asks for a short conversation.',
}

const HIRING_JOB_BRIEF = (title: string) =>
  `This film announces your open ${title} role to everyone who sees the post. Feature one stat from your own site (insight.factId) and say in insight.why what it means for someone joining ("you would..." or "we..."). The pitch headline names the role; the pitch points are what the person would do, taken from the role lines given as the points. Numbers come only from your site's facts.`

const RECRUITER_JOB_BRIEF = (title: string) =>
  `This film pitches your ${title} role. The insight scene quotes one of the job's requirements word for word (pick its id, j1, j2...), and insight.why tells the candidate, in the second person ("You..."), where their record already answers it, taken from their points or proof. Pick the proof that answers the requirements best. The pitch headline names the role. Numbers in your lines must come from the candidate's record; the job post's numbers are what you want, not what they have done.`

const JOB_BRIEF = (title: string) =>
  `This film answers a job post: ${title}. The insight scene quotes one of the job's requirements word for word (pick its id, j1, j2...), and insight.why answers it in the first person with something you have already done, taken from your points or proof. Pick the proof that answers the requirements best. The pitch headline may name the role. Numbers in your lines must come from your profile; the job post's numbers are what they want, not what you have done.`

const CANDIDATE_JOB_BRIEF = (title: string) =>
  `The sender read their post for: ${title}. The insight scene quotes one of the post's requirements word for word (pick its id, j1, j2...), and insight.why says, in the first person, what you'd do about it ("I'd …"), drawing on something you have already done, taken from your points or proof. Pick the proof that answers the requirements best. The pitch headline still names what you'd try or build with their product, never the post itself. Numbers in your lines must come from your profile; the post's numbers are what they want, not what you have done.`

/** "(changelog, Oct 2026)": where a fact beyond the homepage is from, for the model to weigh */
function sourceTag(f: Fact): string {
  const s = f.source
  if (!s || s.kind === 'homepage' || s.kind === 'job') return ''
  const when = s.date ? `, ${monthOf(s.date)}` : ''
  return ` (${s.kind}${when})`
}

/** Lines about what they built lately: a changelog or engineering post (all from the last 120 days) */
const shipped = (f: Fact) => f.source?.kind === 'changelog' || f.source?.kind === 'engineering'

/** What a film's writers may be told about how close each proof is to the company by meaning */
export interface ScriptOptions {
  /** per proof index, its closeness to the company by meaning (FIT_SEMANTIC), on relevance()'s scale */
  semantic?: ReadonlyMap<number, number>
}

export function buildMessages(
  kit: BrandKit,
  profile: Profile,
  opts: ScriptOptions = {},
): ChatMessage[] {
  // only facts a stranger can read on their own are offered (checks.ts standsAlone)
  const offered = quotableFacts(kit).filter((f) => f.kind !== 'requirement')
  const facts = offered
    .slice(0, 24)
    .map(
      (f) =>
        `${f.id} [${f.kind}]${sourceTag(f)} ${f.text.length > 220 ? `${f.text.slice(0, 220)}…` : f.text}`,
    )
    .join('\n')
  // the facts from their own posts: a recent changelog or engineering line beats a homepage claim
  const prefer = offered.some(shipped)
    ? '\nFacts marked (changelog …) or (engineering …) are what they shipped in the last 120 days. Pick in this order: a [stat], then one of those lines about what they built, then a homepage claim.'
    : ''
  const reqs = kit.facts.filter((f) => f.kind === 'requirement')
  const job = kit.job
    ? `

THE JOB: ${kit.job.title}
Requirements from the post (cite by id; feature one that is under 160 characters):
${reqs.map((f) => `${f.id} ${f.text}`).join('\n')}

${profile.preset === 'recruiter' ? RECRUITER_JOB_BRIEF(kit.job.title) : profile.preset === 'hiring' ? HIRING_JOB_BRIEF(kit.job.title) : profile.preset === 'candidate' ? CANDIDATE_JOB_BRIEF(kit.job.title) : JOB_BRIEF(kit.job.title)}`
    : ''
  const recruiter = profile.preset === 'recruiter'
  const proof = profile.proof
    .map(
      (p, i) =>
        `${i}: ${p.value} ${p.label}${p.where ? ` (${p.where})` : ''}${p.did ? `; did: ${p.did}` : ''}`,
    )
    .join('\n')
  // a job seeker's film shows the proof closest to their business first, and pitches ideas
  const seeker = profile.preset === 'candidate'
  const order = seeker ? rankProof(profile.proof, aboutText(kit), opts.semantic) : []
  const things = seeker ? theirThings(kit).slice(0, 6) : []
  const projects = seeker ? (profile.projects ?? []).slice(0, 3) : []
  const seekerNotes = seeker
    ? `\nProof most relevant to them first (pick from the start of this list): ${order.join(', ')}${
        things.length
          ? `\nTHEIR THINGS (their own names for what they make): ${things.join(', ')}`
          : ''
      }${
        projects.length
          ? `\nProjects the sender built (a "like …" may name one): ${projects.map((p) => `${p.name}: ${p.line}`).join('; ')}`
          : ''
      }`
    : ''
  const user = `${PRESETS[profile.preset]}

COMPANY
Name: ${kit.name}
Website: ${kit.host}
Homepage headline: ${kit.headline}
Description: ${kit.description}

FACTS FROM THEIR SITE (cite by id)
${facts}${prefer}

SENDER
Name: ${profile.sender.name}${profile.sender.company ? `, ${profile.sender.company}` : ''}${profile.sender.role ? ` (${profile.sender.role})` : ''}
Offer: ${profile.offer}${recruiter && profile.recipient ? `\nCandidate: ${profile.recipient.name}` : ''}
${recruiter ? "The candidate's strengths you may tailor" : 'Points you may tailor'}:
${profile.points.map((p) => `- ${p}`).join('\n')}
${recruiter ? "The candidate's proof" : 'Proof'} (pick by index; shown verbatim):
${proof}${seekerNotes}
${profile.preset === 'candidate' ? `The sender's own ask, for its tone (write a warm invitation about their work instead): ${profile.cta.line}` : `Call to action: ${profile.cta.line}`}${job}`
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ]
}

export type Complete = (key: string, messages: ChatMessage[]) => Promise<Script>

/**
 * Write -> check -> revise. The model gets the exact violations back and rewrites, up to
 * `maxRounds`. If it still can't comply, limits are enforced mechanically, and if that's
 * still not clean, a deterministic writer takes over. A film never ships with a violation.
 */
export async function writeScript(opts: {
  kit: BrandKit
  profile: Profile
  complete: Complete
  model: string
  maxRounds?: number
  semantic?: ReadonlyMap<number, number>
}): Promise<{ script: Script; meta: ScriptMeta }> {
  const { kit, profile } = opts
  const max = opts.maxRounds ?? 4
  const more: ScriptOptions = opts.semantic ? { semantic: opts.semantic } : {}
  const messages = buildMessages(kit, profile, more)
  const history: string[][] = []
  let script: Script | null = null

  for (let round = 1; round <= max; round++) {
    script = await opts.complete(`script-${round}`, messages)
    const v = checkScript(script, kit, profile, more)
    history.push(v)
    if (v.length === 0)
      return {
        script,
        meta: {
          model: opts.model,
          rounds: round,
          violations: history,
          usedFallback: false,
          replaced: [],
        },
      }
    // only the latest draft and its problems go back: resending every round would grow each
    // request past a free tier's tokens-per-minute limit
    messages.splice(
      2,
      messages.length,
      { role: 'assistant', content: JSON.stringify(script) },
      {
        role: 'user',
        content: `Revise the script. Fix every problem below and change nothing else:\n${v.map((x) => `- ${x}`).join('\n')}\nReply with only the corrected JSON.`,
      },
    )
  }

  // keep every line the model got right; swap only the lines it couldn't fix. Swapping comes
  // before clamping, so a line is never shipped cut off mid-sentence.
  const fallback = deterministicScript(kit, profile, more)
  const fixed = repair(script!, fallback, kit, profile, more)
  const second = checkScript(fixed.script, kit, profile, more).length
    ? repair(clampScript(fixed.script, profile), fallback, kit, profile, more)
    : fixed
  const repaired = second.script
  const replaced = [...new Set([...fixed.replaced, ...second.replaced])]
  const remaining = checkScript(repaired, kit, profile, more)
  if (remaining.length === 0) {
    return {
      script: repaired,
      meta: { model: opts.model, rounds: max, violations: history, usedFallback: false, replaced },
    }
  }
  return {
    script: deterministicScript(kit, profile, more),
    meta: {
      model: opts.model,
      rounds: max,
      violations: [...history, remaining],
      usedFallback: true,
      replaced: [...FIELDS],
    },
  }
}

const FIELDS = [
  'hook',
  'noticed',
  'insight',
  'pitch.headline',
  'pitch.points',
  'proof',
  'cta',
] as const

function withField(s: Script, from: Script, f: (typeof FIELDS)[number]): Script {
  if (f === 'pitch.headline') return { ...s, pitch: { ...s.pitch, headline: from.pitch.headline } }
  if (f === 'pitch.points') return { ...s, pitch: { ...s.pitch, points: from.pitch.points } }
  return { ...s, [f]: from[f] }
}

/** Greedily swap in deterministic lines, keeping a swap only when it removes violations. */
function repair(
  script: Script,
  fallback: Script,
  kit: BrandKit,
  profile: Profile,
  more: ScriptOptions = {},
): { script: Script; replaced: string[] } {
  let current = script
  let count = checkScript(current, kit, profile, more).length
  const replaced: string[] = []
  for (const f of FIELDS) {
    if (count === 0) break
    const next = withField(current, fallback, f)
    const n = checkScript(next, kit, profile, more).length
    if (n < count) {
      current = next
      count = n
      replaced.push(f)
    }
  }
  return { script: current, replaced }
}

/* ------------------------------------------------- deterministic writer */

const clip = (s: string, n: number) =>
  s
    .trim()
    .split(/\s+/)
    .slice(0, n)
    .join(' ')
    .replace(/[.,;:]$/, '')

function bestFact(kit: BrandKit, profile: Profile): Fact {
  const vocab = new Set(
    `${profile.offer} ${profile.points.join(' ')}`
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 4),
  )
  const score = (f: Fact) =>
    (f.kind === 'stat' ? 3 : f.kind === 'quote' ? 2 : 0) +
    f.text
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => vocab.has(w)).length -
    (f.text.length > 120 ? 2 : 0) -
    // release badges and link labels are on the page, but aren't about the business
    (/\blaunch(es|ed)?\b|announcing|introducing|^new\b|read more|learn more|\braise[sd]?\b|funding|series [a-f]\b/i.test(
      f.text,
    )
      ? 3
      : 0) -
    (f.text.length < 25 ? 1 : 0)
  // in order: a stat, then a recent changelog or engineering line about what they built, then
  // anything else (a homepage claim); the best-scoring line within each
  const tier = (f: Fact) => (f.kind === 'stat' ? 0 : shipped(f) ? 1 : 2)
  return (
    quotableFacts(kit)
      .filter((f) => f.kind !== 'headline' && f.kind !== 'requirement')
      .sort((a, b) => tier(a) - tier(b) || score(b) - score(a))[0] ?? kit.facts[0]!
  )
}

/** Quote their own headline when it's short enough to read on screen; it's the most personal line we have. */
function noticedLine(kit: BrandKit, first: string): string {
  const h = kit.headline
    .replace(/[.!]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  const quoted = `${first} leads with \u201c${h}\u201d`
  if (h && words(quoted) <= LIMITS.noticed && !h.includes('!')) return quoted
  // too long to quote: point at the highlighted headline instead of paraphrasing it
  return clip(`The first thing ${first} promises on its homepage`, LIMITS.noticed)
}

/**
 * A stable pick from a few phrasings, keyed on the company, so the same company always gets
 * the same film (journaled steps replay identically) and two companies rarely get the same
 * words. FNV-1a over the name plus a slot salt, so each line varies on its own.
 */
export function variant<T>(key: string, slot: string, options: readonly T[]): T {
  let h = 0x811c9dc5
  for (const ch of `${slot}:${key.trim().toLowerCase()}`) {
    h ^= ch.codePointAt(0)!
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return options[h % options.length]!
}

/** Greetings that name the company; the longest one that fits the word limit is used. */
export const HOOKS = [
  (n: string) => `Hi ${n} team`,
  (n: string) => `A short film for ${n}`,
  (n: string) => `Made for the ${n} team`,
  (n: string) => `For the people building ${n}`,
] as const

function hookFor(name: string, first: string): string {
  const pick = variant(name, 'hook', HOOKS)
  for (const line of [pick(name), pick(first), `Hi ${name} team`, `Hi ${first} team`])
    if (words(line) <= LIMITS.hook) return line
  return `Hi ${first} team`
}

/**
 * A job seeker's pitch headline: what they'd try or build with this company's product, never
 * "why I fit". The slot is their thing ("Parcelpine's returns", or the company), so two
 * companies rarely share a line.
 */
export const HEADLINES = [
  (thing: string) => `What I'd build next for ${thing}`,
  (thing: string) => `What I'd try first with ${thing}`,
  (thing: string) => `Where I'd take ${thing} next`,
  (thing: string) => `What I'd prototype with ${thing}`,
] as const

/**
 * A job seeker's ask on the end card: a warm invitation to talk about their work, at most 8
 * words, never about a job. The slot is their thing, as in HEADLINES.
 */
export const CTAS = [
  (thing: string) => `Trade notes on ${thing}?`,
  (thing: string) => `Could we talk about ${thing} sometime?`,
  (thing: string) => `Up for a short chat about ${thing}?`,
  (thing: string) => `Swap notes on what's next for ${thing}?`,
] as const

// plural words that are verbs or say nothing about what they make ("turns", "teams")
const NOT_A_TOPIC = new Set(
  'turns gives makes helps runs uses keeps saves lets brings builds works sends offers means does goes takes always others teams customers companies businesses users people results thanks years hours minutes days weeks months times ways things'.split(
    ' ',
  ),
)

/**
 * What the quoted fact is about, when their homepage says it too: "61% of returns become
 * exchanges" on a site about returns gives "returns". A plural noun the two share, or null.
 */
export function topicOf(
  kit: Pick<BrandKit, 'headline' | 'description'>,
  fact: Fact,
): string | null {
  const about = ` ${`${kit.headline} ${kit.description}`.toLowerCase().replace(/[^a-z\s-]/g, ' ')} `
  for (const w of fact.text.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? [])
    if (/[^s]s$/.test(w) && !NOT_A_TOPIC.has(w) && about.includes(` ${w} `)) return w
  return null
}

/** The line, with the longest version of their thing that fits the word limit */
function fitted(
  pick: (thing: string) => string,
  name: string,
  topic: string | null,
  max: number,
  fallback: string,
): string {
  const first = name.split(/\s+/)[0]!
  const things = topic ? [`${name}'s ${topic}`, `${first}'s ${topic}`, name, first] : [name, first]
  for (const t of things)
    if (words(pick(t)) <= max && !jobPitchIn(pick(t), name).length) return pick(t)
  return fallback
}

export const WHY = {
  // what the sender would do with the fact ("I'd …"), not why they fit
  candidateStat: [
    "I'd want to find out what moves this number next",
    "I'd start by asking which customers move this number most",
    "I'd build something small to push this number further",
    "I'd dig into what sits behind a number like this",
  ],
  candidateClaim: [
    "I'd try building on this for the next set of customers",
    "I'd start by asking customers where this lands best",
    "I'd prototype the next step that makes this true",
    "I'd want to see how far this promise can go",
  ],
  salesStat: [
    (who: string) => `${who} teams measure what moves a number like this`,
    (who: string) => `${who} teams find the next number like this`,
    (who: string) => `${who} teams show what drives a number like this`,
    (who: string) => `${who} teams turn numbers like this into plans`,
  ],
  salesClaim: [
    (who: string) => `${who} teams turn a claim like this into proof`,
    (who: string) => `${who} teams back a promise like this with data`,
    (who: string) => `${who} teams show customers this claim holds up`,
    (who: string) => `${who} teams measure whether a promise like this lands`,
  ],
} as const

/** One honest sentence tying the featured fact to the sender, without claiming anything new. */
function whyLine(fact: Fact, candidate: boolean, company: string | undefined, key: string): string {
  const numeric = fact.kind === 'stat'
  if (candidate) return variant(key, 'why', numeric ? WHY.candidateStat : WHY.candidateClaim)
  const who = company ? `${company} helps` : 'We help'
  return variant(key, 'why', numeric ? WHY.salesStat : WHY.salesClaim)(who)
}

/**
 * A rule-based writer used as the stand-in model (tests, CI, the no-key demo) and as the
 * final fallback. Plainer than a good LLM, but always on-brief and always grounded.
 */
export function deterministicScript(
  kit: BrandKit,
  profile: Profile,
  opts: ScriptOptions = {},
): Script {
  if (profile.preset === 'hiring') return hiringScript(kit, profile)
  if (kit.job) return jobScript(kit, profile, kit.job.title, opts)
  const name = kit.name
  const first = name.split(/\s+/)[0]!
  const fact = bestFact(kit, profile)
  const candidate = profile.preset === 'candidate'
  const hook =
    profile.preset === 'recruiter'
      ? recruiterHook(profile.recipient?.name.split(/\s+/)[0], name, first)
      : hookFor(name, first)
  return {
    hook,
    noticed: noticedLine(kit, first),
    insight: {
      factId: fact.id,
      why: clip(whyLine(fact, candidate, profile.sender.company, name), LIMITS.why),
    },
    pitch: {
      headline: clip(
        candidate
          ? fitted(
              variant(name, 'headline', HEADLINES),
              name,
              topicOf(kit, fact),
              LIMITS.headline,
              `What I'd try first with ${first}`,
            )
          : words(profile.offer) >= 4
            ? profile.offer
            : `${profile.offer.replace(/[.]$/, '')}, made for ${first}`,
        LIMITS.headline,
      ),
      // a job seeker's pitch is ideas for their product; anyone else's, their own points (prefer
      // points that already fit, so nothing is cut mid-phrase)
      points:
        candidate && pitchAsIdeas(kit, profile)
          ? ideaPoints(kit, profile, opts)
          : [...profile.points]
              .sort((a, b) => Number(words(a) > LIMITS.point) - Number(words(b) > LIMITS.point))
              .slice(0, 3)
              .map((p) => clip(p, LIMITS.point)),
    },
    // a job seeker's proof: the closest to their business first, then the most impressive
    proof: candidate
      ? proofFor(kit, profile, opts.semantic)
      : profile.proof.slice(0, 3).map((_, i) => i),
    cta: candidate ? candidateCta(name, topicOf(kit, fact)) : clip(profile.cta.line, LIMITS.cta),
  }
}

/** A job seeker's pitch points: ideas for their product, resting on the proof closest to them */
function ideaPoints(kit: BrandKit, profile: Profile, opts: ScriptOptions): string[] {
  return ideasFor(kit, profile, rankProof(profile.proof, aboutText(kit), opts.semantic)).map(
    (i) => i.line,
  )
}

/** A job seeker's ask: a warm invitation about their work, picked per company (CTAS) */
function candidateCta(name: string, topic: string | null): string {
  return fitted(variant(name, 'cta', CTAS), name, topic, LIMITS.cta, "Trade notes on what's next?")
}

/** "Deployed AI agents at 14 warehouses" -> "You did this: deployed AI agents at 14 warehouses" */
function youDid(point: string): string | null {
  const t = point.trim().replace(/[.;]$/, '')
  const line = `You did this: ${t[0]!.toLowerCase()}${t.slice(1)}`
  if (words(line) <= LIMITS.why) return line
  const cut = trimAtBreak(t, LIMITS.why - 3)
  return cut ? `You did this: ${cut[0]!.toLowerCase()}${cut.slice(1)}` : null
}

/** "Hi Priya, from Northwind": the candidate by first name, and who is writing */
function recruiterHook(them: string | undefined, name: string, first: string): string {
  const who = them ? `Hi ${them}, from` : 'A role for you at'
  return words(`${who} ${name}`) <= LIMITS.hook ? `${who} ${name}` : `${who} ${first}`
}

/* --------------------------------------------- answering a job post */

type ProofItem = Profile['proof'][number]

/** Shortens a phrase at a natural break ("..., via X", "... using Y") so it still reads whole. */
function trimAtBreak(text: string, max: number): string | null {
  if (words(text) <= max) return text
  const breaks = [
    ',',
    ' via ',
    ' using ',
    ' with ',
    ' through ',
    ' across ',
    ' for ',
    ' by ',
    ' in ',
  ]
  let best: string | null = null
  for (const b of breaks) {
    let at = text.indexOf(b)
    while (at > 0) {
      const head = text
        .slice(0, at)
        .trim()
        .replace(/[,;:]$/, '')
      if (words(head) <= max && (!best || head.length > best.length)) best = head
      at = text.indexOf(b, at + 1)
    }
  }
  return best && words(best) >= 3 ? best : null
}

/** "Turns messy data into pipelines" -> "I turn messy data into pipelines"; null if unsure. */
function firstPerson(point: string): string | null {
  const [verb, ...rest] = point.trim().split(/\s+/)
  if (!verb || !/^[A-Z][a-z]{2,}s$/.test(verb) || /ss$/.test(verb)) return null
  const base = /(ch|sh|x|ss)es$/.test(verb) ? verb.slice(0, -2) : verb.slice(0, -1)
  const line = `I ${base.toLowerCase()} ${rest.join(' ')}`.replace(/[.,;]$/, '')
  return words(line) <= LIMITS.why ? line : (trimAtBreak(line, LIMITS.why) ?? null)
}

/** The one-line answer: the proof item that answers it, and where it happened. */
function answerLine(p: ProofItem, direct: boolean, you = false): string {
  const done = `${p.value} ${p.label}`.replace(/\.$/, '')
  // "I did this" only when the proof plainly matches the requirement; otherwise say less
  // "On GitHub", "At Duke" already carry their preposition
  const at = p.where
    ? /^(on|at|in|for|with)\s/i.test(p.where)
      ? ` ${p.where[0]!.toLowerCase()}${p.where.slice(1)}`
      : ` at ${p.where}`
    : ''
  // a recruiter's film says it to the candidate: "You did this at Stripe:"
  const [did, have, closest] = you
    ? ['You did this', 'You have done this', 'Your closest match']
    : ['I did this', 'I have done this', 'My closest match']
  const prefix = direct
    ? p.where
      ? `${did}${at}:`
      : `${have}:`
    : p.where
      ? `${closest},${at}:`
      : `${closest}:`
  for (const pre of [prefix, direct ? `${did}:` : `${closest}:`]) {
    const rest = trimAtBreak(done, LIMITS.why - words(pre))
    if (rest) return `${pre} ${rest}`
  }
  return clip(`${prefix} ${done}`, LIMITS.why)
}

/**
 * The deterministic writer for a job post: feature the requirement the sender's record answers
 * best, answer it with the matching proof, and lead the proof scene with what fits the role.
 */
function jobScript(
  kit: BrandKit,
  profile: Profile,
  title: string,
  opts: ScriptOptions = {},
): Script {
  const name = kit.name
  const first = name.split(/\s+/)[0]!
  const reqs = kit.facts.filter((f) => f.kind === 'requirement')
  const quotable = reqs.filter((f) => f.text.length <= 160)
  const allReqs = reqs.map((f) => f.text).join(' ')
  const byFit = (texts: string[], against: string) =>
    texts.map((t, i) => ({ i, f: answers(t, against) })).sort((a, b) => b.f - a.f || a.i - b.i)
  // for each requirement: the proof item and the point that answer it best
  const options = (quotable.length ? quotable : reqs).map((r, ri) => {
    const proof = byFit(profile.proof.map(proofText), r.text)[0]!
    const point = byFit(profile.points, r.text)[0] ?? { i: -1, f: 0 }
    // a requirement one of the sender's own points already claims is theirs to answer
    return { r, ri, proof, point, score: proof.f + 0.7 * point.f }
  })
  options.sort((a, b) => b.score - a.score || a.ri - b.ri)
  const best = options[0]!
  const req = best.r
  const answer = best.proof.i
  // say "I did this" only about something on the record that plainly matches
  // (a point that claims it plus proof that touches it counts; so does a point alone, said
  // in the first person, as long as it isn't just their requirement read back to them)
  const recruiter = profile.preset === 'recruiter'
  const claim = best.point.i >= 0 && !recruiter ? firstPerson(profile.points[best.point.i]!) : null
  // a recruiter's film: when one of the candidate's own bullets answers the requirement better
  // than any number does, say that bullet ("You did this: Deployed AI agents with evals…")
  const theirBullet =
    recruiter && best.point.i >= 0 && best.point.f >= 0.34 && best.point.f > best.proof.f
      ? youDid(profile.points[best.point.i]!)
      : null
  const why = theirBullet
    ? theirBullet
    : best.proof.f >= 0.34 || (best.point.f >= 0.34 && best.proof.f > 0)
      ? answerLine(profile.proof[answer]!, true, recruiter)
      : best.point.f >= 0.34 && claim && overlap(claim, req.text) <= 0.6
        ? claim
        : answerLine(profile.proof[answer]!, false, recruiter)
  const rest = byFit(profile.proof.map(proofText), allReqs)
    .map((x) => x.i)
    .filter((i) => i !== answer)
  const them = profile.recipient?.name.split(/\s+/)[0]
  const hook = recruiter ? recruiterHook(them, name, first) : hookFor(name, first)
  // a job seeker's film is a builder's take on their product, not an answer to the post: the
  // headline and the ask are about what they make (the topic comes from their homepage's stat)
  const candidate = profile.preset === 'candidate'
  const topic = candidate ? topicOf(kit, bestFact(kit, profile)) : null
  const headline = recruiter
    ? words(`Why you fit our ${title} role`) <= LIMITS.headline
      ? `Why you fit our ${title} role`
      : `Why you fit the role at ${first}`
    : !candidate
      ? words(`Why I fit your ${title} role`) <= LIMITS.headline
        ? `Why I fit your ${title} role`
        : 'Why I fit the role you posted'
      : fitted(
          variant(name, 'headline', HEADLINES),
          name,
          topic,
          LIMITS.headline,
          `What I'd try first with ${first}`,
        )
  return {
    hook,
    noticed: noticedLine(kit, first),
    insight: { factId: req.id, why: candidate ? ownWords(why, profile, name) : why },
    pitch: {
      headline: clip(headline, LIMITS.headline),
      points:
        candidate && pitchAsIdeas(kit, profile)
          ? ideaPoints(kit, profile, opts)
          : byFit(profile.points, allReqs)
              // the bullet that answered the requirement is already on screen
              .filter((x) => !(theirBullet && x.i === best.point.i) || profile.points.length <= 2)
              .map((x) => profile.points[x.i]!)
              .sort((a, b) => Number(words(a) > LIMITS.point) - Number(words(b) > LIMITS.point))
              .slice(0, 3)
              .map((p) => clip(p, LIMITS.point)),
    },
    // a job seeker's: the proof that answers the requirement, then the closest to their business
    proof: candidate
      ? [
          answer,
          ...rankProof(profile.proof, aboutText(kit), opts.semantic).filter((i) => i !== answer),
        ].slice(0, 3)
      : [answer, ...rest].slice(0, 3),
    cta: candidate ? candidateCta(name, topic) : clip(profile.cta.line, LIMITS.cta),
  }
}

/**
 * A job seeker's answer to a requirement says what they did, in their record's words; when those
 * words happen to include a job word ("loan applications"), it says where instead.
 */
function ownWords(why: string, profile: Profile, name: string): string {
  if (!jobPitchIn(why, name).length) return why
  const where = profile.proof.find((p) => p.where && !jobPitchIn(p.where, name).length)?.where
  const line = where ? `I'd start here, the way I did at ${where}` : null
  return line && words(line) <= LIMITS.why ? line : "I'd start here, with what I've built before"
}

/* ------------------------------------------------- a hiring film, for everyone */

/**
 * The deterministic writer for a hiring film: who's hiring, one number from their own site,
 * what you would do (the post's own lines), and where to apply.
 */
function hiringScript(kit: BrandKit, profile: Profile): Script {
  const name = kit.name
  const first = name.split(/\s+/)[0]!
  const title = kit.job?.title
  const fact = bestFact(kit, profile)
  const hook =
    words(`${name} is hiring`) <= LIMITS.hook ? `${name} is hiring` : `${first} is hiring`
  // the points are duties when the post lists them, otherwise what it asks for
  const doing = profile.points.filter(isDuty).length >= 2
  const headline = doing
    ? title && words(`What you would do as our ${title}`) <= LIMITS.headline
      ? `What you would do as our ${title}`
      : 'What you would do on our team'
    : title && words(`What we look for in our ${title}`) <= LIMITS.headline
      ? `What we look for in our ${title}`
      : 'What we look for in this role'
  // the featured number stays out of the proof scene, so nothing shows twice
  const proof = profile.proof
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !fact.text.includes(p.value))
    .map(({ i }) => i)
    .slice(0, 3)
  return {
    hook,
    noticed: noticedLine(kit, first),
    insight: {
      factId: fact.id,
      why: clip(
        fact.kind === 'stat'
          ? 'Numbers like this are what you would work on'
          : 'The kind of problem you would work on here',
        LIMITS.why,
      ),
    },
    pitch: {
      headline: clip(clipToWords(headline, LIMITS.headline), LIMITS.headline),
      points: [...profile.points]
        .sort((a, b) => Number(words(a) > LIMITS.point) - Number(words(b) > LIMITS.point))
        .slice(0, 3)
        .map((p) => clip(p, LIMITS.point)),
    },
    proof,
    cta: clip(profile.cta.line, LIMITS.cta),
  }
}

const clipToWords = (s: string, n: number) => (words(s) <= n ? s : 'What you would do here')
