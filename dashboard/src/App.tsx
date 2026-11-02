import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { AccountMenu, FramedNotice, StatsPanel } from './Account.tsx'
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
import { Board } from './Board.tsx'
import { FilmPanel } from './FilmPanel.tsx'
import { FilmRow } from './FilmRow.tsx'
import { FollowUps } from './FollowUps.tsx'
import { GettingStarted, GuidePanel, ToolsPanel } from './Guide.tsx'
import { Jobs } from './Jobs.tsx'
import { Onboarding } from './Onboarding.tsx'
import { ProfileEditor } from './ProfileEditor.tsx'
import { ProfilesPage } from './Profiles.tsx'
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

  const place = usePlace()
  const followups = useQuery({
    queryKey: ['followups'],
    queryFn: () => api<{ data: unknown[] }>('/v1/followups'),
  })
  const dueCount = followups.data?.data.length ?? 0
  const onboarding = !loading && noProfile && list.length === 0
  const name = (f: Film) => nameOf(f, list)

  return (
    <div className="app shell">
      <aside className="side" aria-label="coldopen">
        <a className="wordmark" href="#today" aria-label="coldopen, Today">
          <i aria-hidden="true" />
          coldopen
          <span className="beta">Beta</span>
        </a>
        <nav className="places" aria-label="Pages">
          {PLACES.map((p) => (
            <a key={p.id} href={`#${p.id}`} aria-current={place === p.id ? 'page' : undefined}>
              {p.label}
              {p.id === 'today' && dueCount > 0 && <span className="count due">{dueCount}</span>}
              {p.id === 'films' && list.length > 0 && <span className="count">{list.length}</span>}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <button type="button" className="quiet-link" onClick={() => setSide('guide')}>
            How it works
          </button>
          {me.data?.contact && (
            <a
              className="quiet-link"
              href={`mailto:${me.data.contact}?subject=${encodeURIComponent('coldopen feedback')}`}
            >
              Send feedback
            </a>
          )}
          {me.data && <AccountMenu me={me.data} onStats={() => setStats(true)} />}
        </div>
      </aside>

      <div className="main">
        <main className="page">
          {hosted && <FramedNotice />}
          {signinError && <p className="error">Sign-in didn't work: {signinError}</p>}
          {unauthorized && !hosted && <KeyForm />}

          {loading ? null : onboarding ? (
            <Onboarding
              hosted={hosted}
              onDraft={(draft, notice) => setEditing({ profile: null, draft, notice })}
              onBlank={(draft, notice) => setEditing({ profile: null, draft, notice })}
            />
          ) : place === 'jobs' ? (
            <>
              <PageTitle
                title="Jobs for you"
                sub="Open roles from 70 companies’ job boards, ranked by how well you fit."
              />
              <Jobs onMade={setOpen} variant="full" />
            </>
          ) : place === 'films' ? (
            <>
              <PageTitle
                title="Your films"
                sub="Every film by where it stands. Open one to send it, or to mark what happened."
                aside={<ReplyRate />}
              />
              {list.length === 0 ? (
                <p className="empty">
                  No films yet. <a href="#today">Make your first one</a>; it takes about a minute.
                </p>
              ) : (
                <Board list={list} name={name} open={open} onOpen={setOpen} />
              )}
            </>
          ) : place === 'profile' ? (
            <>
              <PageTitle
                title="Profile"
                sub="Who your films are from, and the tools coldopen works with."
              />
              <ProfilesPage
                me={me.data}
                profiles={profiles.data?.data ?? []}
                onEdit={(p) => setEditing({ profile: p })}
                onNew={() => setEditing({ profile: null })}
              />
            </>
          ) : (
            <>
              <Composer
                me={me.data}
                profiles={profiles.data?.data ?? []}
                onMade={setOpen}
                onEdit={(p) => setEditing({ profile: p })}
              />
              <GettingStarted films={list} onOpen={setOpen} onGuide={() => setSide('guide')} />
              <FollowUps onOpen={setOpen} />
              <Jobs onMade={setOpen} variant="preview" />
              <Recent list={list} name={name} open={open} onOpen={setOpen} />
            </>
          )}
        </main>
      </div>

      <nav className="tabbar" aria-label="Pages">
        {PLACES.map((p) => (
          <a key={p.id} href={`#${p.id}`} aria-current={place === p.id ? 'page' : undefined}>
            {p.label}
            {p.id === 'today' && dueCount > 0 && <span className="count due">{dueCount}</span>}
          </a>
        ))}
      </nav>

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
        <GuidePanel
          onClose={() => setSide(null)}
          onTools={() => {
            setSide(null)
            window.location.hash = 'profile'
          }}
        />
      )}
      {side === 'tools' && <ToolsPanel me={me.data} onClose={() => setSide(null)} />}
    </div>
  )
}

/* ------------------------------------------------------------------ places */

type Place = 'today' | 'jobs' | 'films' | 'profile'
const PLACES: { id: Place; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'films', label: 'Films' },
  { id: 'profile', label: 'Profile' },
]

/** The page in the address (#jobs), so back, forward and bookmarks work */
const readPlace = (): Place => {
  const h = window.location.hash.slice(1)
  return PLACES.some((p) => p.id === h) ? (h as Place) : 'today'
}

function usePlace(): Place {
  const read = readPlace
  const [place, setPlace] = useState(read)
  useEffect(() => {
    const on = () => {
      setPlace(read())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return place
}

function PageTitle({ title, sub, aside }: { title: string; sub: string; aside?: React.ReactNode }) {
  return (
    <header className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{sub}</p>
      </div>
      {aside}
    </header>
  )
}

/** The newest few films on Today, with the way to the whole board */
function Recent({
  list,
  name,
  open,
  onOpen,
}: {
  list: Film[]
  name: (f: Film) => string | undefined
  open: string | null
  onOpen: (id: string) => void
}) {
  if (list.length === 0) return null
  return (
    <section className="films" aria-labelledby="recent-title">
      <div className="films-head">
        <h2 id="recent-title">Latest films</h2>
        <a className="see-all" href="#films">
          All {list.length} films
        </a>
      </div>
      <ul>
        {list.slice(0, 4).map((f) => (
          <li key={f.id}>
            <FilmRow film={f} name={name(f)} active={open === f.id} onOpen={() => onOpen(f.id)} />
          </li>
        ))}
      </ul>
    </section>
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
}: {
  me: Me | undefined
  profiles: Profile[]
  onMade: (id: string) => void
  onEdit: (p: Profile) => void
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
          {profiles.length > 0 && (
            <label className="from">
              <span>Film from</span>
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
            </label>
          )}
          {profile && (
            <button type="button" className="quiet-link" onClick={() => onEdit(profile)}>
              Edit profile
            </button>
          )}
          {left !== null && (
            <span className={left === 0 ? 'out' : ''}>
              {left === 0 ? 'No films left today' : `${left} left today`}
            </span>
          )}
          <button
            type="button"
            className="quiet-link"
            aria-expanded={more}
            aria-controls="composer-more"
            onClick={() => setMore(!more)}
          >
            {more ? 'Fewer options' : 'More options'}
          </button>
        </div>

        {more && (
          <div className="more" id="composer-more">
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
