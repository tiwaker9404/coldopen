import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ago,
  api,
  type Film,
  type FitGap,
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
export function Jobs({
  onMade,
  variant = 'full',
}: {
  onMade: (id: string) => void
  /** full: the Jobs page, search always open; preview: the best three, on Today */
  variant?: 'full' | 'preview'
}) {
  const full = variant === 'full'
  const q = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api<JobSuggestions>('/v1/jobs/suggested?limit=24'),
    staleTime: 10 * 60_000,
  })
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/v1/me') })
  const qc = useQueryClient()
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

  if (!full)
    return (
      <section className="jobs" aria-labelledby="jobs-title">
        <div className="films-head">
          <h2 id="jobs-title">Best fits for you</h2>
          <a className="see-all" href="#jobs">
            {r && r.data.length > 0 ? `All ${r.data.length} jobs` : 'Jobs'}
          </a>
        </div>
        {q.isPending ? (
          <p className="jobs-note" aria-live="polite">
            Reading open roles from hundreds of companies’ job boards…
          </p>
        ) : q.isError ? (
          <p className="error">Couldn’t load jobs: {q.error.message}</p>
        ) : noRoles ? (
          <p className="empty">
            Tell coldopen which roles you want and it finds open ones at{' '}
            {r?.companies ?? 'hundreds of'} companies
            {r?.ycCompanies ? `, ${r.ycCompanies} of them YC startups` : ''}.{' '}
            <a href="#jobs">Set up your job search</a>
          </p>
        ) : r!.data.length === 0 ? (
          <p className="empty">
            No open roles fit your search right now. <a href="#jobs">Change your search</a>
          </p>
        ) : (
          <ul className="job-list">
            {r!.data.slice(0, 3).map((j) => (
              <li key={j.id}>
                <JobRow job={j} onMade={onMade} />
              </li>
            ))}
          </ul>
        )}
      </section>
    )

  return (
    <section className="jobs" aria-label="Jobs for you">
      {q.isPending ? (
        <p className="jobs-note" aria-live="polite">
          Reading open roles from hundreds of companies’ job boards…
        </p>
      ) : q.isError ? (
        <p className="error">Couldn’t load jobs: {q.error.message}</p>
      ) : (
        <SearchForm search={r!.search} first={noRoles} />
      )}

      {r && !noRoles && (
        <>
          <p className="jobs-note">
            {r.search.roles.join(', ')}
            {r.search.locations.length > 0 && ` in ${r.search.locations.join(', ')}`}
            {r.search.remote &&
              (r.search.locations.length ? ', or remote' : ', anywhere or remote')}
            {r.search.ycOnly && ' at YC companies'}
            {r.search.visaOnly && ' that sponsor H-1B visas'}
            {r.search.sort === 'fastest' && ', hiring fastest first'}
            {`. ${r.data.length} matches across ${r.companies} companies`}
            {r.updatedAt && `, checked ${ago(r.updatedAt)}`}
            {r.failed.length > 0 && `. Couldn’t read ${r.failed.join(', ')}`}.
          </p>
          {r.gaps.length > 0 && <Gaps gaps={r.gaps} />}
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
                      Making {started} film{started === 1 ? '' : 's'}. They appear on the Films page
                      as they finish, about a minute and a half each.
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
          {job.yc && (
            <span className="tag yc" title={`Y Combinator, ${job.yc} batch`}>
              YC {job.yc}
            </span>
          )}
          {job.hiring && job.hiring.recent > 0 && (
            <span
              className={job.hiring.recent >= 5 ? 'tag hot' : 'tag quiet'}
              title={`${job.hiring.open} open roles, ${job.hiring.recent} posted in the last 30 days`}
            >
              {job.hiring.recent} new {job.hiring.recent === 1 ? 'role' : 'roles'} this month
            </span>
          )}
          {job.visa && (
            <span
              className="tag visa"
              title={`USCIS approved H-1B petitions for this company in fiscal year ${job.visa.year} (its latest public data)`}
            >
              Sponsors H-1B
            </span>
          )}
          {job.pay && (
            <span className="tag pay" title="Base pay this post lists, per year">
              {money(job.pay)}
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
        {job.known && (
          <span className="job-known">
            You know{' '}
            {job.known.people.slice(0, 2).map((p, i) => (
              <span key={p.name}>
                {i > 0 && ' and '}
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {p.name}
                  </a>
                ) : (
                  p.name
                )}
                {p.position && <span className="quiet"> ({p.position})</span>}
              </span>
            ))}
            {job.known.count > 2 && ` and ${job.known.count - 2} more`} at {job.company}
          </span>
        )}
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

/**
 * The skills their best matches keep asking for that the profile doesn't show. "I have this"
 * adds it to the profile (Fit check counts it from then on); "Not relevant" stops suggesting it.
 */
function Gaps({ gaps }: { gaps: FitGap[] }) {
  const qc = useQueryClient()
  const answer = useMutation({
    mutationFn: (v: { skill: string; action: 'have' | 'ignore' }) =>
      send('POST', '/v1/jobs/gaps', v),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['jobs'] })
      await qc.invalidateQueries({ queryKey: ['profiles'] })
    },
  })
  return (
    <section className="gaps" aria-label="Fit gaps">
      <h3>Fit more of these jobs</h3>
      <p className="quiet">
        Your best matches keep asking for these, and your profile doesn’t show them yet. If you have
        one, add it and every fit updates.
      </p>
      <ul>
        {gaps.map((g) => (
          <li key={g.term}>
            <span className="gap-what" title={g.example}>
              <b>{g.label}</b>
              <span className="quiet"> · {g.jobs} jobs</span>
            </span>
            <span className="gap-do">
              <button
                type="button"
                disabled={answer.isPending}
                onClick={() => answer.mutate({ skill: g.label, action: 'have' })}
              >
                I have this
              </button>
              <button
                type="button"
                className="link quiet"
                disabled={answer.isPending}
                onClick={() => answer.mutate({ skill: g.label, action: 'ignore' })}
              >
                Not relevant
              </button>
            </span>
          </li>
        ))}
      </ul>
      {answer.error && <p className="error">{answer.error.message}</p>}
    </section>
  )
}

/** $150k–$200k */
function money(p: { min: number; max: number; currency: string }) {
  const sym =
    p.currency === 'USD'
      ? '$'
      : p.currency === 'EUR'
        ? '€'
        : p.currency === 'GBP'
          ? '£'
          : `${p.currency} `
  const k = (n: number) => `${sym}${Math.round(n / 1000)}k`
  return p.min === p.max ? k(p.min) : `${k(p.min)}–${k(p.max)}`
}

function SearchForm({ search, first }: { search: JobSearch; first: boolean }) {
  const qc = useQueryClient()
  const [roles, setRoles] = useState(search.roles.join(', '))
  const [places, setPlaces] = useState(search.locations.join(', '))
  const [remote, setRemote] = useState(search.remote)
  const [skipSenior, setSkipSenior] = useState(search.skipSenior)
  const [ycOnly, setYcOnly] = useState(search.ycOnly)
  const [sort, setSort] = useState(search.sort)
  const [within, setWithin] = useState(search.within)
  const [visaOnly, setVisaOnly] = useState(search.visaOnly)
  const [exclude, setExclude] = useState(search.exclude.join(', '))
  const [minPay, setMinPay] = useState(
    search.minPay ? String(Math.round(search.minPay / 1000)) : '',
  )
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
        ycOnly,
        sort,
        within,
        visaOnly,
        exclude: list(exclude).slice(0, 50),
        minPay: minPay.trim() ? Math.max(0, Math.round(Number(minPay) || 0)) * 1000 || null : null,
        boards: list(boards),
      })
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['jobs'] })
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
      <h2 className="search-title">{first ? 'What are you looking for?' : 'Your search'}</h2>
      <div className="search-grid">
        <label>
          <span>Roles</span>
          <input
            value={roles}
            onChange={(e) => setRoles(e.target.value)}
            placeholder="Forward Deployed Engineer, Solutions Engineer"
          />
          <small>Job titles you’d apply for, separated by commas.</small>
        </label>
        <label>
          <span>Places</span>
          <input
            value={places}
            onChange={(e) => setPlaces(e.target.value)}
            placeholder="Bay Area, New York"
          />
          <small>Cities or regions. Leave it empty to see every place.</small>
        </label>
      </div>
      <div className="job-checks">
        <label className="check">
          <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} />
          Include remote roles
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={skipSenior}
            onChange={(e) => setSkipSenior(e.target.checked)}
          />
          Hide staff, principal and manager roles
        </label>
        <label className="check">
          <input type="checkbox" checked={ycOnly} onChange={(e) => setYcOnly(e.target.checked)} />
          YC companies only
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={visaOnly}
            onChange={(e) => setVisaOnly(e.target.checked)}
          />
          Sponsors H-1B visas
        </label>
        <label className="check sort">
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as JobSearch['sort'])}>
            <option value="best">Best fit</option>
            <option value="fastest">Hiring fastest</option>
          </select>
        </label>
        <label className="check sort">
          Posted
          <select value={within} onChange={(e) => setWithin(e.target.value as JobSearch['within'])}>
            <option value="any">Any time</option>
            <option value="month">This month</option>
            <option value="week">This week</option>
          </select>
        </label>
      </div>
      <div className="search-grid">
        <label>
          <span>Minimum pay</span>
          <span className="pay-input">
            $
            <input
              inputMode="numeric"
              value={minPay}
              onChange={(e) => setMinPay(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="120"
              aria-label="Minimum pay in thousands of dollars a year"
            />
            k a year
          </span>
          <small>
            Hides roles whose listed pay tops out lower. Roles that don’t list pay stay.
          </small>
        </label>
        <label>
          <span>Leave out</span>
          <input
            value={exclude}
            onChange={(e) => setExclude(e.target.value)}
            placeholder="Companies you’ve applied to or don’t want"
          />
          <small>Company names, separated by commas.</small>
        </label>
      </div>
      <details className="more-companies" open={search.boards.length > 0}>
        <summary>Add companies that aren’t in the list</summary>
        <label>
          <span className="sr">Careers page links</span>
          <textarea
            rows={2}
            value={boards}
            onChange={(e) => setBoards(e.target.value)}
            placeholder="jobs.ashbyhq.com/acme"
          />
          <small>
            Paste a company’s careers page if it’s on Greenhouse, Lever or Ashby, one per line.
          </small>
        </label>
      </details>
      {save.error && <p className="error">{save.error.message}</p>}
      <div className="job-search-do">
        {save.isSuccess && !save.isPending && <span className="saved">Results updated</span>}
        <button type="submit" className="primary" disabled={save.isPending}>
          {save.isPending ? 'Finding jobs…' : first ? 'Find jobs' : 'Update results'}
        </button>
      </div>
    </form>
  )
}
