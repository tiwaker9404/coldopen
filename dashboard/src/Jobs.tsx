import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ago,
  api,
  type Film,
  type JobSearch,
  type JobSuggestion,
  type JobSuggestions,
  type Me,
  send,
} from './api.ts'

const SHOWN = 6

const FIT_LABEL = { strong: 'Strong fit', good: 'Good fit', stretch: 'Stretch' } as const

const list = (s: string) =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean)

/**
 * Open roles from the public job boards of companies that hire for what they want, each one
 * click away from a film. The roles come from their profile until they set their own.
 */
export function Jobs({ onMade }: { onMade: (id: string) => void }) {
  const q = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api<JobSuggestions>('/v1/jobs/suggested?limit=24'),
    staleTime: 10 * 60_000,
  })
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/v1/me') })
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [all, setAll] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [started, setStarted] = useState<number | null>(null)
  const r = q.data
  const noRoles = !!r && r.search.roles.length === 0
  // a visitor makes one film at a time; an account several, up to what's left today
  const visitor = !!me.data?.hosted && !me.data.user
  const left = me.data?.films ? Math.max(0, me.data.films.limit - me.data.films.used) : null
  const max = visitor ? 1 : Math.min(25, left ?? 25)
  const chosen = (r?.data ?? []).filter((j) => picked.includes(j.id))
  const toggle = (id: string) => {
    setStarted(null)
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }
  const makeMany = useMutation({
    mutationFn: () =>
      send<{ batch: string; films: number }>('POST', '/v1/batches', {
        jobs: chosen.map((j) => ({ url: j.url, ...(j.site ? { site: j.site } : {}) })),
      }),
    onSuccess: (b) => {
      setPicked([])
      setStarted(b.films)
      void qc.invalidateQueries({ queryKey: ['films'] })
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['jobs'] })
    },
  })

  return (
    <section className="jobs" aria-labelledby="jobs-title">
      <div className="films-head">
        <h2 id="jobs-title">Jobs for you</h2>
        {r && !noRoles && (
          <button
            type="button"
            className="link"
            onClick={() => setEditing((e) => !e)}
            aria-expanded={editing}
          >
            {editing ? 'Close' : 'Edit search'}
          </button>
        )}
      </div>

      {q.isPending ? (
        <p className="jobs-note" aria-live="polite">
          Reading open roles from 70 companies’ job boards…
        </p>
      ) : q.isError ? (
        <p className="error">Couldn’t load jobs: {q.error.message}</p>
      ) : noRoles || editing ? (
        <SearchForm search={r!.search} first={noRoles} onDone={() => setEditing(false)} />
      ) : null}

      {r && !noRoles && (
        <>
          <p className="jobs-note">
            {r.search.roles.join(', ')}
            {r.search.locations.length > 0 && ` in ${r.search.locations.join(', ')}`}
            {r.search.remote &&
              (r.search.locations.length ? ', or remote' : ', anywhere or remote')}
            {' · '}
            {r.companies} companies
            {r.updatedAt && `, checked ${ago(r.updatedAt)}`}
            {r.failed.length > 0 && ` · couldn’t read ${r.failed.join(', ')}`}
          </p>
          {r.data.length === 0 ? (
            <p className="jobs-empty">
              No open roles fit right now. Try another title for the same job (“Solutions Engineer”,
              “Implementation Engineer”), more places, or add a company’s careers board.
            </p>
          ) : (
            <>
              {!visitor && (
                <div className="job-bar" aria-live="polite">
                  {chosen.length > 0 ? (
                    <>
                      <span>
                        {chosen.length} selected
                        {chosen.length > max && ` · ${max} left today`}
                      </span>
                      <span className="job-bar-do">
                        <button type="button" className="link" onClick={() => setPicked([])}>
                          Clear
                        </button>
                        <button
                          type="button"
                          className="primary"
                          disabled={makeMany.isPending || chosen.length > max}
                          onClick={() => makeMany.mutate()}
                        >
                          {makeMany.isPending
                            ? 'Starting…'
                            : `Make ${chosen.length} film${chosen.length === 1 ? '' : 's'}`}
                        </button>
                      </span>
                    </>
                  ) : started ? (
                    <span>
                      Making {started} film{started === 1 ? '' : 's'}. They appear in Your films
                      below as they finish, about a minute and a half each.
                    </span>
                  ) : (
                    <span className="quiet">Tick several jobs to make their films in one go.</span>
                  )}
                </div>
              )}
              {makeMany.error && <p className="error">{makeMany.error.message}</p>}
              <ul className="job-list">
                {(all ? r.data : r.data.slice(0, SHOWN)).map((j) => (
                  <li key={j.id}>
                    <JobRow
                      job={j}
                      onMade={onMade}
                      {...(visitor
                        ? {}
                        : { picked: picked.includes(j.id), onPick: () => toggle(j.id) })}
                    />
                  </li>
                ))}
              </ul>
              {r.data.length > SHOWN && (
                <button type="button" className="link more-jobs" onClick={() => setAll((a) => !a)}>
                  {all ? 'Show fewer' : `Show ${r.data.length - SHOWN} more`}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

function JobRow({
  job,
  onMade,
  picked,
  onPick,
}: {
  job: JobSuggestion
  onMade: (id: string) => void
  /** ticked for making several films at once (accounts only) */
  picked?: boolean
  onPick?: () => void
}) {
  const qc = useQueryClient()
  const make = useMutation({
    mutationFn: () =>
      send<Film>('POST', '/v1/films', {
        // the company's own site when we know it; otherwise the job link, which names it
        url: job.site ?? job.url,
        job: { url: job.url },
      }),
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: ['films'] })
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['jobs'] })
      onMade(f.id)
    },
  })
  const hide = useMutation({
    mutationFn: () => send('POST', `/v1/jobs/${encodeURIComponent(job.id)}/hide`),
    onMutate: () => {
      qc.setQueryData<JobSuggestions>(['jobs'], (d) =>
        d ? { ...d, data: d.data.filter((x) => x.id !== job.id) } : d,
      )
    },
  })
  const why = job.why.slice(1)
  return (
    <div className={`job${onPick ? ' pickable' : ''}${picked ? ' picked' : ''}`}>
      {onPick &&
        (job.filmId ? (
          <span className="job-pick" aria-hidden="true" />
        ) : (
          <input
            type="checkbox"
            className="job-pick"
            checked={!!picked}
            onChange={onPick}
            aria-label={`Select ${job.title} at ${job.company}`}
          />
        ))}
      <div className="job-what">
        <b>{job.company}</b>
        <a href={job.url} target="_blank" rel="noreferrer">
          {job.title}
        </a>
        <span className="job-why">
          {job.fit && (
            <span
              className={`tag fit ${job.fit.level}`}
              title={`Your profile answers ${job.fit.answered} of the ${job.fit.of} requirements this post lists`}
            >
              {FIT_LABEL[job.fit.level]} · {job.fit.answered} of {job.fit.of}
            </span>
          )}
          {why.map((w) => (
            <span key={w} className={w === 'New this week' ? 'tag new' : 'tag'}>
              {w}
            </span>
          ))}
          {job.posted && !why.includes('New this week') && (
            <span className="tag quiet">Posted {ago(job.posted)}</span>
          )}
        </span>
        {job.fit?.best && (
          <span className="job-match">
            <span>They ask: “{job.fit.best.requirement}”</span>
            <span>You have: {job.fit.best.with}</span>
          </span>
        )}
        {make.error && <span className="error">{make.error.message}</span>}
      </div>
      <div className="job-do">
        {job.filmId ? (
          <button type="button" onClick={() => onMade(job.filmId!)}>
            Open film
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={make.isPending}
            onClick={() => make.mutate()}
          >
            {make.isPending ? 'Starting…' : 'Make film'}
          </button>
        )}
        <button
          type="button"
          className="link quiet"
          onClick={() => hide.mutate()}
          aria-label={`Not for me: ${job.title} at ${job.company}`}
        >
          Not for me
        </button>
      </div>
    </div>
  )
}

function SearchForm({
  search,
  first,
  onDone,
}: {
  search: JobSearch
  first: boolean
  onDone: () => void
}) {
  const qc = useQueryClient()
  const [roles, setRoles] = useState(search.roles.join(', '))
  const [places, setPlaces] = useState(search.locations.join(', '))
  const [remote, setRemote] = useState(search.remote)
  const [skipSenior, setSkipSenior] = useState(search.skipSenior)
  const [boards, setBoards] = useState(
    search.boards
      .map((b) =>
        b.ats === 'greenhouse'
          ? `job-boards.greenhouse.io/${b.token}`
          : b.ats === 'lever'
            ? `jobs.lever.co/${b.token}`
            : `jobs.ashbyhq.com/${b.token}`,
      )
      .join('\n'),
  )
  const save = useMutation({
    mutationFn: () => {
      const r = list(roles)
      if (r.length === 0) throw new Error('Add at least one role, like Solutions Engineer')
      return send<JobSearch>('PUT', '/v1/jobs/search', {
        roles: r.slice(0, 8),
        locations: list(places).slice(0, 8),
        remote,
        skipSenior,
        boards: list(boards),
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['jobs'] })
      onDone()
    },
  })
  return (
    <form
      className="job-search"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      {first && (
        <p className="jobs-note">
          Tell coldopen what you’re looking for, and it finds open roles at 70 companies you can
          make a film for in one click.
        </p>
      )}
      <label>
        <span>Roles</span>
        <input
          value={roles}
          onChange={(e) => setRoles(e.target.value)}
          placeholder="Forward Deployed Engineer, Solutions Engineer"
        />
      </label>
      <label>
        <span>Places</span>
        <input
          value={places}
          onChange={(e) => setPlaces(e.target.value)}
          placeholder="Bay Area, New York (empty for anywhere)"
        />
      </label>
      <div className="job-checks">
        <label className="check">
          <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} />
          Remote roles too
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={skipSenior}
            onChange={(e) => setSkipSenior(e.target.checked)}
          />
          Skip staff, principal and manager roles
        </label>
      </div>
      <label>
        <span>More companies</span>
        <textarea
          rows={2}
          value={boards}
          onChange={(e) => setBoards(e.target.value)}
          placeholder="Any Greenhouse, Lever or Ashby careers link, one per line"
        />
      </label>
      {save.error && <p className="error">{save.error.message}</p>}
      <div className="job-search-do">
        <button type="submit" className="primary" disabled={save.isPending}>
          {save.isPending ? 'Finding jobs…' : first ? 'Find jobs' : 'Save'}
        </button>
      </div>
    </form>
  )
}
