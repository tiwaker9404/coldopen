import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  ago,
  api,
  downloadUrl,
  type Film,
  type FilmDetail,
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
        <WhoToSend id={film.id} />
      </li>
      <li>
        <Message id={film.id} followUp={status === 'sent' && days >= 4} />
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
function WhoToSend({ id }: { id: string }) {
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
            {p.known.map((c) => (
              <li key={`${c.name}-${c.url}`}>
                <span>
                  <b>{c.name}</b>
                  <small>{c.position ?? c.company}</small>
                </span>
                {c.url && (
                  <a className="link" href={c.url} target="_blank" rel="noreferrer">
                    LinkedIn profile <Out />
                  </a>
                )}
              </li>
            ))}
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
          Upload your LinkedIn connections under Connect tools to see who you already know here.
        </p>
      )}
    </section>
  )
}

/** The message, and where to send it from: Gmail, Outlook or the mail app, as a ready draft. */
function Message({ id, followUp }: { id: string; followUp: boolean }) {
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
  const body = kind === 'email' ? m.email.body : kind === 'linkedin' ? m.linkedin : m.followUp
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
            : 'A friendly nudge for 4 or 5 days later, if you haven’t heard back. One is all it takes.'}
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
        Replace <b>[First name]</b> before sending.
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
            href={`https://mail.google.com/mail/?view=cm&fs=1&su=${enc(subject)}&body=${enc(body)}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in Gmail <Out />
          </a>
          <a
            className="button"
            href={`https://outlook.office.com/mail/deeplink/compose?subject=${enc(subject)}&body=${enc(body)}`}
            target="_blank"
            rel="noreferrer"
          >
            Outlook <Out />
          </a>
          <a className="button" href={`mailto:?subject=${enc(subject)}&body=${enc(body)}`}>
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
