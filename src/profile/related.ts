import { terms } from '../job/fit.ts'
import type { Profile } from '../script/types.ts'

export type Project = NonNullable<Profile['projects']>[number]

/**
 * Related work: of the sender's own projects, the one closest to what this company does and
 * what the role asks, or none when nothing is close. Counted on shared words (the same stems
 * Fit check uses), so the pick is explainable and nothing is claimed that isn't in the project.
 */
export function relatedWork(
  profile: Pick<Profile, 'projects'>,
  kit: {
    name: string
    headline?: string
    description?: string
    facts: { text: string; kind: string }[]
    job?: { title: string }
  },
): (Project & { shared: string[] }) | null {
  const projects = profile.projects ?? []
  if (!projects.length) return null
  const corpus = terms(
    [
      kit.headline ?? '',
      kit.description ?? '',
      kit.job?.title ?? '',
      ...kit.facts.map((f) => f.text),
    ].join(' '),
  )
  // their own name is everywhere on their site and says nothing about fit
  for (const w of terms(kit.name)) corpus.delete(w)
  let best: (Project & { shared: string[] }) | null = null
  let bestScore = 0
  for (const p of projects) {
    const own = terms(`${p.name} ${p.line}`)
    const shared = [...own].filter((w) => corpus.has(w))
    // two shared ideas, not one common word, before a project counts as close
    if (shared.length < 2) continue
    const score = shared.length / Math.max(3, own.size)
    if (score > bestScore) {
      best = { ...p, shared }
      bestScore = score
    }
  }
  return best
}
