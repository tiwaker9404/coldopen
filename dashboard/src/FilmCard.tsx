import { type Film, media } from './api.ts'

const STAGES = ['research', 'script', 'design', 'render', 'encode'] as const
const STAGE_LABEL: Record<string, string> = {
  research: 'Reading the site',
  script: 'Writing',
  design: 'Matching the brand',
  render: 'Rendering',
  encode: 'Encoding',
  deliver: 'Delivering',
}

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function FilmCard({
  film,
  onOpen,
  active,
}: {
  film: Film
  onOpen: () => void
  active: boolean
}) {
  const live = film.status === 'queued' || film.status === 'running'
  const stage = film.progress?.stage ?? (film.status === 'queued' ? 'queued' : 'research')
  const pct = film.progress?.percent ?? 0
  return (
    <button
      type="button"
      className={`card ${film.format}${active ? ' active' : ''}`}
      onClick={onOpen}
    >
      <div className="frame">
        {film.status === 'succeeded' && film.files ? (
          <img src={media(film, 'poster.jpg')} alt="" loading="lazy" />
        ) : (
          <div className={`slate ${film.status}`}>
            {live ? (
              <>
                <span className="tally" aria-hidden="true" />
                <span className="slate-label">
                  {film.status === 'queued'
                    ? 'Waiting for a renderer'
                    : (STAGE_LABEL[stage] ?? 'Working')}
                </span>
                <span className="steps" aria-hidden="true">
                  {STAGES.map((s) => (
                    <i
                      key={s}
                      className={
                        STAGES.indexOf(s) < STAGES.indexOf(stage as (typeof STAGES)[number])
                          ? 'done'
                          : s === stage
                            ? 'now'
                            : ''
                      }
                    >
                      {s === stage && s === 'render' ? <b style={{ width: `${pct}%` }} /> : null}
                    </i>
                  ))}
                </span>
              </>
            ) : (
              <span className="slate-label">
                {film.status === 'failed' ? 'Couldn’t make this one' : 'Cancelled'}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="caption">
        <span className="who">{film.company ?? host(film.url)}</span>
        <span className="meta">
          {film.status === 'succeeded'
            ? `${Math.round(film.durationSec ?? 0)}s, from ${film.sender}`
            : film.status === 'failed'
              ? 'Failed'
              : film.attempts > 1
                ? `Resumed after a restart`
                : host(film.url)}
        </span>
      </div>
    </button>
  )
}
