import { useState } from 'react'
import { type Film, media, type OutreachStatus } from './api.ts'
import { due, host, progressLabel, watched } from './FilmRow.tsx'

type Stage = 'notSent' | OutreachStatus

const STAGES: { id: Stage; label: string; empty: string }[] = [
  { id: 'notSent', label: 'Not sent', empty: 'Films you make land here.' },
  { id: 'sent', label: 'Sent', empty: 'Mark a film Sent from its Send tab.' },
  { id: 'replied', label: 'Replied', empty: 'Replies show up here.' },
  { id: 'interview', label: 'Interview', empty: 'Your interviews, from coldopen.' },
  { id: 'no_reply', label: 'No reply', empty: 'Films that got no answer after the follow-ups.' },
]

export const stageOf = (f: Film): Stage => f.outreach?.status ?? 'notSent'

/**
 * Every film by where it stands, left to right: made, sent, replied, interview. The poster on
 * each card is the film itself, so the board reads like a contact sheet of the search.
 */
export function Board({
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
  const by = new Map<Stage, Film[]>(STAGES.map((s) => [s.id, []]))
  for (const f of list) by.get(stageOf(f))!.push(f)
  // on a phone the board shows one stage at a time, starting with the first that has films
  const [stage, setStage] = useState<Stage>(
    () => STAGES.find((s) => by.get(s.id)!.length > 0)?.id ?? 'notSent',
  )
  return (
    <section className="board" aria-label="Your films by stage">
      <div className="stage-pick" role="tablist" aria-label="Stage">
        {STAGES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={stage === s.id}
            onClick={() => setStage(s.id)}
          >
            {s.label} <span>{by.get(s.id)!.length}</span>
          </button>
        ))}
      </div>
      <div className="columns">
        {STAGES.map((s) => {
          const films = by.get(s.id)!
          return (
            <section
              key={s.id}
              className={`column ${s.id}${stage === s.id ? ' shown' : ''}`}
              aria-labelledby={`stage-${s.id}`}
            >
              <h2 id={`stage-${s.id}`}>
                {s.label} <span>{films.length}</span>
              </h2>
              {films.length === 0 ? (
                <p className="column-empty">{s.empty}</p>
              ) : (
                <ul>
                  {films.map((f) => (
                    <li key={f.id}>
                      <Card
                        film={f}
                        name={name(f)}
                        active={open === f.id}
                        onOpen={() => onOpen(f.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </section>
  )
}

function Card({
  film,
  name,
  active,
  onOpen,
}: {
  film: Film
  name: string | undefined
  active: boolean
  onOpen: () => void
}) {
  const live = film.status === 'queued' || film.status === 'running'
  const line = live
    ? progressLabel(film)
    : film.status === 'failed'
      ? 'Needs another try'
      : film.status === 'cancelled'
        ? 'Cancelled'
        : due(film)
          ? 'Follow-up due'
          : film.outreach && film.outreach.status !== 'sent'
            ? null
            : watched(film)
  return (
    <button type="button" className={`card${active ? ' active' : ''}`} onClick={onOpen}>
      <span className={`poster ${film.format}`}>
        {film.status === 'succeeded' && film.files ? (
          <img src={media(film, 'poster.jpg')} alt="" loading="lazy" />
        ) : (
          <span className={`slate ${film.status}`} aria-hidden="true">
            {live && <i className="rec" />}
          </span>
        )}
      </span>
      <span className="card-text">
        <b>{name ?? host(film.url)}</b>
        <span>{film.job?.title ?? film.host ?? host(film.url)}</span>
        {line && (
          <small className={due(film) ? 'due' : film.status === 'failed' ? 'bad' : ''}>
            {line}
          </small>
        )}
      </span>
    </button>
  )
}
