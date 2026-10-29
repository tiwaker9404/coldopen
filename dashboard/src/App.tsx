import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { AccountBar, FirstRun, FramedNotice, PrivacyNote } from './Account.tsx'
import {
  ApiError,
  api,
  apiKey,
  type Film,
  type Format,
  type Me,
  type Profile,
  send,
  setApiKey,
} from './api.ts'
import { FilmCard } from './FilmCard.tsx'
import { FilmPanel } from './FilmPanel.tsx'
import { ProfileEditor } from './ProfileEditor.tsx'

const FORMATS: { id: Format; label: string }[] = [
  { id: 'square', label: 'Square' },
  { id: 'landscape', label: 'Wide' },
  { id: 'portrait', label: 'Tall' },
]

export function App() {
  const qc = useQueryClient()
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<Profile | 'new' | null>(null)
  const [many, setMany] = useState(false)
  const [text, setText] = useState('')
  const [format, setFormat] = useState<Format>('square')
  const [profileId, setProfileId] = useState<string>('')
  const [lastBatch, setLastBatch] = useState<{ id: string; count: number } | null>(null)
  // which proof items to show; empty lets the writer pick the 3 that fit each company
  const [picks, setPicks] = useState<number[]>([])
  // a job post to answer: its URL or its pasted description (one company at a time)
  const [jobOn, setJobOn] = useState(false)
  const [job, setJob] = useState('')

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/v1/me') })
  const hosted = me.data?.hosted ?? false
  const visitor = hosted && !me.data?.user
  // a failed GitHub sign-in comes back as ?signin=<why>
  const [signinError] = useState(() => new URLSearchParams(window.location.search).get('signin'))
  const profiles = useQuery({
    queryKey: ['profiles'],
    queryFn: () => api<{ data: Profile[] }>('/v1/profiles'),
  })
  const films = useQuery({
    queryKey: ['films'],
    queryFn: () => api<{ data: Film[] }>('/v1/films?limit=120'),
    refetchInterval: (q) =>
      q.state.data?.data.some((f) => f.status === 'queued' || f.status === 'running') ? 1200 : 6000,
  })

  useEffect(() => {
    if (!profileId && profiles.data?.data[0]) setProfileId(profiles.data.data[0].id)
  }, [profiles.data, profileId])

  const urls = text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /\.[a-z]{2,}/i.test(s) || s.startsWith('http'))

  const make = useMutation({
    mutationFn: async () => {
      if (urls.length === 0) throw new Error('Paste a company website, like acme.com')
      if (urls.length === 1) {
        const j = job.trim()
        if (jobOn && j && !/^https?:\/\/\S+$/.test(j) && j.length < 40)
          throw new Error('Paste the job post’s link, or its whole description')
        const f = await send<Film>('POST', '/v1/films', {
          url: urls[0],
          profileId,
          format,
          ...(picks.length ? { proof: picks } : {}),
          ...(jobOn && j ? { job: /^https?:\/\/\S+$/.test(j) ? { url: j } : { text: j } } : {}),
        })
        return { film: f, batch: null as null | { id: string; count: number } }
      }
      const b = await send<{ batch: string; films: number }>('POST', '/v1/batches', {
        urls,
        profileId,
        format,
        ...(picks.length ? { proof: picks } : {}),
      })
      return { film: null, batch: { id: b.batch, count: b.films } }
    },
    onSuccess: (r) => {
      setText('')
      setJob('')
      void qc.invalidateQueries({ queryKey: ['me'] })
      if (r.film) setOpen(r.film.id)
      if (r.batch) setLastBatch(r.batch)
      void qc.invalidateQueries({ queryKey: ['films'] })
    },
  })

  const unauthorized = [films.error, profiles.error].some(
    (e) => e instanceof ApiError && e.status === 401,
  )
  const noProfiles = profiles.data && profiles.data.data.length === 0
  const selected = profiles.data?.data.find((p) => p.id === profileId)
  const list = films.data?.data ?? []

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="lens" aria-hidden="true" />
          <span className="wordmark">coldopen</span>
        </div>
        <p className="tagline">Paste a company's website. Get a 30-second film made for them.</p>
        {hosted && me.data && <AccountBar me={me.data} />}
      </header>

      {hosted && <FramedNotice />}
      {signinError && <p className="error">Sign-in didn't work: {signinError}</p>}
      {unauthorized && !hosted && <KeyForm />}
      {hosted && list.length === 0 && (
        <FirstRun hasProfile={!noProfiles} onStart={() => setEditing('new')} />
      )}

      <section className="composer" aria-label="Make a film">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            make.mutate()
          }}
        >
          <div className="field-row">
            {many ? (
              <textarea
                aria-label="Company websites, one per line"
                placeholder={'acme.com\nglobex.com\ninitech.com'}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
              />
            ) : (
              <input
                aria-label="Company website"
                placeholder="acme.com"
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            )}
            <button
              type="submit"
              className="primary"
              disabled={make.isPending || noProfiles || !profileId}
            >
              {make.isPending
                ? 'Starting…'
                : urls.length > 1
                  ? `Make ${urls.length} films`
                  : 'Make film'}
            </button>
          </div>
          <div className="options">
            {!visitor && (
              <button type="button" className="text" onClick={() => setMany(!many)}>
                {many ? 'One company' : 'A list of companies'}
              </button>
            )}
            {!many && (
              <button
                type="button"
                className="text"
                aria-expanded={jobOn}
                onClick={() => setJobOn(!jobOn)}
              >
                {jobOn ? 'No job post' : 'Answer a job post'}
              </button>
            )}
            {!noProfiles && (
              <label className="select">
                <span>From</span>
                <select
                  value={profileId}
                  onChange={(e) => {
                    setProfileId(e.target.value)
                    setPicks([])
                  }}
                  disabled={!profiles.data?.data.length}
                >
                  {profiles.data?.data.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              className="text"
              onClick={() =>
                setEditing(profiles.data?.data.find((p) => p.id === profileId) ?? 'new')
              }
            >
              {noProfiles ? 'Create your profile' : 'Edit profile'}
            </button>
            {!noProfiles && (
              <button type="button" className="text" onClick={() => setEditing('new')}>
                New profile
              </button>
            )}
            <div className="segmented" role="radiogroup" aria-label="Format">
              {FORMATS.map((f) => (
                // biome-ignore lint/a11y/useSemanticElements: a segmented control; buttons with radio semantics are the WAI-ARIA pattern
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={format === f.id}
                  className={format === f.id ? 'on' : ''}
                  onClick={() => setFormat(f.id)}
                >
                  <span className={`shape ${f.id}`} aria-hidden="true" />
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {jobOn && !many && (
            <label className="job">
              <span>
                The job post: its link (careers page, Greenhouse, Lever, Ashby) or the whole
                description. The film quotes one requirement and answers it with your proof.
              </span>
              <textarea
                id="job-post"
                value={job}
                onChange={(e) => setJob(e.target.value)}
                rows={3}
                placeholder="https://job-boards.greenhouse.io/acme/jobs/123, or paste the description"
              />
            </label>
          )}
          {selected && selected.data.proof.length > 3 && (
            <fieldset className="picks">
              <legend>Proof to show:</legend>
              {selected.data.proof.map((p, i) => {
                const on = picks.includes(i)
                return (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: proof items are positional
                    key={i}
                    type="button"
                    aria-pressed={on}
                    disabled={!on && picks.length >= 3}
                    title={`${p.value} ${p.label}${p.where ? ` (${p.where})` : ''}`}
                    onClick={() => setPicks(on ? picks.filter((x) => x !== i) : [...picks, i])}
                  >
                    {p.value}
                  </button>
                )
              })}
              <span>{picks.length ? `${picks.length} of 3` : 'or let the writer pick'}</span>
            </fieldset>
          )}
          {make.error && <p className="error">{make.error.message}</p>}
          {noProfiles && !hosted && (
            <p className="hint">
              First, tell coldopen who the films are from and what you offer. It takes a minute.
            </p>
          )}
          {me.data && <PrivacyNote me={me.data} />}
          {lastBatch && (
            <p className="hint">
              {lastBatch.count} films queued.{' '}
              <a
                href={`/v1/batches/${lastBatch.id}/results.csv`}
                onClick={(e) => downloadCsv(e, lastBatch.id)}
              >
                Download links as CSV
              </a>{' '}
              when they finish, ready for your CRM or sequencer.
            </p>
          )}
        </form>
      </section>

      <main>
        {list.length === 0 && !films.isLoading && hosted ? null : list.length === 0 &&
          !films.isLoading ? (
          <div className="empty">
            <h2>No films yet</h2>
            <p>
              Paste a company's website above. coldopen reads their homepage, matches their brand,
              writes a short script grounded in what's on the page, and renders the film. It takes
              about a minute.
            </p>
          </div>
        ) : (
          <ul className="grid">
            {list.map((f) => (
              <li key={f.id}>
                <FilmCard film={f} onOpen={() => setOpen(f.id)} active={open === f.id} />
              </li>
            ))}
          </ul>
        )}
      </main>

      {open && <FilmPanel id={open} onClose={() => setOpen(null)} />}
      {editing && (
        <ProfileEditor
          profile={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            setProfileId(id)
            setEditing(null)
            void qc.invalidateQueries({ queryKey: ['profiles'] })
          }}
        />
      )}
    </div>
  )
}

async function downloadCsv(e: React.MouseEvent, batch: string) {
  e.preventDefault()
  const k = apiKey()
  const res = await fetch(`/v1/batches/${batch}/results.csv`, {
    headers: k ? { authorization: `Bearer ${k}` } : {},
  })
  const blob = await res.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `coldopen-${batch}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function KeyForm() {
  const [k, setK] = useState(apiKey())
  const qc = useQueryClient()
  return (
    <form
      className="keyform"
      onSubmit={(e) => {
        e.preventDefault()
        setApiKey(k)
        void qc.invalidateQueries()
      }}
    >
      <label htmlFor="key">This workspace needs an API key.</label>
      <input id="key" type="password" value={k} onChange={(e) => setK(e.target.value)} />
      <button type="submit">Use key</button>
    </form>
  )
}
