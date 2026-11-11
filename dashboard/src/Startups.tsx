import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type Film, send } from './api.ts'
import { safeUrl } from './safe.ts'
import { ErrorNote } from './ui.tsx'

/** one YC startup, hiring or not */
interface Startup {
  name: string
  slug: string
  website: string | null
  batch: string
  oneLiner: string | null
  team: number | null
  industry: string | null
  sub: string | null
  hiring: boolean
  inJobs: boolean
  yc: string
  ycJobs: string | null
  filmId?: string
  /** with the warm sort: why it's worth a warm message */
  reasons?: string[]
}

interface StartupPage {
  data: Startup[]
  total: number
  industries: { name: string; count: number }[]
}

const PAGE = 30

/**
 * YC startups to reach out to, hiring or not. Plenty of startups never post a role: a film to
 * the founder can start the conversation before one exists.
 */
export function Startups({ onMade }: { onMade: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [industry, setIndustry] = useState('')
  const [since, setSince] = useState('2023')
  const [maxTeam, setMaxTeam] = useState('50')
  const [hiring, setHiring] = useState<'any' | 'hiring' | 'yc-only' | 'quiet'>(() =>
    new URLSearchParams(window.location.search).get('hiring') === 'yc-only' ? 'yc-only' : 'any',
  )
  const [sort, setSort] = useState<'newest' | 'warm'>('newest')
  const [page, setPage] = useState(0)
  const params = new URLSearchParams({
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(industry ? { industry } : {}),
    ...(since ? { since } : {}),
    ...(maxTeam ? { maxTeam } : {}),
    hiring,
    ...(sort === 'warm' ? { sort } : {}),
    limit: String(PAGE),
    offset: String(page * PAGE),
  })
  const r = useQuery({
    queryKey: ['startups', params.toString()],
    queryFn: () => api<StartupPage>(`/v1/startups?${params}`),
    placeholderData: (prev) => prev,
  })
  const d = r.data
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v)
      setPage(0)
    }
  return (
    <section className="startups">
      <div className="startup-filters">
        <input
          value={q}
          onChange={(e) => reset(setQ)(e.target.value)}
          placeholder="Search: payments, robotics, dev tools…"
          aria-label="Search startups"
        />
        <select
          value={industry}
          onChange={(e) => reset(setIndustry)(e.target.value)}
          aria-label="Industry"
        >
          <option value="">Every industry</option>
          {d?.industries.map((i) => (
            <option key={i.name} value={i.name}>
              {i.name} ({i.count})
            </option>
          ))}
        </select>
        <select value={since} onChange={(e) => reset(setSince)(e.target.value)} aria-label="Batch">
          <option value="2025">Batches from 2025</option>
          <option value="2023">From 2023</option>
          <option value="2020">From 2020</option>
          <option value="">Any batch</option>
        </select>
        <select
          value={maxTeam}
          onChange={(e) => reset(setMaxTeam)(e.target.value)}
          aria-label="Team size"
        >
          <option value="10">Up to 10 people</option>
          <option value="50">Up to 50</option>
          <option value="200">Up to 200</option>
          <option value="">Any size</option>
        </select>
        <select
          value={hiring}
          onChange={(e) => reset(setHiring)(e.target.value as typeof hiring)}
          aria-label="Hiring"
        >
          <option value="any">Hiring or not</option>
          <option value="quiet">Not posting roles</option>
          <option value="hiring">Hiring on YC</option>
          <option value="yc-only">Roles only on YC (not in Jobs)</option>
        </select>
        <select
          value={sort}
          onChange={(e) => reset(setSort)(e.target.value as typeof sort)}
          aria-label="Sort by"
        >
          <option value="newest">Newest batch first</option>
          <option value="warm">Worth a warm message</option>
        </select>
      </div>
      <p className="jobs-note">
        {d
          ? `${d.total.toLocaleString()} YC startups with people in the US, ${sort === 'warm' ? 'the ones most worth a warm message first' : 'newest first'}. The founders are named on each YC page; at this size they read their own inbox.`
          : 'Reading YC’s directory…'}
      </p>
      {r.isError && <ErrorNote error={r.error} lead="Couldn’t load startups: " />}
      <ul className="job-list">
        {d?.data.map((s) => (
          <li key={s.slug}>
            <StartupRow s={s} onMade={onMade} />
          </li>
        ))}
      </ul>
      {d && d.total > PAGE && (
        <div className="pager">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="quiet">
            {page * PAGE + 1}–{Math.min(d.total, (page + 1) * PAGE)} of {d.total.toLocaleString()}
          </span>
          <button
            type="button"
            disabled={(page + 1) * PAGE >= d.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  )
}

function StartupRow({ s, onMade }: { s: Startup; onMade: (id: string) => void }) {
  const qc = useQueryClient()
  const make = useMutation({
    mutationFn: () => send<Film>('POST', '/v1/films', { url: s.website }),
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: ['films'] })
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['startups'] })
      onMade(f.id)
    },
  })
  return (
    <div className="job">
      <div className="job-what">
        <b>{s.name}</b>
        {s.oneLiner && <span className="startup-line">{s.oneLiner}</span>}
        {s.reasons?.length ? <span className="startup-line">{s.reasons.join(' · ')}</span> : null}
        <span className="job-why">
          {s.batch && <span className="tag yc">YC {s.batch}</span>}
          {s.team && <span className="tag">{s.team} people</span>}
          {(s.sub ?? s.industry) && <span className="tag">{s.sub ?? s.industry}</span>}
          {s.hiring ? (
            <span className="tag new">Hiring on YC</span>
          ) : (
            <span className="tag quiet">Not posting roles</span>
          )}
          {s.inJobs && (
            <a className="tag" href="#jobs">
              Open roles in Jobs
            </a>
          )}
        </span>
        <span className="startup-links">
          <a href={safeUrl(s.yc)} target="_blank" rel="noreferrer">
            Founders on YC
          </a>
          {s.ycJobs && (
            <a href={safeUrl(s.ycJobs)} target="_blank" rel="noreferrer">
              Jobs on YC
            </a>
          )}
          {s.website && (
            <a href={safeUrl(s.website)} target="_blank" rel="noreferrer">
              Website
            </a>
          )}
        </span>
        <ErrorNote error={make.error} inline />
      </div>
      <div className="job-do">
        {s.filmId ? (
          <button type="button" onClick={() => onMade(s.filmId!)}>
            Open film
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={!s.website || make.isPending}
            onClick={() => make.mutate()}
          >
            {make.isPending ? 'Starting…' : 'Make film'}
          </button>
        )}
      </div>
    </div>
  )
}
