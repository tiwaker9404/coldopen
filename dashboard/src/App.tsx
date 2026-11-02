import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { AccountMenu, FramedNotice, Privacy, StatsPanel } from './Account.tsx'
import {
  ApiError,
  api,
  apiKey,
  type Film,
  type Format,
  linkKind,
  type Me,
  type OutreachSummary,
  type Profile,
  type ProfileData,
  send,
  setApiKey,
} from './api.ts'
import { FilmPanel } from './FilmPanel.tsx'
import { FilmRow } from './FilmRow.tsx'
import { GettingStarted, GuidePanel, ToolsPanel } from './Guide.tsx'
import { Jobs } from './Jobs.tsx'
import { Onboarding } from './Onboarding.tsx'
import { ProfileEditor } from './ProfileEditor.tsx'
import { notify, useToast } from './ui.tsx'

const FORMATS: { id: Format; label: string }[] = [
  { id: 'square', label: 'Square' },
  { id: 'landscape', label: 'Wide' },
  { id: 'portrait', label: 'Tall' },
]

type Editing = { profile: Profile | null; draft?: ProfileData; notice?: string }

export function App() {
  const qc = useQueryClient()
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [stats, setStats] = useState(false)
  const [side, setSide] = useState<'guide' | 'tools' | null>(null)
  const toast = useToast()

  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/v1/me') })
  const hosted = me.data?.hosted ?? false
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
      q.state.data?.data.some((f) => f.status === 'queued' || f.status === 'running') ? 1500 : 8000,
  })

  const unauthorized = [films.error, profiles.error].some(
    (e) => e instanceof ApiError && e.status === 401,
  )
  const list = films.data?.data ?? []
  const noProfile = profiles.data?.data.length === 0
  const loading = profiles.isLoading || films.isLoading

  // say when a film finishes, here and (if allowed) as a system notification; the tab title
  // shows how many are still being made
  const was = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const before = was.current
    for (const f of list) {
      const prev = before.get(f.id)
      if (prev && prev !== f.status && (prev === 'running' || prev === 'queued')) {
        const name = nameOf(f, list) ?? 'Your'
        if (f.status === 'succeeded') {
          toast({
            text: `${name} film is ready.`,
            action: { label: 'Open it', run: () => setOpen(f.id) },
          })
          notify(`${name} film is ready`, 'Open coldopen to send it.')
        } else if (f.status === 'failed')
          toast({
            text: `${name} film needs another try.`,
            action: { label: 'See why', run: () => setOpen(f.id) },
          })
      }
    }
    was.current = new Map(list.map((f) => [f.id, f.status]))
    const making = list.filter((f) => f.status === 'queued' || f.status === 'running').length
    document.title = making
      ? `Making ${making} film${making === 1 ? '' : 's'} – coldopen`
      : 'coldopen'
  }, [list, toast])

  return (
    <div className="app">
      <header className="top">
        <a className="wordmark" href="/" aria-label="coldopen home">
          <i aria-hidden="true" />
          coldopen
        </a>
        <nav className="nav" aria-label="Help">
          <button type="button" className="link" onClick={() => setSide('guide')}>
            How it works
          </button>
          <button type="button" className="link" onClick={() => setSide('tools')}>
            Connect tools
          </button>
          {me.data && <AccountMenu me={me.data} onStats={() => setStats(true)} />}
        </nav>
      </header>

      <main className="page">
        {hosted && <FramedNotice />}
        {signinError && <p className="error">Sign-in didn't work: {signinError}</p>}
        {unauthorized && !hosted && <KeyForm />}

        {loading ? null : noProfile && list.length === 0 ? (
          <Onboarding
            hosted={hosted}
            onDraft={(draft, notice) => setEditing({ profile: null, draft, notice })}
            onBlank={(draft, notice) => setEditing({ profile: null, draft, notice })}
          />
        ) : (
          <>
            <Composer
              me={me.data}
              profiles={profiles.data?.data ?? []}
              onMade={setOpen}
              onEdit={(p) => setEditing({ profile: p })}
              onNew={() => setEditing({ profile: null })}
            />
            <GettingStarted films={list} onOpen={setOpen} onGuide={() => setSide('guide')} />
            <Jobs onMade={setOpen} />
            <Films list={list} open={open} onOpen={setOpen} />
          </>
        )}

        {me.data && <Privacy me={me.data} />}
      </main>

      {open && (
        <FilmPanel
          key={open}
          id={open}
          name={(() => {
            const f = list.find((x) => x.id === open)
            return f ? nameOf(f, list) : undefined
          })()}
          onClose={() => setOpen(null)}
          onOpen={setOpen}
        />
      )}
      {editing && (
        <ProfileEditor
          profile={editing.profile}
          draft={editing.draft}
          notice={editing.notice}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void qc.invalidateQueries({ queryKey: ['profiles'] })
          }}
        />
      )}
      {stats && <StatsPanel onClose={() => setStats(false)} />}
      {side === 'guide' && (
        <GuidePanel onClose={() => setSide(null)} onTools={() => setSide('tools')} />
      )}
      {side === 'tools' && <ToolsPanel me={me.data} onClose={() => setSide(null)} />}
    </div>
  )
}

const JOB_LINK = /^https?:\/\/\S+$/

/** One line under the field: what the film will be about, before anyone presses the button. */
function whatHappens(
  text: string,
  urls: string[],
  many: boolean,
  job: string,
  preset: 'sales' | 'candidate' | undefined,
): string {
  if (many)
    return urls.length
      ? `${urls.length} ${urls.length === 1 ? 'company' : 'companies'}, one film each.`
      : 'Paste one company website per line.'
  const kind = linkKind(text)
  if (!kind)
    return preset === 'sales'
      ? 'Paste a prospect’s website. The film is about what’s on their homepage.'
      : 'A job link works best: the film answers one of the role’s requirements with your results.'
  const host = (() => {
    try {
      return new URL(
        /^https?:/.test(text.trim()) ? text.trim() : `https://${text.trim()}`,
      ).hostname.replace(/^www\./, '')
    } catch {
      return text.trim()
    }
  })()
  if (kind === 'job')
    return 'A job post. coldopen finds the company’s site from it, and the film answers one requirement from the post with your results.'
  return job.trim()
    ? `${host}, answering the job post you added below.`
    : `The film is about what ${host} says on its homepage. Have a job link for it? Paste that instead, or add it under Options.`
}

/** The one thing the page is for: paste a link, make a film. Everything else is tucked away. */
function Composer({
  me,
  profiles,
  onMade,
  onEdit,
  onNew,
}: {
  me: Me | undefined
  profiles: Profile[]
  onMade: (id: string) => void
  onEdit: (p: Profile) => void
  onNew: () => void
}) {
  const qc = useQueryClient()
  const [text, setText] = useState('')
  const [more, setMore] = useState(false)
  const [many, setMany] = useState(false)
  const [format, setFormat] = useState<Format>('square')
  const [profileId, setProfileId] = useState('')
  const [picks, setPicks] = useState<number[]>([])
  const [job, setJob] = useState('')
  const [batch, setBatch] = useState<{ id: string; count: number } | null>(null)
  const visitor = !!me?.hosted && !me.user
  const input = useRef<HTMLInputElement>(null)
  // "/" anywhere jumps to the link field, as on most tools people know
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key !== '/' || /input|textarea|select/i.test(t.tagName) || t.isContentEditable) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!profiles.some((p) => p.id === profileId) && profiles[0]) setProfileId(profiles[0].id)
  }, [profiles, profileId])
  const profile = profiles.find((p) => p.id === profileId)

  const urls = text
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /\.[a-z]{2,}/i.test(s) || s.startsWith('http'))

  const make = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Set up your profile first')
      if (urls.length === 0)
        throw new Error('Paste a company website, like acme.com, or a job link')
      const proof = picks.length ? { proof: picks } : {}
      if (many && urls.length > 1) {
        const b = await send<{ batch: string; films: number }>('POST', '/v1/batches', {
          urls,
          profileId,
          format,
          ...proof,
        })
        return { film: null, batch: { id: b.batch, count: b.films } }
      }
      const j = job.trim()
      if (j && !JOB_LINK.test(j) && j.length < 40)
        throw new Error('Paste the job post’s link, or its whole description')
      const f = await send<Film>('POST', '/v1/films', {
        url: urls[0],
        profileId,
        format,
        ...proof,
        ...(j ? { job: JOB_LINK.test(j) ? { url: j } : { text: j } } : {}),
      })
      return { film: f, batch: null }
    },
    onSuccess: (r) => {
      setText('')
      setJob('')
      void qc.invalidateQueries({ queryKey: ['me'] })
      void qc.invalidateQueries({ queryKey: ['films'] })
      if (r.film) onMade(r.film.id)
      setBatch(r.batch)
    },
  })

  const left = me?.films ? Math.max(0, me.films.limit - me.films.used) : null
  const label = make.isPending
    ? 'Starting…'
    : many && urls.length > 1
      ? `Make ${urls.length} films`
      : 'Make film'

  return (
    <section className="composer" aria-labelledby="make-title">
      <h1 id="make-title">Paste a job link or a company’s website.</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          make.mutate()
        }}
      >
        <div className="ask">
          {many ? (
            <textarea
              aria-label="Company websites, one per line"
              placeholder={'acme.com\nglobex.com\ninitech.com'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
            />
          ) : (
            <input
              aria-label="Company website or job link"
              placeholder="linear.app, or jobs.ashbyhq.com/…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              ref={input}
              aria-describedby="what-happens"
              autoComplete="off"
              spellCheck={false}
              // biome-ignore lint/a11y/noAutofocus: the page exists to take this one input
              autoFocus
            />
          )}
          <button type="submit" className="primary" disabled={make.isPending || !profile}>
            {label}
          </button>
        </div>

        <p className="what" id="what-happens" aria-live="polite">
          {whatHappens(text, urls, many, job, profile?.data.preset)}
        </p>

        <div className="under">
          <span>
            {profile ? (
              <>
                From{' '}
                <button type="button" className="link" onClick={() => onEdit(profile)}>
                  {profile.name}
                </button>
              </>
            ) : (
              'Loading your profile…'
            )}
          </span>
          {left !== null && (
            <span className={left === 0 ? 'out' : ''}>
              {left === 0 ? 'No films left today' : `${left} left today`}
            </span>
          )}
          <button
            type="button"
            className="link"
            aria-expanded={more}
            aria-controls="composer-more"
            onClick={() => setMore(!more)}
          >
            {more ? 'Fewer options' : 'Options'}
          </button>
        </div>

        {more && (
          <div className="more" id="composer-more">
            <label className="row">
              <span>Profile</span>
              <span className="inline">
                <select
                  value={profileId}
                  onChange={(e) => {
                    setProfileId(e.target.value)
                    setPicks([])
                  }}
                >
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="link" onClick={onNew}>
                  New profile
                </button>
              </span>
            </label>

            <div className="row">
              <span id="format-label">Shape</span>
              <div className="shapes" role="radiogroup" aria-labelledby="format-label">
                {FORMATS.map((f) => (
                  // biome-ignore lint/a11y/useSemanticElements: radio-styled buttons are the WAI-ARIA pattern for this control
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={format === f.id}
                    onClick={() => setFormat(f.id)}
                  >
                    <i className={f.id} aria-hidden="true" />
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {profile && profile.data.proof.length > 3 && (
              <div className="row">
                <span>Results to show</span>
                <div className="chips">
                  {profile.data.proof.map((p, i) => {
                    const on = picks.includes(i)
                    return (
                      <button
                        // biome-ignore lint/suspicious/noArrayIndexKey: proof items are positional
                        key={i}
                        type="button"
                        aria-pressed={on}
                        disabled={!on && picks.length >= 3}
                        title={`${p.value} ${p.label}${p.where ? `, ${p.where}` : ''}`}
                        onClick={() => setPicks(on ? picks.filter((x) => x !== i) : [...picks, i])}
                      >
                        {p.value} {p.label}
                      </button>
                    )
                  })}
                  <small>
                    {picks.length
                      ? `${picks.length} of 3 chosen`
                      : 'Pick up to 3, or let coldopen choose'}
                  </small>
                </div>
              </div>
            )}

            {!many && (
              <label className="row">
                <span>Job post</span>
                <textarea
                  value={job}
                  onChange={(e) => setJob(e.target.value)}
                  rows={2}
                  placeholder="If you pasted the company’s website above: the job’s link or its description"
                />
              </label>
            )}

            {!visitor && (
              <label className="row check">
                <span>Several companies</span>
                <span className="inline">
                  <input
                    type="checkbox"
                    checked={many}
                    onChange={(e) => setMany(e.target.checked)}
                  />
                  One film each, from a list
                </span>
              </label>
            )}
          </div>
        )}

        {make.error && <p className="error">{make.error.message}</p>}
        {batch && (
          <p className="note">
            {batch.count} films started.{' '}
            <a
              href={`/v1/batches/${batch.id}/results.csv`}
              onClick={(e) => downloadCsv(e, batch.id)}
            >
              Download their links as a CSV
            </a>{' '}
            once they finish.
          </p>
        )}
      </form>
    </section>
  )
}

function Films({
  list,
  open,
  onOpen,
}: {
  list: Film[]
  open: string | null
  onOpen: (id: string) => void
}) {
  if (list.length === 0)
    return (
      <section className="films empty">
        <p>Your first film will appear here as it’s made.</p>
      </section>
    )
  return (
    <section className="films" aria-labelledby="films-title">
      <div className="films-head">
        <h2 id="films-title">Your films</h2>
        <ReplyRate />
      </div>
      <ul>
        {list.map((f) => (
          <li key={f.id}>
            <FilmRow
              film={f}
              name={nameOf(f, list)}
              active={open === f.id}
              onOpen={() => onOpen(f.id)}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** An edit is still rendering before its own research names the company: borrow the first film's. */
export function nameOf(f: Film, list: Film[]): string | undefined {
  return (
    f.company ??
    (f.editOf ? (list.find((x) => x.id === f.editOf)?.company ?? undefined) : undefined)
  )
}

/** "8 sent, 2 replied (25%)": the number that says whether it's working */
function ReplyRate() {
  const q = useQuery({
    queryKey: ['outreach'],
    queryFn: () => api<OutreachSummary>('/v1/outreach'),
  })
  const o = q.data
  if (!o || o.sent === 0) return null
  return (
    <p className="rate" aria-live="polite">
      {o.sent} sent, {o.replied} replied
      {o.replyRate !== null && <b> {Math.round(o.replyRate * 100)}%</b>}
    </p>
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
