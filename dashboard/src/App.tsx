import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { ApiError, api, apiKey, type Film, type Format, type Profile, send, setApiKey } from './api.ts'
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

  const profiles = useQuery({ queryKey: ['profiles'], queryFn: () => api<{ data: Profile[] }>('/v1/profiles') })
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
        const f = await send<Film>('POST', '/v1/films', { url: urls[0], profileId, format })
        return { film: f, batch: null as null | { id: string; count: number } }
      }
      const b = await send<{ batch: string; films: number }>('POST', '/v1/batches', { urls, profileId, format })
      return { film: null, batch: { id: b.batch, count: b.films } }
    },
    onSuccess: (r) => {
      setText('')
      if (r.film) setOpen(r.film.id)
      if (r.batch) setLastBatch(r.batch)
      void qc.invalidateQueries({ queryKey: ['films'] })
    },
  })

  const unauthorized = [films.error, profiles.error].some((e) => e instanceof ApiError && e.status === 401)
  const noProfiles = profiles.data && profiles.data.data.length === 0
  const list = films.data?.data ?? []

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="lens" aria-hidden="true" />
          <span className="wordmark">coldopen</span>
        </div>
        <p className="tagline">Paste a company's website. Get a 30-second film made for them.</p>
      </header>

      {unauthorized && <KeyForm />}

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
            <button type="submit" className="primary" disabled={make.isPending || noProfiles || !profileId}>
              {make.isPending
                ? 'Starting…'
                : urls.length > 1
                  ? `Make ${urls.length} films`
                  : 'Make film'}
            </button>
          </div>
          <div className="options">
            <button type="button" className="text" onClick={() => setMany(!many)}>
              {many ? 'One company' : 'A list of companies'}
            </button>
            <label className="select">
              <span>From</span>
              <select value={profileId} onChange={(e) => setProfileId(e.target.value)} disabled={!profiles.data?.data.length}>
                {profiles.data?.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="text"
              onClick={() => setEditing(profiles.data?.data.find((p) => p.id === profileId) ?? 'new')}
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
          {make.error && <p className="error">{make.error.message}</p>}
          {noProfiles && (
            <p className="hint">First, tell coldopen who the films are from and what you offer. It takes a minute.</p>
          )}
          {lastBatch && (
            <p className="hint">
              {lastBatch.count} films queued.{' '}
              <a href={`/v1/batches/${lastBatch.id}/results.csv`} onClick={(e) => downloadCsv(e, lastBatch.id)}>
                Download links as CSV
              </a>{' '}
              when they finish, ready for your CRM or sequencer.
            </p>
          )}
        </form>
      </section>

      <main>
        {list.length === 0 && !films.isLoading ? (
          <div className="empty">
            <h2>No films yet</h2>
            <p>
              Paste a company's website above. coldopen reads their homepage, matches their brand, writes a short script
              grounded in what's on the page, and renders the film. It takes about a minute.
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
  const res = await fetch(`/v1/batches/${batch}/results.csv`, { headers: k ? { authorization: `Bearer ${k}` } : {} })
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
