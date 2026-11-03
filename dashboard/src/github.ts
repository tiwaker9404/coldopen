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
