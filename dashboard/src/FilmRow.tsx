import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ago, type Film, media, OUTREACH_LABEL, type OutreachStatus, send } from './api.ts'

export function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** One film in the list: what it's for, where it stands, and what happened after sending it. */
export function FilmRow({
  film,
  name,
  active,
  onOpen,
}: {
  film: Film
  /** the company, when the film doesn't know it yet */
  name?: string
  active: boolean
  onOpen: () => void
}) {
  const live = film.status === 'queued' || film.status === 'running'
  const pct = film.progress?.percent ?? 0
  return (
    <div className={`film${active ? ' active' : ''}`}>
      <button type="button" className="film-open" onClick={onOpen}>
        <span className={`thumb ${film.format}`}>
          {film.status === 'succeeded' && film.files ? (
            <img src={media(film, 'poster.jpg')} alt="" loading="lazy" />
          ) : (
            <span className={`slate ${film.status}`} aria-hidden="true" />
          )}
        </span>
        <span className="who">
          <b>{name ?? host(film.url)}</b>
          <span>
            {film.job?.title ?? film.host ?? host(film.url)}
            {film.editOf ? ' (edited)' : ''}
          </span>
        </span>
        <span className={`state ${film.status}${due(film) ? ' due' : ''}`}>
          {live ? (
            <>
              <span className="rec" aria-hidden="true" />
              <span>{progressLabel(film)}</span>
              {film.status === 'running' && (
                <span className="meter" aria-hidden="true">
                  <b style={{ width: `${Math.max(4, pct)}%` }} />
                </span>
              )}
            </>
          ) : film.status === 'succeeded' ? (
            watched(film)
          ) : film.status === 'failed' ? (
            'Needs another try. Open to see why'
          ) : (
            'Cancelled'
          )}
        </span>
      </button>
      {film.status === 'succeeded' && <Outreach film={film} />}
    </div>
  )
}

function progressLabel(film: Film): string {
  if (film.status === 'queued') return 'Waiting for a renderer'
  const s = film.progress?.stage
  if (s === 'render') return `Rendering, ${film.progress?.percent ?? 0}%`
  return (
    {
      research: 'Reading their site',
      script: 'Writing the script',
      design: 'Matching their brand',
      encode: 'Finishing',
    }[s ?? ''] ?? 'Starting'
  )
}

/** has anyone watched it yet? */
function watched(film: Film): string {
  const v = film.views
  // sent, no answer after 4 days: time for the one follow-up
  if (film.outreach?.status === 'sent') {
    const days = Math.floor((Date.now() - Date.parse(film.outreach.sentAt)) / 86_400_000)
    if (days >= 4) return `No reply in ${days} days. Time to follow up`
  }
  if (!v || v.opens === 0) return 'Ready, not opened yet'
  if (v.plays === 0) return `Opened ${v.opens === 1 ? 'once' : `${v.opens} times`}, not played`
  const what =
    v.finishes > 0 ? 'Watched to the end' : `Watched ${v.plays === 1 ? 'once' : `${v.plays} times`}`
  return `${what}${v.lastSeen ? `, ${ago(v.lastSeen)}` : ''}`
}

/** Not sent / Sent / Replied / Interview / No reply, right in the list, like a job tracker. */
export function Outreach({ film }: { film: Film }) {
  const qc = useQueryClient()
  const mark = useMutation({
    mutationFn: (s: OutreachStatus | null) =>
      send('PUT', `/v1/films/${film.id}/outreach`, { status: s }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['films'] })
      void qc.invalidateQueries({ queryKey: ['film', film.id] })
      void qc.invalidateQueries({ queryKey: ['outreach'] })
    },
  })
  const value = mark.isPending ? (mark.variables ?? '') : (film.outreach?.status ?? '')
  return (
    <label className={`outreach ${value || 'none'}`}>
      <span className="sr">What happened with {film.company ?? 'this film'}</span>
      <select
        value={value}
        onChange={(e) => mark.mutate((e.target.value || null) as OutreachStatus | null)}
      >
        <option value="">Not sent</option>
        {(Object.keys(OUTREACH_LABEL) as OutreachStatus[]).map((k) => (
          <option key={k} value={k}>
            {OUTREACH_LABEL[k]}
          </option>
        ))}
      </select>
    </label>
  )
}

const due = (f: Film) =>
  f.outreach?.status === 'sent' && Date.now() - Date.parse(f.outreach.sentAt) >= 4 * 86_400_000
