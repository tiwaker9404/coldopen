import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
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
import { FUNCTIONS } from './functions.ts'
import { safeUrl } from './safe.ts'
import { useToast } from './ui.tsx'

const SHOWN = 6

const TYPE_LABEL = {
  full_time: 'Full time',
  part_time: 'Part time',
  contract: 'Contract',
  intern: 'Internship',
} as const

const LEVEL_LABEL = {
  intern: 'Intern / New grad',
  entry: 'Entry level',
  mid: 'Mid level',
  senior: 'Senior',
  lead: 'Lead / Staff',
  director: 'Director / Executive',
} as const

const WORK_LABEL = { onsite: 'On site', hybrid: 'Hybrid', remote: 'Remote' } as const

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

  // looking at the full list counts as seeing it: Today's "new since" starts from here
  const marked = useRef(false)
  useEffect(() => {
    if (full && r && !marked.current) {
      marked.current = true
      void send('POST', '/v1/jobs/seen', {}).catch(() => {})
    }
  }, [full, r])

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
        ) : r!.data.length === 0 ? (
          <p className="empty">
            No open roles fit your search right now. <a href="#jobs">Change your search</a>
          </p>
        ) : (
          <>
            <Alerts alerts={r!.alerts} />
            <ul className="job-list">
              {r!.data.slice(0, 3).map((j) => (
                <li key={j.id}>
                  <JobRow job={j} onMade={onMade} />
                </li>
              ))}
            </ul>
          </>
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
        <SearchForm
          search={r!.search}
          first={r!.search.suggested}
          raisable={(r!.raisedCompanies ?? 0) > 0}
        />
      )}

      {r && (
        <>
          <p className="jobs-note">
            {r.search.roles.length ? r.search.roles.join(', ') : 'Every role'}
            {r.search.country === 'us' && ' in the US'}
            {r.search.locations.length > 0 && `, in ${r.search.locations.join(', ')}`}
            {r.search.remote && r.search.locations.length > 0 && ', or remote'}
            {r.search.ycOnly && ' at YC companies'}
            {r.search.visaOnly && ' that sponsor H-1B visas'}
            {r.search.raisedOnly && ', raised in the last year'}
            {r.search.sort === 'fastest' && ', hiring fastest first'}
            {`. ${r.data.length} matches across ${r.companies} companies`}
            {r.updatedAt && `, checked ${ago(r.updatedAt)}`}
            {r.failed.length > 0 && `. Couldn’t read ${r.failed.join(', ')}`}.
          </p>
          {r.search.ycOnly && <YcOnlyNote />}
          {r.gaps.length > 0 && <Gaps gaps={r.gaps} />}
          {!visitor && <KnowNudge />}
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
        <a href={safeUrl(job.url)} target="_blank" rel="noreferrer">
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
          {job.yc &&
            (job.ycPage ? (
              <a
                className="tag yc"
                href={safeUrl(job.ycPage)}
                target="_blank"
                rel="noreferrer"
                title={`Y Combinator, ${job.yc} batch: the founders, and roles it posts on Work at a Startup`}
              >
                YC {job.yc} · founders
              </a>
            ) : (
              <span className="tag yc" title={`Y Combinator, ${job.yc} batch`}>
                YC {job.yc}
              </span>
            ))}
          {job.hiring && job.hiring.recent > 0 && (
            <span
              className={job.hiring.recent >= 5 ? 'tag hot' : 'tag quiet'}
              title={`${job.hiring.open} open roles, ${job.hiring.recent} posted in the last 30 days`}
            >
              {job.hiring.recent} new {job.hiring.recent === 1 ? 'role' : 'roles'} this month
            </span>
          )}
          {job.raised && (
            <span
              className="tag raised"
              title={`${job.raised.filer} filed an SEC Form D (a private funding round) on ${job.raised.date}`}
            >
              Raised{' '}
              {new Date(`${job.raised.date}T12:00:00`).toLocaleDateString(undefined, {
                month: 'short',
                year: 'numeric',
              })}
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
          {job.pay &&
            (intern(job) ? (
              <span className="tag pay" title="Pay this post lists, per month">
                {money({ ...job.pay, min: job.pay.min / 12, max: job.pay.max / 12 }, true)}/mo
              </span>
            ) : (
              <span className="tag pay" title="Base pay this post lists, per year">
                {money(job.pay)}
              </span>
            ))}
          {job.type && job.type !== 'full_time' && (
            <span className="tag">{TYPE_LABEL[job.type]}</span>
          )}
          {job.workplace && job.workplace !== 'remote' && (
            <span className="tag">{job.workplace === 'hybrid' ? 'Hybrid' : 'On site'}</span>
          )}
          {job.years !== undefined && (
            <span className="tag quiet" title="The fewest years of experience the post asks for">
              {job.years}+ yrs
            </span>
          )}
          {why.filter(Boolean).map((w) => (
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
                  <a href={safeUrl(p.url)} target="_blank" rel="noreferrer">
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

/** What's new since their last look: new matches, and new roles at companies they filmed */
function Alerts({ alerts }: { alerts: JobSuggestions['alerts'] }) {
  if (!alerts || (alerts.newMatches === 0 && alerts.filmed.length === 0)) return null
  return (
    <div className="alerts" aria-live="polite">
      {alerts.newMatches > 0 && (
        <p>
          <b>
            {alerts.newMatches} new {alerts.newMatches === 1 ? 'match' : 'matches'}
          </b>{' '}
          since you last looked{alerts.since ? ` (${ago(alerts.since)})` : ''}.{' '}
          <a href="#jobs">See them</a>
        </p>
      )}
      {alerts.filmed.length > 0 && (
        <>
          <p>
            <b>New roles at companies you made a film for</b>
          </p>
          <ul>
            {alerts.filmed.map((j) => (
              <li key={j.id}>
                {j.company}:{' '}
                <a href={safeUrl(j.url)} target="_blank" rel="noreferrer">
                  {j.title}
                </a>
                {j.posted && <span className="quiet"> · {ago(j.posted)}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/**
 * The skills their best matches keep asking for that the profile doesn't show. "I have this"
 * adds it to the profile (Fit check counts it from then on); "Not relevant" stops suggesting it.
 */
function Gaps({ gaps }: { gaps: FitGap[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const answer = useMutation({
    mutationFn: (v: { skill: string; action: 'have' | 'ignore' }) =>
      send('POST', '/v1/jobs/gaps', v),
    onSuccess: async (_r, v) => {
      const jobs = gaps.find((g) => g.label === v.skill)?.jobs ?? 0
      toast({
        text:
          v.action === 'have'
            ? `Added ${v.skill} to your profile's skills. ${jobs} ${jobs === 1 ? 'fit' : 'fits'} updated.`
            : `${v.skill} won't be suggested again.`,
      })
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

/**
 * Until they upload LinkedIn's connections export, a one-line offer to show who they know at
 * each company, with the upload right there.
 */
function KnowNudge() {
  const qc = useQueryClient()
  const conn = useQuery({
    queryKey: ['connections'],
    queryFn: () => api<{ count: number }>('/v1/connections'),
  })
  const upload = useMutation({
    mutationFn: async (file: File) =>
      send<{ count: number }>('PUT', '/v1/connections', { csv: await file.text() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['connections'] })
      await qc.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
  if (!conn.data || conn.data.count > 0) return null
  return (
    <div className="know-nudge">
      <span>
        <b>See who you know at each company.</b> Upload LinkedIn’s connections export (Settings,
        Data privacy, Get a copy of your data, Connections) and every job shows them.
      </span>
      <label className="button">
        {upload.isPending ? 'Reading…' : 'Upload Connections.csv'}
        <input
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) upload.mutate(file)
            e.target.value = ''
          }}
        />
      </label>
      {upload.error && <p className="error">{upload.error.message}</p>}
    </div>
  )
}

/** Toggle chips for a few options; none picked means any */
function Picks<K extends string>({
  all,
  value,
  onChange,
}: {
  all: Record<K, string>
  value: K[]
  onChange: (v: K[]) => void
}) {
  return (
    <>
      {(Object.keys(all) as K[]).map((k) => (
        <label key={k} className={`chip${value.includes(k) ? ' on' : ''}`}>
          <input
            type="checkbox"
            checked={value.includes(k)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, k] : value.filter((x) => x !== k))
            }
          />
          {all[k]}
        </label>
      ))}
    </>
  )
}

/** internships list pay by the month, so it shows that way */
const intern = (j: JobSuggestion) => j.type === 'intern' || /\bintern(ship)?\b/i.test(j.title)

/** $150k–$200k, or $6.5k–$10k for monthly pay */
function money(p: { min: number; max: number; currency: string }, monthly = false) {
  const sym =
    p.currency === 'USD'
      ? '$'
      : p.currency === 'EUR'
        ? '€'
        : p.currency === 'GBP'
          ? '£'
          : `${p.currency} `
  const k = (n: number) =>
    `${sym}${monthly && n < 20_000 ? Math.round(n / 100) / 10 : Math.round(n / 1000)}k`
  return p.min === p.max ? k(p.min) : `${k(p.min)}–${k(p.max)}`
}

function SearchForm({
  search,
  first,
  raisable,
}: {
  search: JobSearch
  first: boolean
  raisable: boolean
}) {
  const qc = useQueryClient()
  const [roles, setRoles] = useState(search.roles.join(', '))
  const [excludeTitles, setExcludeTitles] = useState(search.excludeTitles.join(', '))
  const [places, setPlaces] = useState(search.locations.join(', '))
  const [usOnly, setUsOnly] = useState(search.country === 'us')
  const [types, setTypes] = useState(search.types)
  const [workplaces, setWorkplaces] = useState(search.workplaces)
  const [levels, setLevels] = useState(search.levels)
  const [maxYears, setMaxYears] = useState(search.maxYears === null ? '' : String(search.maxYears))
  const [within, setWithin] = useState(search.within)
  const [roleType, setRoleType] = useState(search.roleType)
  const [minPay, setMinPay] = useState(
    search.minPay ? String(Math.round(search.minPay / 1000)) : '',
  )
  const [visaOnly, setVisaOnly] = useState(search.visaOnly)
  const [noClearance, setNoClearance] = useState(search.noClearance)
  const [noCitizenOnly, setNoCitizenOnly] = useState(search.noCitizenOnly)
  const [skills, setSkills] = useState(search.skills.join(', '))
  const [excludeSkills, setExcludeSkills] = useState(search.excludeSkills.join(', '))
  const [ycOnly, setYcOnly] = useState(search.ycOnly)
  const [raisedOnly, setRaisedOnly] = useState(search.raisedOnly)
  const [exclude, setExclude] = useState(search.exclude.join(', '))
  const [sort, setSort] = useState(search.sort)
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
  const more =
    search.skills.length > 0 ||
    search.excludeSkills.length > 0 ||
    search.excludeTitles.length > 0 ||
    search.exclude.length > 0 ||
    search.boards.length > 0 ||
    search.roleType !== 'any'
  const addFunction = (label: string) => {
    const f = FUNCTIONS.find((x) => x.label === label)
    if (!f) return
    const have = list(roles)
    const next = [...have, ...f.roles.filter((r) => !have.includes(r))].slice(0, 8)
    setRoles(next.join(', '))
  }
  const save = useMutation({
    mutationFn: () =>
      send<JobSearch>('PUT', '/v1/jobs/search', {
        roles: list(roles).slice(0, 8),
        excludeTitles: list(excludeTitles).slice(0, 20),
        locations: list(places).slice(0, 8),
        remote: workplaces.length === 0 || workplaces.includes('remote'),
        skipSenior: false,
        country: usOnly ? 'us' : 'any',
        types,
        workplaces,
        levels,
        maxYears: maxYears === '' ? null : Number(maxYears),
        within,
        roleType,
        minPay: minPay.trim() ? Math.max(0, Math.round(Number(minPay) || 0)) * 1000 || null : null,
        visaOnly,
        noClearance,
        noCitizenOnly,
        skills: list(skills).slice(0, 20),
        excludeSkills: list(excludeSkills).slice(0, 20),
        ycOnly,
        raisedOnly,
        exclude: list(exclude).slice(0, 50),
        sort,
        boards: list(boards),
      }),
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
      <h2 className="search-title">
        {first ? 'Every open role in the US. Narrow it down:' : 'Your search'}
      </h2>
      <div className="search-grid">
        <label>
          <span>Roles</span>
          <input
            value={roles}
            onChange={(e) => setRoles(e.target.value)}
            placeholder="Every role"
          />
          <select
            className="add-function"
            value=""
            onChange={(e) => addFunction(e.target.value)}
            aria-label="Add a job function"
          >
            <option value="">Add a job function…</option>
            {FUNCTIONS.map((f) => (
              <option key={f.label} value={f.label}>
                {f.label}
              </option>
            ))}
          </select>
          <small>Job titles, separated by commas. Leave it empty to see every role.</small>
        </label>
        <label>
          <span>Places</span>
          <input
            value={places}
            onChange={(e) => setPlaces(e.target.value)}
            placeholder="Anywhere"
          />
          <label className="check inline">
            <input type="checkbox" checked={usOnly} onChange={(e) => setUsOnly(e.target.checked)} />
            In the United States only
          </label>
          <small>Cities or regions, like Bay Area or New York. Empty: every place.</small>
        </label>
      </div>

      <fieldset className="chips">
        <legend>Job type</legend>
        <Picks all={TYPE_LABEL} value={types} onChange={setTypes} />
      </fieldset>
      <fieldset className="chips">
        <legend>Work model</legend>
        <Picks all={WORK_LABEL} value={workplaces} onChange={setWorkplaces} />
      </fieldset>
      <fieldset className="chips">
        <legend>Experience</legend>
        <Picks all={LEVEL_LABEL} value={levels} onChange={setLevels} />
      </fieldset>

      <div className="job-checks selects">
        <label className="check sort">
          Required experience
          <select value={maxYears} onChange={(e) => setMaxYears(e.target.value)}>
            <option value="">Open to all</option>
            <option value="2">0–2 years</option>
            <option value="5">Up to 5 years</option>
            <option value="8">Up to 8 years</option>
          </select>
        </label>
        <label className="check sort">
          Date posted
          <select value={within} onChange={(e) => setWithin(e.target.value as JobSearch['within'])}>
            <option value="any">Any time</option>
            <option value="day">Past 24 hours</option>
            <option value="3days">Past 3 days</option>
            <option value="week">Past week</option>
            <option value="month">Past month</option>
          </select>
        </label>
        <label className="check sort">
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as JobSearch['sort'])}>
            <option value="best">Best fit</option>
            <option value="fastest">Hiring fastest</option>
          </select>
        </label>
      </div>

      <fieldset className="group">
        <legend>Compensation and sponsorship</legend>
        <div className="search-grid">
          <label>
            <span>Minimum annual salary</span>
            <span className="pay-input">
              $
              <input
                inputMode="numeric"
                value={minPay}
                onChange={(e) => setMinPay(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="any"
                aria-label="Minimum pay in thousands of dollars a year"
              />
              k
            </span>
            <small>
              Hides roles whose listed pay tops out lower. Roles that don’t list pay stay.
            </small>
          </label>
          <div className="job-checks column">
            <label className="check">
              <input
                type="checkbox"
                checked={visaOnly}
                onChange={(e) => setVisaOnly(e.target.checked)}
              />
              Sponsors H-1B visas
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={noClearance}
                onChange={(e) => setNoClearance(e.target.checked)}
              />
              Leave out roles needing a security clearance
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={noCitizenOnly}
                onChange={(e) => setNoCitizenOnly(e.target.checked)}
              />
              Leave out roles for US citizens only
            </label>
          </div>
        </div>
      </fieldset>

      <details className="more-companies" open={more}>
        <summary>More filters: skills, titles, companies</summary>
        <div className="search-grid">
          <label>
            <span>Skills</span>
            <input
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="Python, AWS"
            />
            <small>Roles whose requirements name any of these.</small>
          </label>
          <label>
            <span>Leave out skills</span>
            <input
              value={excludeSkills}
              onChange={(e) => setExcludeSkills(e.target.value)}
              placeholder="Java"
            />
            <small>Roles whose requirements name these are hidden.</small>
          </label>
          <label>
            <span>Leave out titles with</span>
            <input
              value={excludeTitles}
              onChange={(e) => setExcludeTitles(e.target.value)}
              placeholder="Sales, Clinical"
            />
            <small>Words, separated by commas.</small>
          </label>
          <label>
            <span>Role type</span>
            <select
              value={roleType}
              onChange={(e) => setRoleType(e.target.value as JobSearch['roleType'])}
            >
              <option value="any">Individual contributors and managers</option>
              <option value="ic">Individual contributors</option>
              <option value="manager">People managers</option>
            </select>
          </label>
          <label>
            <span>Leave out companies</span>
            <input
              value={exclude}
              onChange={(e) => setExclude(e.target.value)}
              placeholder="Companies you’ve applied to"
            />
            <small>Company names, separated by commas.</small>
          </label>
          <div className="job-checks column">
            <label className="check">
              <input
                type="checkbox"
                checked={ycOnly}
                onChange={(e) => setYcOnly(e.target.checked)}
              />
              YC companies only
            </label>
            {(raisable || raisedOnly) && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={raisedOnly}
                  onChange={(e) => setRaisedOnly(e.target.checked)}
                />
                Raised in the last year
              </label>
            )}
          </div>
        </div>
        <label>
          <span>Companies that aren’t in the list</span>
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
        {save.isSuccess && !save.isPending && <span className="saved">Saved. Results updated</span>}
        <button type="submit" className="primary" disabled={save.isPending}>
          {save.isPending ? 'Finding jobs…' : first ? 'Save my search' : 'Update results'}
        </button>
      </div>
    </form>
  )
}

/** YC startups whose roles are only on Work at a Startup, which no API reads: point to them */
function YcOnlyNote() {
  const q = useQuery({
    queryKey: ['startups', 'yc-only-count'],
    queryFn: () => api<{ total: number }>('/v1/startups?hiring=yc-only&limit=1'),
    staleTime: 60 * 60_000,
  })
  if (!q.data?.total) return null
  return (
    <p className="jobs-note">
      {q.data.total.toLocaleString()} more YC startups post their roles only on YC’s Work at a
      Startup, which has no public feed to read.{' '}
      <a href="?hiring=yc-only#startups">See them in Startups</a>, each with its founders and its
      jobs on YC.
    </p>
  )
}
