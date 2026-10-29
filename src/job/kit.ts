import type { BrandKit, Fact } from '../brand/types.ts'
import type { JobPost } from './post.ts'

/**
 * Adds a job post to a company's research: its requirements become facts (j1, j2...) the
 * script can quote, exactly like a line from their homepage, and the role is noted on the kit.
 */
export function withJob(kit: BrandKit, job: JobPost): BrandKit {
  const reqs: Fact[] = job.requirements.map((text, i) => ({
    id: `j${i + 1}`,
    text,
    kind: 'requirement',
  }))
  return {
    ...kit,
    facts: [...kit.facts.filter((f) => f.kind !== 'requirement'), ...reqs],
    job: { title: job.title, ...(job.url ? { url: job.url } : {}) },
  }
}

/** Requirements short enough to put on screen as a quote. */
export const quotableRequirements = (kit: BrandKit) =>
  kit.facts.filter((f) => f.kind === 'requirement' && f.text.length <= 160)
