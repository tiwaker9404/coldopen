import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  ago,
  api,
  downloadUrl,
  type Film,
  type FilmDetail,
  type FoundEmails,
  fileName,
  LIMITS,
  type Messages,
  media,
  OUTREACH_LABEL,
  type People,
  type ScriptEdit,
  send,
  type ViewSession,
  type ViewSummary,
} from './api.ts'
import { host, Outreach } from './FilmRow.tsx'
import { canNotify, Out, useToast } from './ui.tsx'

const STEP_LABEL: Record<string, string> = {
  job: 'Read the job post',
  research: 'Read their site',
  script: 'Wrote the script',
  compose: 'Matched their brand',
  encode: 'Encoded the film, GIF and poster',
  'slack-reply': 'Posted to Slack',
}
function stepLabel(key: string) {
  if (key.startsWith('render:')) return `Rendered scene ${Number(key.split(':')[1]) + 1}`
  if (key.startsWith('script-')) return `Script draft ${key.split('-')[1]}`
  return STEP_LABEL[key] ?? key
}

export function Copy({
  text,
  label,
  done = 'Copied',
  className,
}: {
  text: string
  label: string
  done?: string
  className?: string
}) {
  const [ok, setOk] = useState(false)
  const toast = useToast()
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setOk(true)
          toast({ text: done })
          setTimeout(() => setOk(false), 1600)
        } catch {
          toast({ text: 'Your browser blocked copying. Select the text and copy it instead.' })
        }
      }}
    >
      {ok ? 'Copied' : label}
    </button>
  )
}

type Tab = 'send' | 'script' | 'views' | 'details'

export function FilmPanel({
  id,
  name,
  onClose,
  onOpen,
}: {
  id: string
  /** the company, when the film doesn't know it yet */
  name?: string
  onClose: () => void
  onOpen: (id: string) => void
}) {
  const qc = useQueryClient()
  const ref = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>('send')
  const q = useQuery({
    queryKey: ['film', id],
    queryFn: () => api<FilmDetail>(`/v1/films/${id}`),
    refetchInterval: (s) =>
      s.state.data && ['queued', 'running'].includes(s.state.data.status) ? 1000 : false,
  })
  const retry = useMutation({
    mutationFn: () => send('POST', `/v1/films/${id}/retry`),
    onSuccess: () => void qc.invalidateQueries(),
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const f = q.data
  const live = f && (f.status === 'queued' || f.status === 'running')
  const done = f?.status === 'succeeded'
  const tabs: [Tab, string][] = done
    ? [
        ['send', 'Send'],
        ['script', 'Script'],
        ['views', 'Views'],
        ['details', 'How it was made'],
      ]
    : []

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop closes; Escape and the Close button do the same
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users close with Escape or the Close button
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={f?.company ?? name ?? 'Film'}
        tabIndex={-1}
        ref={ref}
      >
        <header className="drawer-head">
          <div>
            <h2>{f?.company ?? name ?? (f ? host(f.url) : '')}</h2>
            {f && (
              <p>
                {f.job?.title ? `${f.job.title}, ` : ''}
                {f.host ?? host(f.url)}
              </p>
            )}
          </div>
          {done && f && <Outreach film={f} />}
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </header>

        {done && f.files && (
          <>
            <video
              key={f.id}
              className={`player ${f.format}`}
              src={media(f, 'film')}
              poster={media(f, 'poster.jpg')}
              controls
              autoPlay
              muted
              playsInline
            />
            <FilmActions film={f} />
          </>
        )}

        {live && <Progress film={f} />}

        {f?.status === 'failed' && (
          <div className="failure">
            <p>{sentence(f.error ?? 'Something went wrong while making this film.')}</p>
            {f.errorCode !== 'non_retryable' && (
              <button type="button" onClick={() => retry.mutate()} disabled={retry.isPending}>
                Try again from where it stopped
              </button>
            )}
          </div>
        )}

        {tabs.length > 0 && (
          <div className="tabs" role="tablist" aria-label="About this film">
            {tabs.map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                id={`tab-${k}`}
                aria-selected={tab === k}
                aria-controls={`pane-${k}`}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {done && (
          <div className="pane" role="tabpanel" id={`pane-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'send' && <SendSteps film={f} />}
            {tab === 'script' && <ScriptEditor film={f} onMade={onOpen} />}
            {tab === 'views' && <Views id={f.id} />}
            {tab === 'details' && <Details film={f} />}
          </div>
        )}
        {f && !done && f.steps.length > 0 && <Details film={f} />}
      </aside>
    </div>
  )
}

const sentence = (s: string) => {
  const t = s.trim()
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}`
}

/** Offers a system notification for when the film is ready, once. */
function NotifyMe() {
  const [state, setState] = useState(() => (canNotify() ? Notification.permission : 'denied'))
  if (state !== 'default') return null
  return (
    <button
      type="button"
      className="link"
      onClick={async () => setState(await Notification.requestPermission())}
    >
      Notify me when it’s ready, so I can use another tab
    </button>
  )
}

function Progress({ film }: { film: Film }) {
  const pct = film.progress?.percent ?? 0
  return (
    <div className="progress">
      <span className="rec" aria-hidden="true" />
      <div>
        <p>{film.progress?.label ?? 'Waiting for a renderer. This can take a minute.'}</p>
        <NotifyMe />
        <div
          className="meter"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <b style={{ width: `${film.status === 'queued' ? 0 : Math.max(3, pct)}%` }} />
        </div>
      </div>
    </div>
  )
}

/**
 * The buttons under the film, each saying what it does: the share link is what you send; the
 * video and GIF save under the company's name.
 */
function FilmActions({ film: f }: { film: FilmDetail }) {
  const [canShare] = useState(
    () => typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches,
  )
  return (
    <div className="film-actions">
      <div className="actions">
        {f.share && (
          <Copy
            className="primary"
            text={f.share}
            label="Copy share link"
            done="Share link copied"
          />
        )}
        {canShare && f.share && (
          <button
            type="button"
            onClick={() =>
              navigator.share({ title: `A film for ${f.company}`, url: f.share! }).catch(() => {})
            }
          >
            Share…
          </button>
        )}
        <a className="button" href={downloadUrl(f, 'film')} download={`${fileName(f)}.mp4`}>
          Download MP4
        </a>
        {f.embed && (
          <Copy
            text={f.embed}
            label="Copy GIF for email"
            done="GIF copied. Paste it into your email"
          />
        )}
      </div>
      <p className="explain">
        The share link opens a page with the film, where you’ll see who watched.{' '}
        {f.share && (
          // ?preview: your own visits aren't counted as views
          <a className="link" href={`${f.share}?preview`} target="_blank" rel="noreferrer">
            Preview it <Out />
          </a>
        )}
        <br />
        The MP4 saves as “{fileName(f)}.mp4”. The GIF plays inside Gmail or Outlook and links to the
        film.
      </p>
    </div>
  )
}

/**
 * Sending, as the three things to do in order: pick who, send the message, mark it sent.
 * Nothing here sends anything by itself; every link says where it goes.
 */
function SendSteps({ film }: { film: FilmDetail }) {
  const qc = useQueryClient()
  const toast = useToast()
  const status = film.outreach?.status ?? null
  const mark = useMutation({
    mutationFn: (s: 'sent' | null) => send('PUT', `/v1/films/${film.id}/outreach`, { status: s }),
    onSuccess: (_r, s) => {
      void qc.invalidateQueries({ queryKey: ['films'] })
      void qc.invalidateQueries({ queryKey: ['film', film.id] })
      void qc.invalidateQueries({ queryKey: ['outreach'] })
      if (s)
        toast({
          text: `Marked ${film.company ?? 'it'} as sent. Come back and mark it when they reply.`,
        })
    },
  })
  const days = film.outreach
    ? Math.floor((Date.now() - Date.parse(film.outreach.sentAt)) / 86_400_000)
    : 0
  return (
    <ol className="steps">
      <li>
        <WhoToSend film={film} />
      </li>
      <li>
        <Message
          id={film.id}
          to={film.recipient?.email}
          followUp={status === 'sent' && days >= 4}
          last={(film.outreach?.followUps ?? 0) >= 1}
        />
      </li>
      <li>
        <section className="block">
          <h3>Mark it sent</h3>
          {status ? (
            <p>
              {status === 'sent'
                ? `Sent ${days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}. ${
                    days >= 4
                      ? 'No reply yet: the follow-up message above is ready.'
                      : 'When they answer, change Sent to Replied at the top of this panel.'
                  }`
                : `Marked ${OUTREACH_LABEL[status].toLowerCase()}. Change it any time at the top of this panel.`}
            </p>
          ) : (
            <>
              <p>So coldopen can count your reply rate and remind you to follow up.</p>
              <div className="actions">
                <button type="button" onClick={() => mark.mutate('sent')} disabled={mark.isPending}>
                  I sent it
                </button>
              </div>
            </>
          )}
        </section>
      </li>
    </ol>
  )
}

/** Who to send it to: people they know there first, then LinkedIn searches they run themselves. */
function WhoToSend({ film }: { film: FilmDetail }) {
  const id = film.id
  const [intro, setIntro] = useState<string | null>(null)
  const messages = useQuery({
    queryKey: ['messages', id],
    queryFn: () => api<Messages>(`/v1/films/${id}/messages`),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const q = useQuery({
    queryKey: ['people', id],
    queryFn: () => api<People>(`/v1/films/${id}/people`),
  })
  const p = q.data
  if (!p)
    return (
      <section className="block">
        <h3>Pick one or two people</h3>
      </section>
    )
  return (
    <section className="block">
      <h3>Pick one or two people</h3>
      {p.known.length > 0 && (
        <>
          <p>
            You know {p.known.length === 1 ? 'someone' : `${p.known.length} people`} at {p.company}.
            Ask {p.known.length === 1 ? 'them' : 'one of them'} for an intro first; it beats a cold
            message.
          </p>
          <ul className="people">
            {p.known.map((c) => {
              const key = `${c.name}-${c.url}`
              const text = messages.data?.intro.replaceAll(
                '[First name]',
                c.name.split(/\s+/)[0] ?? c.name,
              )
              return (
                <li key={key} className={intro === key ? 'open' : ''}>
                  <span>
                    <b>{c.name}</b>
                    <small>{c.position ?? c.company}</small>
                  </span>
                  <button
                    type="button"
                    className="link"
                    aria-expanded={intro === key}
                    onClick={() => setIntro(intro === key ? null : key)}
                  >
                    Ask for an intro
                  </button>
                  {intro === key && text && (
                    <div className="intro">
                      <pre>{text}</pre>
                      <div className="actions">
                        <Copy className="primary" text={text} label="Copy message" done="Copied" />
                        {c.url && (
                          <a className="button" href={c.url} target="_blank" rel="noreferrer">
                            Open {c.name.split(/\s+/)[0]}’s LinkedIn <Out />
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
      <p>
        {p.known.length ? 'Or write to someone new. ' : ''}Each search opens LinkedIn in a new tab,
        filtered to {p.company}. You stay in control: coldopen never messages anyone for you.
      </p>
      <ul className="who-list">
        {p.searches.map((s) => (
          <li key={s.url}>
            <span>
              <b>{s.label}</b>
              <small>{s.hint}</small>
            </span>
            <a className="button" href={s.url} target="_blank" rel="noreferrer">
              Search LinkedIn <Out />
            </a>
          </li>
        ))}
      </ul>
      {p.connections === 0 && (
        <p className="small muted">
          Upload your LinkedIn connections on your Profile page to see who you already know here.
        </p>
      )}
      <Recipient film={film} />
    </section>
  )
}

/**
 * Who this film is for: their name, and their email, found by Hunter (with your key) or picked
 * from the usual patterns. Saved, it greets them by name and addresses the drafts.
 */
function Recipient({ film }: { film: FilmDetail }) {
  const qc = useQueryClient()
  const saved = film.recipient
  const [editing, setEditing] = useState(!saved)
  const [name, setName] = useState(saved?.name ?? '')
  const [email, setEmail] = useState(saved?.email ?? '')
  const find = useMutation({
    mutationFn: () =>
      send<FoundEmails>('POST', `/v1/films/${film.id}/find-email`, { name: name.trim() }),
    onSuccess: (r) => {
      if (r.found && !email) setEmail(r.found.email)
    },
  })
  const save = useMutation({
    mutationFn: (body: { name: string; email?: string } | null) =>
      send<Film>('PUT', `/v1/films/${film.id}/recipient`, body),
    onSuccess: () => {
      setEditing(false)
      void qc.invalidateQueries({ queryKey: ['film', film.id] })
      void qc.invalidateQueries({ queryKey: ['messages', film.id] })
      void qc.invalidateQueries({ queryKey: ['followups'] })
    },
  })
  if (saved && !editing)
    return (
      <div className="recipient saved">
        <span>
          Writing to <b>{saved.name}</b>
          {saved.email && <small>{saved.email}</small>}
        </span>
        <button type="button" className="link" onClick={() => setEditing(true)}>
          Change
        </button>
      </div>
    )
  const r = find.data
  return (
    <form
      className="recipient"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim())
          save.mutate({ name: name.trim(), ...(email.trim() ? { email: email.trim() } : {}) })
      }}
    >
      <h4>Who are you writing to?</h4>
      <p className="small muted">
        Their name puts “Hi {name.trim().split(/\s+/)[0] || 'Priya'},” in the messages, and
        follow-ups open already addressed.
      </p>
      <div className="recipient-row">
        <label>
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Priya Shah"
            autoComplete="off"
          />
        </label>
        <label>
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="optional"
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          disabled={name.trim().length < 2 || find.isPending}
          onClick={() => find.mutate()}
        >
          {find.isPending ? 'Looking…' : 'Find email'}
        </button>
      </div>
      {r && (
        <div className="emails" aria-live="polite">
          {r.found && (
            <button
              type="button"
              className={`email-pick${email === r.found.email ? ' on' : ''}`}
              onClick={() => setEmail(r.found!.email)}
            >
              <b>{r.found.email}</b>
              <small>
                Found by Hunter
                {r.found.score !== undefined && ` · ${r.found.score}% sure`}
                {r.found.status === 'valid' && ' · verified'}
              </small>
            </button>
          )}
          {r.note && <p className="small muted">{r.note}</p>}
          <p className="small muted">
            {r.found ? 'Or one of the usual patterns at ' : 'Likely addresses at '}
            {r.domain}
            {r.hunter ? ':' : ' (guesses; add a Hunter key on your Profile page to look it up):'}
          </p>
          <div className="chips">
            {r.guesses.map((g) => (
              <button
                key={g.email}
                type="button"
                aria-pressed={email === g.email}
                onClick={() => setEmail(g.email)}
              >
                {g.email}
              </button>
            ))}
          </div>
        </div>
      )}
      {(find.error || save.error) && <p className="error">{(find.error ?? save.error)!.message}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={!name.trim() || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {saved && (
          <button type="button" className="link" onClick={() => save.mutate(null)}>
            Clear
          </button>
        )}
      </div>
    </form>
  )
}

/** The message, and where to send it from: Gmail, Outlook or the mail app, as a ready draft. */
function Message({
  id,
  to,
  followUp,
  last = false,
}: {
  id: string
  to?: string | undefined
  followUp: boolean
  /** one follow-up already went out: the next is the short last note */
  last?: boolean
}) {
  const q = useQuery({
    queryKey: ['messages', id],
    queryFn: () => api<Messages>(`/v1/films/${id}/messages`),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const [kind, setKind] = useState<'email' | 'linkedin' | 'followUp'>(
    followUp ? 'followUp' : 'email',
  )
  const m = q.data
  if (!m)
    return (
      <section className="block">
        <h3>Send the message</h3>
      </section>
    )
  const body =
    kind === 'email'
      ? m.email.body
      : kind === 'linkedin'
        ? m.linkedin
        : last
          ? m.lastNote
          : m.followUp
  const subject = kind === 'followUp' ? `Re: ${m.email.subject}` : m.email.subject
  const enc = encodeURIComponent
  return (
    <section className="block">
      <div className="block-head">
        <h3>Send the message</h3>
        <div className="switch" role="radiogroup" aria-label="Where you're sending it">
          {(
            [
              ['email', 'Email'],
              ['linkedin', 'LinkedIn note'],
              ['followUp', 'Follow-up'],
            ] as const
          ).map(([k, label]) => (
            // biome-ignore lint/a11y/useSemanticElements: radio-styled buttons are the WAI-ARIA pattern for this control
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="small muted">
        {kind === 'email'
          ? 'Your first message, with the film’s link in it.'
          : kind === 'linkedin'
            ? 'For a LinkedIn connection request, which allows 300 characters.'
            : last
              ? 'Your last note: short, and easy to answer either way. After this, let it go.'
              : 'A friendly nudge for 4 or 5 days later, if you haven’t heard back.'}
      </p>
      <div className="letter">
        {kind !== 'linkedin' && (
          <p className="subject">
            <span>Subject</span> {subject}
          </p>
        )}
        <pre>{body}</pre>
      </div>
      <p className="small">
        {body.includes('[First name]') ? (
          <>
            Replace <b>[First name]</b> before sending, or say who it’s for above.
          </>
        ) : (
          to && `Opens addressed to ${to}.`
        )}
        {kind === 'linkedin' && ` ${m.linkedin.length} of 300 characters.`}
      </p>
      {kind === 'linkedin' ? (
        <div className="actions">
          <Copy className="primary" text={body} label="Copy note" done="Note copied" />
          <small>Then on their LinkedIn profile: Connect, Add a note, paste.</small>
        </div>
      ) : (
        <div className="actions">
          <a
            className="button primary-link"
            href={`https://mail.google.com/mail/?view=cm&fs=1${to ? `&to=${enc(to)}` : ''}&su=${enc(subject)}&body=${enc(body)}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Gmail <Out />
          </a>
          <a
            className="button"
            href={`https://outlook.office.com/mail/deeplink/compose?${to ? `to=${enc(to)}&` : ''}subject=${enc(subject)}&body=${enc(body)}`}
            target="_blank"
            rel="noreferrer"
          >
            Outlook <Out />
          </a>
          <a
            className="button"
            href={`mailto:${to ? enc(to) : ''}?subject=${enc(subject)}&body=${enc(body)}`}
          >
            Mail app
          </a>
          <Copy text={`${subject}\n\n${body}`} label="Copy" done="Message copied" />
        </div>
      )}
    </section>
  )
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

/** Rewrite any line and re-render, without researching the company again. */
function ScriptEditor({ film, onMade }: { film: FilmDetail; onMade: (id: string) => void }) {
  const qc = useQueryClient()
  const s = film.script
  const start = () =>
    s
      ? {
          hook: s.hook,
          noticed: s.noticed,
          why: s.insight.why,
          headline: s.pitch.headline,
          points: s.pitch.points,
          cta: s.cta,
        }
      : null
  const [e, setE] = useState(start)
  // a new film opened in the same panel starts from its own script
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the film changes
  useEffect(() => setE(start()), [film.id])
  const save = useMutation({
    mutationFn: (edit: ScriptEdit) => send<Film>('POST', `/v1/films/${film.id}/edit`, edit),
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: ['films'] })
      onMade(f.id)
    },
  })
  if (!s || !e) return <p className="small muted">This film has no script to show.</p>

  const changed: ScriptEdit = {}
  if (e.hook !== s.hook) changed.hook = e.hook
  if (e.noticed !== s.noticed) changed.noticed = e.noticed
  if (e.why !== s.insight.why) changed.why = e.why
  if (e.headline !== s.pitch.headline) changed.headline = e.headline
  if (e.points.join('\n') !== s.pitch.points.join('\n')) changed.points = e.points
  if (e.cta !== s.cta) changed.cta = e.cta
  const dirty = Object.keys(changed).length > 0

  const field = (
    key: 'hook' | 'noticed' | 'why' | 'headline' | 'cta',
    label: string,
    max: number,
  ) => <Line label={label} max={max} value={e[key]} onChange={(v) => setE({ ...e, [key]: v })} />
  return (
    <form
      className="block script"
      onSubmit={(ev) => {
        ev.preventDefault()
        save.mutate(changed)
      }}
    >
      <p className="small">
        The lines in the film, in order. Change any of them and render it again; their site isn’t
        read again. Numbers still have to come from your profile or their site.
      </p>
      {field('hook', 'Greeting', LIMITS.hook)}
      {field('noticed', 'What you noticed', LIMITS.noticed)}
      {film.highlights?.quote && (
        <p className="quote">
          <span>Shown from their {film.job ? 'job post' : 'site'}</span>“
          {film.highlights.quote.text}”
        </p>
      )}
      {field('why', 'Why it matters', LIMITS.why)}
      {field('headline', 'What you offer', LIMITS.headline)}
      {e.points.map((p, i) => (
        <Line
          // biome-ignore lint/suspicious/noArrayIndexKey: points are positional
          key={i}
          label={`Point ${i + 1}`}
          max={LIMITS.point}
          value={p}
          onChange={(v) => setE({ ...e, points: e.points.map((x, j) => (j === i ? v : x)) })}
        />
      ))}
      {film.highlights?.proof.length ? (
        <div className="results">
          <span>Results shown, word for word from your profile</span>
          <ul>
            {film.highlights.proof.map((p) => (
              <li key={`${p.value}${p.label}`}>
                <b>{p.value}</b> {p.label}
                {p.where ? <small> at {p.where}</small> : null}
              </li>
            ))}
          </ul>
          <small>To show different ones, choose them under Options when you make a film.</small>
        </div>
      ) : null}
      {field('cta', 'The ask', LIMITS.cta)}
      <p className="small muted">
        {film.scriptMeta?.model === 'edited'
          ? 'You edited this script.'
          : film.scriptMeta?.model === 'deterministic'
            ? 'Written by the built-in writer.'
            : film.scriptMeta
              ? `Written by ${film.scriptMeta.model}.`
              : ''}
      </p>
      {save.error && <p className="error">{save.error.message}</p>}
      <div className="actions">
        <button type="submit" className="primary" disabled={!dirty || save.isPending}>
          {save.isPending ? 'Starting…' : 'Render with these lines'}
        </button>
        {dirty && (
          <button type="button" className="link" onClick={() => setE(start())}>
            Undo changes
          </button>
        )}
      </div>
    </form>
  )
}

function Line({
  label,
  max,
  value,
  onChange,
}: {
  label: string
  max: number
  value: string
  onChange: (v: string) => void
}) {
  const n = words(value)
  return (
    <label className="line">
      <span>
        {label}
        <small className={n > max ? 'over' : ''}>
          {n}/{max} words
        </small>
      </span>
      <input value={value} onChange={(ev) => onChange(ev.target.value)} />
    </label>
  )
}

function Views({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['views', id],
    queryFn: () => api<{ summary: ViewSummary; sessions: ViewSession[] }>(`/v1/films/${id}/views`),
    refetchInterval: 15_000,
  })
  const v = q.data
  if (!v) return null
  const s = v.summary
  if (s.opens === 0)
    return (
      <p className="small muted">
        Views show up here the moment someone opens your link. Link previews, email scanners and
        your own visits are left out, so every view is a real person.
      </p>
    )
  return (
    <section className="block">
      <dl className="tally">
        <div>
          <dt>Opened</dt>
          <dd>{s.opens}</dd>
        </div>
        <div>
          <dt>Played</dt>
          <dd>{s.plays}</dd>
        </div>
        <div>
          <dt>Watched to the end</dt>
          <dd>{s.finishes}</dd>
        </div>
        <div>
          <dt>Pressed your button</dt>
          <dd>{s.clicks ?? 0}</dd>
        </div>
        <div>
          <dt>People</dt>
          <dd>{s.viewers}</dd>
        </div>
      </dl>
      <ol className="log">
        {v.sessions.slice(0, 12).map((x) => (
          <li key={x.session}>
            <span>
              {x.finished
                ? 'Watched to the end'
                : x.played
                  ? `Watched ${Math.round(x.seconds)} seconds`
                  : 'Opened the page'}
            </span>
            <small>
              {[
                x.device === 'mobile' ? 'Phone' : 'Computer',
                x.referrer ? `from ${x.referrer}` : null,
                x.country,
                ago(x.lastSeen),
              ]
                .filter(Boolean)
                .join(', ')}
            </small>
          </li>
        ))}
      </ol>
    </section>
  )
}

function Details({ film }: { film: FilmDetail }) {
  return (
    <section className="block">
      <ol className="log">
        {film.steps.map((s) => (
          <li key={s.key} className={s.status}>
            <span>{stepLabel(s.key)}</span>
            <small>
              {s.replays > 0
                ? 'kept after a restart'
                : s.durationMs != null
                  ? `${(s.durationMs / 1000).toFixed(1)} s`
                  : s.status}
            </small>
          </li>
        ))}
      </ol>
      {film.attempts > 1 && (
        <p className="small muted">
          A renderer restarted during this film. Finished work was kept, and only the remaining
          scenes were rendered.
        </p>
      )}
    </section>
  )
}
