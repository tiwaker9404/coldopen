import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type Me } from './api.ts'
import { fetchRepos, MAX_PROJECTS, type Project, toggleRepo } from './github.ts'
import { ErrorNote } from './ui.tsx'

/**
 * Pick projects straight from GitHub: your public repositories (not forks or archived ones),
 * most starred and most recently worked on first, each with its own description. The browser
 * asks GitHub directly, so it counts against your own rate limit, not the app's.
 *
 * It's a checklist over the profile's own projects: a tick adds the repository, an untick
 * removes it, and the profile's one Save keeps whatever is ticked. It lives inside the profile
 * form, so Enter in the username looks the repositories up and never submits the profile.
 */

export function GitHubRepos({
  projects,
  onChange,
}: {
  projects: Project[]
  onChange: (projects: Project[]) => void
}) {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/v1/me') })
  // a GitHub sign-in's login is the username; a Google sign-in's is an email
  const login = me.data?.user?.login
  const known = login && !login.includes('@') ? login : ''
  const [open, setOpen] = useState(false)
  const [user, setUser] = useState(known)
  // the username we last looked up: typing alone doesn't ask GitHub on every key
  const [looked, setLooked] = useState('')
  const lookup = looked || (open ? known : '')
  const repos = useQuery({
    queryKey: ['github-repos', lookup.toLowerCase()],
    queryFn: () => fetchRepos(lookup),
    enabled: open && lookup.length > 0,
    staleTime: 10 * 60_000,
    retry: false,
  })
  const list = repos.data ?? []
  const filled = projects.filter((p) => p.name.trim() || p.url.trim() || p.line.trim()).length
  const full = filled >= MAX_PROJECTS
  const find = () => setLooked(user.trim())

  if (!open)
    return (
      <button type="button" className="link" onClick={() => setOpen(true)}>
        Pick from your GitHub
      </button>
    )
  return (
    <div className="gh-repos">
      <div className="gh-find">
        <label>
          GitHub username
          <input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              // inside the profile form, Enter would save the whole profile
              e.preventDefault()
              find()
            }}
            placeholder="your-username"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button type="button" onClick={find} disabled={!user.trim()}>
          Show repositories
        </button>
      </div>
      {repos.isLoading && lookup && <p className="small muted">Reading your repositories…</p>}
      <ErrorNote error={repos.error} />
      {repos.data && list.length === 0 && (
        <p className="small muted">No public repositories to pick from.</p>
      )}
      {list.length > 0 && (
        <>
          <p className="small muted">
            Ticked ones go straight into your projects and save with your profile.
            {full ? ` That's ${MAX_PROJECTS}, the most a profile holds.` : ''}
          </p>
          <ul className="gh-list">
            {list.slice(0, 30).map((r) => {
              const on = projects.some((p) => p.url === r.url)
              return (
                <li key={r.url}>
                  <label>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && full}
                      onChange={() => onChange(toggleRepo(projects, r, !on))}
                    />
                    <span>
                      <b>
                        {r.name}
                        {r.stars > 0 && <small> · {r.stars}★</small>}
                      </b>
                      <small>
                        {r.line ||
                          (on
                            ? 'No description on GitHub. Add one line in its row above.'
                            : 'No description on GitHub yet')}
                      </small>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
