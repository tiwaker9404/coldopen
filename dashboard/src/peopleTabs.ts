/**
 * The film panel's "Pick one or two people" tabs: one per group, in the order the API sends
 * them (who's most likely to reply at a company this size goes first), opening on the first.
 * Pure, so the order and the fallback are tested without a browser.
 */
import type { People, PeopleGroup, PeopleGroupId } from './api.ts'

/**
 * The groups to show. An answer recorded before groups existed (the demo, an old server) has
 * only the flat list, so it shows as one group rather than nothing.
 */
export function peopleGroups(p: Pick<People, 'groups' | 'searches' | 'known'>): PeopleGroup[] {
  if (p.groups?.length) return p.groups
  if (!p.searches.length && !p.known.length) return []
  return [
    {
      id: 'recruiting',
      label: 'People to find',
      why: 'Pick one person, not a whole team: one message to the right person beats five.',
      ask: 'A short note, the film, and the one area you’re interested in.',
      searches: p.searches,
      ...(p.known.length ? { known: p.known } : {}),
    },
  ]
}

/** Which tab is open: the one picked, while it still exists, else the first. */
export function openGroup(
  groups: PeopleGroup[],
  picked: PeopleGroupId | null,
): PeopleGroupId | null {
  return groups.find((g) => g.id === picked)?.id ?? groups[0]?.id ?? null
}
