/**
 * Only coldopen's maker can say he built it. A profile's creator line ("Made with coldopen,
 * which I built") and its projects show up on films, share pages and messages, so on the hosted
 * app a claim to coldopen is kept only for the accounts that run it (UNLIMITED_GITHUB_USERS).
 * A claim counts by name, by link, or by what it says: "I built the tool that made this film"
 * under any name is still a claim to coldopen. Anyone can still name something they built.
 */
import type { Profile } from '../script/types.ts'

/** coldopen by name, or a link to its repo, site or hosted app */
const COLDOPEN =
  /\bcold\s*open\b|tiwaker9404\/coldopen|tiwaker9404\.github\.io\/coldopen|coldopen-nk8o\.onrender\.com/i

/**
 * a line saying they made this film, or the tool that made it, whatever they call it: on a
 * film or its share page, "this film" can only mean one coldopen made
 */
const MADE_THIS = [
  /\bthe tool that made this (?:film|video|reel)\b/i,
  /\bbuilt (?:this|the) (?:tool|film|app) (?:you(?:'|\u2019)?re watching|that made)\b/i,
  /\bmade with\b.*\bwhich i built\b/i,
]

/** true when the text names coldopen, links to it, or says they made this film's tool */
export const claimsColdopen = (...text: (string | undefined)[]) =>
  text.some((t) => !!t && (COLDOPEN.test(t) || MADE_THIS.some((r) => r.test(t))))

export const NOT_THE_MAKER =
  'Only the person who built coldopen can say so on a film. Name something you built instead.'

/**
 * which fields of a profile claim coldopen, by path, for the editor to point at: the name when
 * the name or link does, otherwise the line that says it
 */
export function makerClaims(p: Pick<Profile, 'creator' | 'projects'>): string[] {
  const paths: string[] = []
  if (p.creator && claimsColdopen(p.creator.name, p.creator.url)) paths.push('creator.name')
  else if (p.creator && claimsColdopen(p.creator.line)) paths.push('creator.line')
  for (const [i, x] of (p.projects ?? []).entries())
    if (claimsColdopen(x.name, x.url)) paths.push(`projects.${i}.name`)
  return paths
}

/**
 * The profile a film is made with: unchanged for the maker; for anyone else, without a creator
 * line or project that claims coldopen (profiles saved before this rule, or sent with a film).
 */
export function forSender<P extends Pick<Profile, 'creator' | 'projects'>>(
  p: P,
  maker: boolean,
): P {
  if (maker || makerClaims(p).length === 0) return p
  const { creator, ...rest } = p
  const projects = p.projects?.filter((x) => !claimsColdopen(x.name, x.url))
  return {
    ...rest,
    ...(creator && !claimsColdopen(creator.name, creator.url, creator.line) ? { creator } : {}),
    ...(p.projects ? { projects } : {}),
  } as P
}
