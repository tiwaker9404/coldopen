import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type Me } from './api.ts'
import { fetchRepos, type Repo } from './github.ts'
import { ErrorNote } from './ui.tsx'

/**
 * Pick projects straight from GitHub: your public repositories (not forks or archived ones),
 * most starred and most recently worked on first, each with its own description. The browser
 * asks GitHub directly, so it counts against your own rate limit, not the app's.
 */

export function GitHubRepos({
  taken,
  room,
  onAdd,
}: {
  /** links already in the profile */
  taken: string[]
  /** how many more projects fit */
  room: number
  onAdd: (repos: Repo[]) => void
}) {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/v1/me') })
  // a GitHub sign-in's login is the username; a Google sign-in's is an email
  const login = me.data?.user?.login
  const [user, setUser] = useState(login && !login.includes('@') ? login : '')
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const repos = useQuery({
    queryKey: ['github-repos', user.trim().toLowerCase()],
    queryFn: () => fetchRepos(user.trim()),
    enabled: open && user.trim().length > 0,
    staleTime: 10 * 60_000,
    retry: false,
  })
  const list = (repos.data ?? []).filter((r) => !taken.includes(r.url))

  if (!open)
    return (
      <button type="button" className="link" onClick={() => setOpen(true)}>
        Pick from your GitHub
      </button>
    )
  return (
    <div className="gh-repos">
      <label>
        GitHub username
        <input
          value={user}
          onChange={(e) => {
            setUser(e.target.value)
            setPicked([])
          }}
          placeholder="your-username"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {repos.isLoading && user.trim() && <p className="small muted">Reading your repositories…</p>}
      <ErrorNote error={repos.error} />
      {repos.data && list.length === 0 && (
        <p className="small muted">No public repositories left to add.</p>
      )}
      {list.length > 0 && (
        <>
          <p className="small muted">
            Pick up to {room}. Repositories without a description need one line from you after.
          </p>
          <ul className="gh-list">
            {list.slice(0, 30).map((r) => {
              const on = picked.includes(r.url)
              return (
                <li key={r.url}>
                  <label>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && picked.length >= room}
                      onChange={() =>
                        setPicked(on ? picked.filter((u) => u !== r.url) : [...picked, r.url])
                      }
                    />
                    <span>
                      <b>
                        {r.name}
                        {r.stars > 0 && <small> · {r.stars}★</small>}
                      </b>
                      <small>{r.line || 'No description on GitHub yet'}</small>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="actions">
            <button
              type="button"
              disabled={picked.length === 0}
              onClick={() => {
                onAdd(list.filter((r) => picked.includes(r.url)))
                setPicked([])
                setOpen(false)
              }}
            >
              Add {picked.length || ''} {picked.length === 1 ? 'project' : 'projects'}
            </button>
            <button type="button" className="link" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}
