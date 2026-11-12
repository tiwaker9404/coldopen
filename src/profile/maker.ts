/**
 * Only coldopen's maker can say he built it. A profile's creator line ("Made with coldopen,
 * which I built") and its projects show up on films, share pages and messages, so on the hosted
 * app a claim to coldopen is kept only for the accounts that run it (UNLIMITED_GITHUB_USERS).
 * Anyone can still name something they built themselves.
 */
import type { Profile } from '../script/types.ts'

/** coldopen by name, or a link to its repo, site or hosted app */
const COLDOPEN =
  /\bcold\s*open\b|tiwaker9404\/coldopen|tiwaker9404\.github\.io\/coldopen|coldopen-nk8o\.onrender\.com/i

/** true when the text names coldopen or links to it */
export const claimsColdopen = (...text: (string | undefined)[]) =>
  text.some((t) => !!t && COLDOPEN.test(t))

export const NOT_THE_MAKER =
  'Only the person who built coldopen can say so on a film. Name something you built instead.'

/** which fields of a profile claim coldopen, by path, for the editor to point at */
export function makerClaims(p: Pick<Profile, 'creator' | 'projects'>): string[] {
  const paths: string[] = []
  if (p.creator && claimsColdopen(p.creator.name, p.creator.url, p.creator.line))
    paths.push('creator.name')
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
