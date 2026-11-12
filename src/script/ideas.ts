/**
 * A job seeker's pitch, as ideas for their product: "I'd <verb> <their thing> — like <what I
 * did>". The founder judge read the old pitch (the sender's résumé points under "What I'd try
 * first with …") as a headline that promised ideas and lines that gave none. Each idea's noun is
 * one of their own (a feature name or what their homepage leads with), and each "like …" is
 * something the sender actually did (a proof's `did`, or a project), so nothing is invented.
 * Pure: no network, no clock.
 */
import type { BrandKit, Fact } from '../brand/types.ts'
import { rankProof } from '../profile/proof.ts'
import { LIMITS } from './taste.ts'
import type { Profile } from './types.ts'

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

type Kit = Pick<BrandKit, 'name' | 'headline' | 'description' | 'facts'> & {
  job?: BrandKit['job']
}

/** Everything a company says about itself, for matching proof and ideas against it */
export function aboutText(kit: Kit): string {
  return [
    kit.headline,
    kit.description,
    kit.job?.title ?? '',
    ...kit.facts.map((f) => f.text),
  ].join('\n')
}

/** The proof a film shows, most relevant to this company first (rankProof), at most three */
export function proofFor(
  kit: Kit,
  profile: Pick<Profile, 'proof'>,
  semantic?: ReadonlyMap<number, number>,
): number[] {
  return rankProof(profile.proof, aboutText(kit), semantic).slice(0, 3)
}

/* ------------------------------------------------------------ their things */

const DETERMINERS = /^(the|a|an|one|every|each|your|our|their|all|any)\s+/i
// a short heading that opens on one of these is an instruction ("Offer the exchange…"), not a name
const IMPERATIVE = new Set(
  'offer bring book get try see start make let turn find join meet talk watch request ask learn read sign'.split(
    ' ',
  ),
)
const keepCase = (w: string) => /[A-Z].*[A-Z]|^[A-Z]{2,}|\d/.test(w)
const lowerWords = (s: string) =>
  s
    .split(/\s+/)
    .map((w) => (keepCase(w) ? w : w.toLowerCase()))
    .join(' ')

/** "Fraud checks on every return" -> "fraud checks"; "Patient intake that writes itself." -> "patient intake" */
function nounPhrase(text: string, max = 3): string | null {
  const head = text
    .trim()
    .replace(/[.!]$/, '')
    .split(/,|\s(?:that|which|who|on|for|with|in|before|after|from|so|visible|is|are)\s/i)[0]!
    .trim()
    .replace(DETERMINERS, '')
  const ws = head.split(/\s+/).filter(Boolean)
  if (!ws.length || ws.length > max) return null
  if (ws.some((w) => /\d|[?:;]/.test(w))) return null
  if (IMPERATIVE.has(ws[0]!.toLowerCase())) return null
  // one word alone is a name only when it's a plural ("returns"); "timeline" says nothing
  if (ws.length === 1 && !/[^s]s$/i.test(ws[0]!)) return null
  return lowerWords(ws.join(' '))
}

/**
 * Their own names for what they make, in their words: short feature headings from their site
 * ("Exception alerts", "Dock scheduling"), what their headline leads with ("patient intake"),
 * and the plural nouns their numbers are about ("returns"). Never the company's name or a place.
 */
export function theirThings(kit: Kit): string[] {
  const name = kit.name.toLowerCase()
  const first = name.split(/\s+/)[0]!
  const out: string[] = []
  const add = (t: string | null) => {
    if (!t) return
    const l = t.toLowerCase()
    if (l.length < 4 || l.includes(first) || name.includes(l)) return
    if (!out.some((o) => o.toLowerCase() === l)) out.push(t)
  }
  // short feature headings: a few words, no full stop, from the homepage
  for (const f of kit.facts)
    if (
      (f.kind === 'claim' || f.kind === 'headline') &&
      (!f.source || f.source.kind === 'homepage') &&
      !/[.,]$/.test(f.text.trim()) &&
      words(f.text) <= 5 &&
      words(f.text) >= 2
    )
      add(nounPhrase(f.text, 4))
  add(nounPhrase(kit.headline) ?? saidTwice(kit))
  for (const t of pairsSaidTwice(kit)) add(t)
  for (const f of kit.facts) if (f.kind === 'stat') add(pluralTopic(f, kit))
  return out
}

// words that start or end a pair without naming anything ("own words", "every visit")
const NOT_IN_PAIR = new Set(
  'the and for with that this your you our are was from into have has its their they them than what when which who will every each all any one two own more most less new now just also only before after first last next very same other such into onto over under about without within mid-size'.split(
    ' ',
  ),
)
/**
 * Two-word names they use more than once ("dock appointment", "store credit", "intake note"),
 * in the plural when they ever say it that way. Repetition is what makes it their name for it.
 */
function pairsSaidTwice(kit: Kit): string[] {
  const text = aboutText(kit).toLowerCase()
  const seen = new Map<string, { n: number; plural: boolean; at: number }>()
  for (const line of text.split(/[\n.,;:!?()"“”]+/)) {
    const ws = line.split(/\s+/).filter(Boolean)
    for (let i = 0; i + 1 < ws.length; i++) {
      const [a, b] = [ws[i]!, ws[i + 1]!]
      if (!/^[a-z][a-z-]{2,}$/.test(a) || !/^[a-z][a-z-]{2,}$/.test(b)) continue
      if (NOT_IN_PAIR.has(a) || NOT_IN_PAIR.has(b) || /'s$/.test(a)) continue
      // "shippers live", "turns returns": a person or a verb first isn't a name
      if (PEOPLE.test(a) || NOT_A_THING.has(a) || /(ly|ing|ed)$/.test(a)) continue
      if (!isThing(b)) continue
      const key = `${a} ${b.replace(/(?<=[^s])s$/, '')}`
      const got = seen.get(key) ?? { n: 0, plural: false, at: seen.size }
      got.n++
      got.plural ||= /[^s]s$/.test(b)
      seen.set(key, got)
    }
  }
  const raw = aboutText(kit)
  return (
    [...seen.entries()]
      .filter(([, v]) => v.n >= 2)
      .sort((x, y) => y[1].n - x[1].n || x[1].at - y[1].at)
      // a countable thing said once in the singular reads as the whole kind of it ("intake notes")
      .map(([k, v]) => (v.plural || COUNTABLE.test(k.split(' ')[1]!) ? `${k}s` : k))
      .map((k) => asWritten(raw, k))
  )
}

/** "shopify brands" as they write it: "Shopify brands" */
function asWritten(text: string, phrase: string): string {
  return phrase
    .split(' ')
    .map((w) => {
      const m = text.match(new RegExp(`\\b(${w.replace(/[^a-z-]/g, '')})\\b`, 'i'))
      return m && /^[A-Z]/.test(m[1]!) && !/^[A-Z][a-z]+$/.test(m[1]!) ? m[1]! : keepName(text, w)
    })
    .join(' ')
}
/** a word they always capitalize mid-sentence is a name ("Shopify"); otherwise lower case */
function keepName(text: string, w: string): string {
  const all = [...text.matchAll(new RegExp(`(^|[^.!?\\n]\\s)(${w})\\b`, 'gi'))].map((m) => m[2]!)
  return all.length && all.every((x) => /^[A-Z]/.test(x)) ? all[0]! : w
}

const COUNTABLE =
  /^(note|room|link|form|view|feed|alert|check|rate|label|report|card|page|ticket|chart|record|lane|load|pallet|order|summary|appointment)$/
/** product nouns that say what a thing is without a telling ending */
const NOUNS =
  /^(note|room|credit|link|form|view|feed|alert|check|rate|label|report|score|queue|card|page|map|lane|load|pallet|order|ticket|chart|record|visit|timeline|dashboard|summary|inbox|workflow|portal)s?$/
/** Is this word a thing: a product noun, a telling ending, or a plural that isn't a verb */
const isThing = (w: string) =>
  NOUNS.test(w) ||
  /(ment|ments|tion|tions|sion|sions|ance|ence|ity|ities|ure|ures|ing|ings)$/.test(w) ||
  (/[^s]s$/.test(w) && !NOT_A_THING.has(w) && !/(ly)s?$/.test(w))

/**
 * A headline that opens on one plain noun ("Every pallet, visible…") names it, when the rest of
 * their text says it again: "pallets", in the plural an idea can use.
 */
function saidTwice(kit: Kit): string | null {
  const head = kit.headline
    .trim()
    .split(/[,.!:]/)[0]!
    .replace(DETERMINERS, '')
    .trim()
  if (!/^[a-z]{4,}$/i.test(head) || IMPERATIVE.has(head.toLowerCase())) return null
  const w = head.toLowerCase()
  const n = (
    aboutText(kit)
      .toLowerCase()
      .match(new RegExp(`\\b${w}s?\\b`, 'g')) ?? []
  ).length
  return n >= 2 ? (w.endsWith('s') ? w : `${w}s`) : null
}

/** the plural noun a stat is about, when the homepage says it too ("61% of returns…" -> "returns") */
function pluralTopic(f: Fact, kit: Kit): string | null {
  const about = ` ${`${kit.headline} ${kit.description}`.toLowerCase().replace(/[^a-z\s-]/g, ' ')} `
  for (const w of f.text.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? [])
    if (/[^s]s$/.test(w) && !NOT_A_THING.has(w) && about.includes(` ${w} `)) return w
  return null
}
const NOT_A_THING = new Set(
  'turns gives makes helps runs uses keeps saves lets brings builds works sends offers means does goes takes always others teams results thanks years hours minutes days weeks months times ways things words'.split(
    ' ',
  ),
)

/* ------------------------------------------------------------ the ideas */

interface Kind {
  /** what in the sender's work says this is the kind of thing they'd do */
  work: RegExp
  /** their things this idea suits best */
  suits: RegExp
  /** the idea, said a second way for when this kind comes up twice */
  idea: (thing: string, again?: boolean) => string
  /** whether the idea reads right about people ("a live dashboard for shippers") */
  people?: boolean
}

/** their things that are people, which only some ideas suit */
const PEOPLE =
  /(^|\s)(shippers|brands|clinics|patients|customers|teams|merchants|shoppers|users|clinicians|carriers|drivers|founders|developers|engineers|agencies|stores|practices)$/i

/** The kinds of idea, by what the sender's own work shows they can do */
const KINDS: Kind[] = [
  {
    work: /\b(migrat\w*|moved?|records?|databases?|oracle|postgres\w*)\b/i,
    suits: /record|data|chart|history|ehr|ledger|account/i,
    idea: (t, again) => (again ? `move ${t} onto one clean record` : `unify the data behind ${t}`),
  },
  {
    work: /\b(etl|pipelines?|sync\w*|stream\w*|ingest\w*|feeds?|middleware|payloads?|apis?|integrat\w*)\b/i,
    suits: /timeline|check-in|track|feed|visib|pallet|load|data|lane|intake|form/i,
    idea: (t, again) =>
      again ? `sync ${t} with the tools customers use` : `stream ${t} into one live view`,
  },
  {
    work: /\b(agents?|llms?|ai|gpt|models?|chatbots?|nlp)\b/i,
    suits: /alert|exception|intake|question|support|fraud|message|form/i,
    idea: (t, again) => (again ? `let an agent triage ${t}` : `put an agent on ${t}`),
  },
  {
    work: /\b(analytics|dashboards?|reports?|reporting|insights?|metrics?|forecast\w*)\b/i,
    suits: /dashboard|return|exchange|shipper|clinic|stat|credit|order/i,
    idea: (t, again) =>
      again ? `show ${t} trends week by week` : `build a live dashboard for ${t}`,
    people: true,
  },
  {
    work: /\b(test\w*|chaos|evals?|validat\w*|qa|monitor\w*|refunds?|errors?)\b/i,
    suits: /check|fraud|exception|refund|alert|return/i,
    idea: (t, again) =>
      again ? `catch ${t} errors before they ship` : `stress-test ${t} before customers notice`,
  },
  {
    work: /\b(deploy\w*|docker|aws|kubernetes|infra\w*|downtime|container\w*|cloud)\b/i,
    suits: /schedul|timeline|form|intake|drop-off/i,
    idea: (t, again) =>
      again
        ? `roll out ${t} changes one customer at a time`
        : `ship ${t} changes with zero downtime`,
  },
  {
    work: /\b(rbac|access|identit\w*|permissions?|auth\w*|security|compliance)\b/i,
    suits: /hipaa|security|data|record|account/i,
    idea: (t, again) => (again ? `log every change to ${t}` : `tighten who can change ${t}`),
  },
]
const ANY: Kind = { work: /./, suits: /./, idea: (t) => `prototype the next step for ${t}` }

/**
 * The kind of idea a line of work suggests: the one the thing it made names ("containerized
 * ETL" is an ETL), else the earliest telling word in the rest of the line.
 */
function kindOf(work: string, made?: string): Kind {
  const head = made?.trim().split(/\s+/).at(-1) ?? ''
  const byHead = head ? KINDS.find((k) => k.work.test(head)) : undefined
  if (byHead) return byHead
  // the opening verb ("Deployed …") is what they did, not what it was about
  const rest = work.replace(/^\s*\S+\s+/, ' ')
  let best: { k: Kind; at: number } | null = null
  for (const k of KINDS) {
    const m = rest.match(k.work)
    if (m && (best === null || m.index! < best.at)) best = { k, at: m.index! }
  }
  return best?.k ?? ANY
}

const PREPOSITION =
  /\s(?:with|for|at|on|to|into|across|in|using|via|from|by|that|which|and|syncing|unifying|migrating)\s/i

/** "Built containerized ETL with Docker" -> "like the containerized ETL I built" */
export function likeOf(did: string, max = 3): string | null {
  const t = did.trim().replace(/[.;]$/, '')
  const [verb, ...rest] = t.split(/\s+/)
  if (!verb || !rest.length) return null
  const past = verb.toLowerCase()
  if (
    !/ed$|^(built|rebuilt|led|ran|wrote|made|set|cut|grew|shipped|won|drove|taught|sold)$/.test(
      past,
    )
  )
    return null
  const object = rest.join(' ').split(PREPOSITION)[0]!.trim().replace(DETERMINERS, '')
  const ws = object.split(/\s+/).filter(Boolean)
  if (!ws.length) return null
  // the last few words are the thing itself ("automated Python migration pipeline" -> "Python migration pipeline")
  const thing = ws.slice(-max).join(' ')
  return `like the ${thing} I ${past}`
}

const CREDENTIAL = /\b(certif\w*|credential|degree|diploma|exam|course|licen[cs]e)\b/i

/** a line that says one of its words twice */
const twice = (line: string) => {
  const ws = line.toLowerCase().match(/[a-z]{3,}/g) ?? []
  return new Set(ws).size < ws.length
}

/** "coldopen" -> "like coldopen, which I built" */
const likeProject = (name: string) => `like ${name.trim()}, which I built`

export interface Idea {
  line: string
  /** which proof it rests on, or the project's name */
  from: { proof: number } | { project: string }
}

/** How many lines of the sender's own work an idea can rest on: proof with `did`, and projects */
export const ideaSources = (profile: Pick<Profile, 'proof' | 'projects'>) =>
  profile.proof.filter((p) => p.did?.trim()).length + (profile.projects?.length ?? 0)

/**
 * Two or three ideas for their product, each resting on one thing the sender did: the most
 * relevant proof first, one idea per kind of work, each on a different one of their things.
 * Returns fewer than two when the profile has nothing an idea could rest on.
 */
export function ideasFor(
  kit: Kit,
  profile: Pick<Profile, 'proof' | 'projects'>,
  order: number[] = rankProof(profile.proof, aboutText(kit)),
): Idea[] {
  const things = theirThings(kit)
  if (!things.length) return []
  const max = LIMITS.idea
  const used = new Set<string>()
  const kinds = new Set<Kind>()
  const out: Idea[] = []
  const sources: { work: string; made?: string | undefined; like: string[]; from: Idea['from'] }[] =
    [
      ...order
        .map((i) => ({ p: profile.proof[i]!, i }))
        // a certificate or a degree is something they earned, not something they built
        .filter(({ p }) => p.did?.trim() && !CREDENTIAL.test(`${p.did} ${p.label}`))
        .map(({ p, i }) => {
          const like = [likeOf(p.did!), likeOf(p.did!, 2), likeOf(p.did!, 1)].filter(
            (x): x is string => !!x,
          )
          return {
            work: `${p.did} ${p.label}`,
            made: like[0]?.replace(/^like the (.+) I \S+$/, '$1'),
            like,
            from: { proof: i } as Idea['from'],
          }
        })
        .filter((s) => s.like.length),
      ...(profile.projects ?? []).map((p) => ({
        work: `${p.name} ${p.line}`,
        like: [likeProject(p.name)],
        from: { project: p.name } as Idea['from'],
      })),
    ]
  // one idea per kind of work first, then the rest
  const passes = [true, false]
  for (const distinct of passes)
    for (const s of sources) {
      if (out.length >= 3) break
      if (out.some((o) => JSON.stringify(o.from) === JSON.stringify(s.from))) continue
      const k = kindOf(s.work, s.made)
      // the first pass is one idea per kind, and only ideas a kind of work suggests
      if (distinct && (kinds.has(k) || k === ANY)) continue
      const fits = things.filter((t) => k.people || !PEOPLE.test(t))
      if (!fits.length) continue
      const free = fits.filter((t) => !used.has(t))
      const pool = free.length ? free : fits
      // "stream live visibility into one live view" says "live" twice
      const again = kinds.has(k)
      const reads = (t: string) => !twice(k.idea(t, again))
      const thing = pool.find((t) => k.suits.test(t) && reads(t)) ?? pool.find(reads) ?? pool[0]!
      const line = s.like
        .map((like) => `I'd ${k.idea(thing, again)} — ${like}`)
        .find((l) => words(l) <= max)
      if (!line) continue
      used.add(thing)
      kinds.add(k)
      out.push({ line, from: s.from })
    }
  return out
}

/** "I'd stream carrier check-ins into one live view — like …" -> "stream carrier check-ins into one live view" */
export function ideaOf(point: string): string | null {
  const m = point.trim().match(/^I(?:'d|’d| would)\s+(.+?)\s*(?:[—–-]|,)\s*like\b/i)
  return m ? m[1]!.trim() : null
}

/* ------------------------------------------------------------ the check */

const STOP = new Set(
  "the and for with that this your you our are was from into have has its their they them than what when which who will just about over more most only also like i'd would one every each all any data live view next step new zero downtime changes before customers notice agent dashboard build stream unify put ship stress-test tighten prototype behind can change".split(
    ' ',
  ),
)
const stemOf = (w: string) => w.replace(/'s$/, '').replace(/(?<=[a-z]{3})(es|s)$/, '')
const contentOf = (s: string) =>
  new Set(
    (s.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? [])
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stemOf),
  )
const shareOf = (line: string, source: string) => {
  const a = contentOf(line)
  if (!a.size) return 0
  const b = contentOf(source)
  let n = 0
  for (const w of a) if (b.has(w)) n++
  return n / a.size
}

/**
 * Why a job seeker's pitch point isn't an idea for their product, or null when it is: "I'd
 * <verb> <their thing> — like <what I did>". The idea names something of theirs (a word from
 * their site), the "like …" rests on one thing the sender did (a proof's `did` or a project),
 * and a profile point copied over is not an idea (pitch_is_idea).
 */
export function notAnIdea(
  point: string,
  kit: Kit,
  profile: Pick<Profile, 'points' | 'proof' | 'projects'>,
): string | null {
  const copied = profile.points.find((p) => shareOf(point, p) >= 0.6 && shareOf(p, point) >= 0.6)
  if (copied)
    return `is your profile point "${copied}" copied over; write an idea for their product instead: "I'd <verb> <their thing> — like <what you did>"`
  const idea = ideaOf(point)
  if (!idea)
    return `isn't an idea for their product; write it as "I'd <verb> <their thing> — like <what you did>"`
  const theirs = aboutText(kit)
  const named = [...contentOf(idea)].some((w) => contentOf(theirs).has(w))
  if (!named)
    return `"${idea}" doesn't name anything of theirs; use a feature or word from their site (${theirThings(
      kit,
    )
      .slice(0, 4)
      .join(', ')})`
  const like = point.slice(point.search(/\blike\b/i))
  const own = [
    ...profile.proof.map((p) => `${p.did ?? ''} ${p.label} ${p.where ?? ''}`),
    ...(profile.projects ?? []).map((p) => `${p.name} ${p.line}`),
  ]
  if (!own.some((o) => shareOf(like, o) >= 0.5))
    return `"${like}" isn't something you did; take it from one proof's "did" or a project`
  return null
}

/** Whether a job seeker's pitch must be ideas: it can be, from what their site and the profile give */
export const pitchAsIdeas = (kit: Kit, profile: Pick<Profile, 'proof' | 'projects'>) =>
  ideasFor(kit, profile).length >= 2
