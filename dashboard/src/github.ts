/** Your public GitHub repositories, for the profile's projects (see GitHubRepos.tsx). */

export interface Repo {
  name: string
  url: string
  line: string
  stars: number
  pushed: string
}

interface GhRepo {
  name: string
  html_url: string
  homepage: string | null
  description: string | null
  fork: boolean
  archived: boolean
  stargazers_count: number
  pushed_at: string
}

/** A project as the profile keeps it */
export interface Project {
  name: string
  url: string
  line: string
}

/** most projects a profile holds (ProfileSchema allows 8) */
export const MAX_PROJECTS = 8

const blank = (p: Project) => !p.name.trim() && !p.url.trim() && !p.line.trim()

/**
 * Ticking a repository puts it straight into the profile's projects, and unticking takes it
 * out, so there's nothing to "add" and nothing to lose when the profile is saved. A blank row
 * someone started and left empty makes room. A repository with no description comes in with
 * an empty line for the person to fill (see needsLine).
 */
export function toggleRepo(
  projects: Project[],
  repo: Pick<Repo, 'name' | 'url' | 'line'>,
  on: boolean,
  max = MAX_PROJECTS,
): Project[] {
  if (!on) return projects.filter((p) => p.url !== repo.url)
  if (projects.some((p) => p.url === repo.url)) return projects
  const kept = projects.filter((p) => !blank(p))
  if (kept.length >= max) return projects
  return [...kept, { name: repo.name, url: repo.url, line: repo.line }]
}

/** a project with a link but no line yet: the editor highlights the field instead of erroring */
export const needsLine = (p: Project) => !!p.url.trim() && !p.line.trim()

export async function fetchRepos(user: string, get: typeof fetch = fetch): Promise<Repo[]> {
  const res = await get(
    `https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=pushed`,
    { headers: { accept: 'application/vnd.github+json' } },
  )
  if (res.status === 404) throw new Error(`No GitHub user called ${user}`)
  if (res.status === 403 || res.status === 429)
    throw new Error('GitHub is rate limiting this network; try again in a few minutes')
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  const repos = (await res.json()) as GhRepo[]
  return repos
    .filter((r) => !r.fork && !r.archived)
    .map((r) => ({
      name: r.name.slice(0, 60),
      // the project's own site when it has one, else the repository
      url: r.homepage?.startsWith('https://') ? r.homepage : r.html_url,
      line: (r.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
      stars: r.stargazers_count,
      pushed: r.pushed_at,
    }))
    .sort((a, b) => b.stars - a.stars || b.pushed.localeCompare(a.pushed))
}
