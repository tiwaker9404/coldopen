import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  ago,
  api,
  type FilmDetail,
  type Messages,
  media,
  send,
  type ViewSession,
  type ViewSummary,
} from './api.ts'

const STEP_LABEL: Record<string, string> = {
  research: 'Read the homepage',
  script: 'Wrote the script',
  compose: 'Matched the brand',
  encode: 'Encoded film, GIF and poster',
  'slack-reply': 'Posted to Slack',
}

function stepLabel(key: string) {
  if (key.startsWith('render:')) return `Rendered scene ${Number(key.split(':')[1]) + 1}`
  if (key.startsWith('script-')) return `Script draft ${key.split('-')[1]}`
  return STEP_LABEL[key] ?? key
}

function Copy({ text, label, done = 'Copied' }: { text: string; label: string; done?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setOk(true)
        setTimeout(() => setOk(false), 1600)
      }}
    >
      {ok ? done : label}
    </button>
  )
}

export function FilmPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const ref = useRef<HTMLDivElement>(null)
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
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop closes; Escape and the Close button do the same
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users close with Escape or the Close button
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-label="Film"
        tabIndex={-1}
        ref={ref}
      >
        <div className="panel-head">
          <div>
            <h2>{f?.company ?? f?.url ?? 'Loading…'}</h2>
            {f && <p className="muted">{f.host ?? f.url}</p>}
          </div>
          <button type="button" className="close" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>

        {f?.status === 'succeeded' && f.files && (
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
            <div className="actions">
              {f.share && <Copy text={f.share} label="Copy share link" />}
              {f.embed && (
                <Copy text={f.embed} label="Copy email GIF" done="Paste into your email" />
              )}
              <a className="button" href={media(f, 'film')} download={`${f.company}.mp4`}>
                Download MP4
              </a>
              <a className="button" href={media(f, 'preview.gif')} download={`${f.company}.gif`}>
                GIF
              </a>
              {f.share && (
                // ?preview: your own visits aren't counted as views
                <a className="button" href={`${f.share}?preview`} target="_blank" rel="noreferrer">
                  Open share page
                </a>
              )}
            </div>
          </>
        )}

        {live && (
          <div className="live">
            <span className="tally" aria-hidden="true" />
            <div>
              <p className="live-label">{f.progress?.label ?? 'Waiting for a renderer'}</p>
              <div
                className="bar"
                role="progressbar"
                aria-valuenow={f.progress?.percent ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <b
                  style={{ width: `${f.progress?.percent ?? (f.status === 'queued' ? 0 : 4)}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {f?.status === 'succeeded' && <SendIt id={f.id} />}
        {f?.status === 'succeeded' && <Views id={f.id} />}

        {f?.status === 'failed' && (
          <div className="failure">
            <p>{f.error}</p>
            {f.errorCode !== 'non_retryable' && (
              <button type="button" onClick={() => retry.mutate()}>
                Resume from where it stopped
              </button>
            )}
          </div>
        )}

        {f?.script && (
          <section>
            <h3>Script</h3>
            <dl className="script">
              <dt>Hook</dt>
              <dd>{f.script.hook}</dd>
              <dt>Noticed</dt>
              <dd>{f.script.noticed}</dd>
              <dt>Why it matters</dt>
              <dd>{f.script.insight.why}</dd>
              <dt>Pitch</dt>
              <dd>
                {f.script.pitch.headline}
                <ul>
                  {f.script.pitch.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </dd>
              <dt>Ask</dt>
              <dd>{f.script.cta}</dd>
            </dl>
            {f.scriptMeta && (
              <p className="muted small">
                {f.scriptMeta.model === 'deterministic'
                  ? 'Written by the built-in writer. Connect a model for more natural copy.'
                  : `Written by ${f.scriptMeta.model} in ${f.scriptMeta.rounds} draft${f.scriptMeta.rounds > 1 ? 's' : ''}${
                      f.scriptMeta.violations.flat().length
                        ? `; ${f.scriptMeta.violations.flat().length} taste-rule issue${f.scriptMeta.violations.flat().length > 1 ? 's' : ''} caught and fixed`
                        : ''
                    }.`}
              </p>
            )}
          </section>
        )}

        {f && f.steps.length > 0 && (
          <section>
            <h3>How it was made</h3>
            <ol className="steps-list">
              {f.steps.map((s) => (
                <li key={s.key} className={s.status}>
                  <span>{stepLabel(s.key)}</span>
                  <span className="muted">
                    {s.replays > 0
                      ? 'kept after restart'
                      : s.durationMs != null
                        ? `${(s.durationMs / 1000).toFixed(1)}s`
                        : s.status}
                  </span>
                </li>
              ))}
            </ol>
            {f.attempts > 1 && (
              <p className="muted small">
                A renderer restarted during this film. Finished work was kept, and only the
                remaining scenes were rendered.
              </p>
            )}
          </section>
        )}
      </aside>
    </div>
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
  return (
    <section>
      <h3>Who watched</h3>
      {s.opens === 0 ? (
        <p className="muted small">
          Nobody has opened the share page yet. Link previews and email scanners aren't counted, and
          neither are your own visits from this page.
        </p>
      ) : (
        <>
          <dl className="views-sum">
            <div>
              <dt>Opened</dt>
              <dd>{s.opens}</dd>
            </div>
            <div>
              <dt>Played</dt>
              <dd>{s.plays}</dd>
            </div>
            <div>
              <dt>Finished</dt>
              <dd>{s.finishes}</dd>
            </div>
            <div>
              <dt>People</dt>
              <dd>{s.viewers}</dd>
            </div>
          </dl>
          <ol className="views-list">
            {v.sessions.slice(0, 12).map((x) => (
              <li key={x.session}>
                <span>
                  {x.finished
                    ? 'Watched to the end'
                    : x.played
                      ? `Watched ${Math.round(x.seconds)}s`
                      : 'Opened, didn’t play'}
                </span>
                <span className="muted">
                  {[x.device, x.referrer ? `via ${x.referrer}` : null, x.country, ago(x.lastSeen)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  )
}

/** The messages that go with the film, ready to copy. */
function SendIt({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['messages', id],
    queryFn: () => api<Messages>(`/v1/films/${id}/messages`),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const [tab, setTab] = useState<'email' | 'linkedin' | 'followUp'>('email')
  const m = q.data
  if (!m) return null
  const text =
    tab === 'email'
      ? `${m.email.subject}\n\n${m.email.body}`
      : tab === 'linkedin'
        ? m.linkedin
        : m.followUp
  return (
    <section>
      <h3>Send it</h3>
      <div className="segmented msg-tabs" role="tablist" aria-label="Message">
        {(
          [
            ['email', 'Email'],
            ['linkedin', 'LinkedIn note'],
            ['followUp', 'Follow-up'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={tab === k ? 'on' : ''}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'email' && <p className="msg-subject">{m.email.subject}</p>}
      <pre className="msg">{tab === 'email' ? m.email.body : text}</pre>
      <div className="actions">
        <Copy text={tab === 'email' ? m.email.body : text} label="Copy message" />
        {tab === 'email' && <Copy text={m.email.subject} label="Copy subject" />}
        {tab === 'linkedin' && (
          <span className="muted small">{m.linkedin.length} of 300 characters</span>
        )}
      </div>
      <p className="muted small">Replace [First name], read it once, and it's ready to send.</p>
    </section>
  )
}
