import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type ReactNode, useId, useState } from 'react'
import { type Film, type FilmDetail, type Fix, type Flag, send } from './api.ts'
import { ErrorNote } from './ui.tsx'

/**
 * The film, scene by scene, before it goes out: a still of each of the six scenes, with plain
 * flags under it for anything a founder would find odd, and one button to fix each. Every fix
 * goes through the edit route and makes a new take; the panel opens it while it renders.
 * "Ready to send" shows only when nothing is flagged.
 */
export function ReviewPane({
  film,
  onMade,
  editor,
}: {
  film: FilmDetail
  onMade: (id: string) => void
  /** the line editor, below the strip: "Edit this line" focuses its field */
  editor: ReactNode
}) {
  const qc = useQueryClient()
  const fix = useMutation({
    mutationFn: (body: object) => send<Film>('POST', `/v1/films/${film.id}/edit`, body),
    onSuccess: (f) => {
      void qc.invalidateQueries({ queryKey: ['films'] })
      onMade(f.id)
    },
  })
  const r = film.review
  if (!r)
    return (
      <>
        <p className="small muted">
          This film was made before scene reviews, so there’s nothing flagged. You can still change
          its lines below.
        </p>
        {editor}
      </>
    )

  return (
    <>
      <section className="block review" aria-labelledby="review-head">
        <div className="review-head">
          <h3 id="review-head">Scene by scene</h3>
          {r.ready ? (
            <p className="ready-badge" role="status">
              Ready to send
            </p>
          ) : (
            <p className="review-count" role="status">
              {r.count === 1 ? '1 thing' : `${r.count} things`} to check before you send
            </p>
          )}
        </div>
        <p className="small">
          What a founder sees, in order. Each fix makes a new take; their site isn’t read again.
        </p>
        <ErrorNote error={fix.error} />
        <ol className="filmstrip">
          {r.scenes.map((s) => (
            <li key={s.kind} className={s.flags.length ? 'flagged' : ''}>
              <Still
                src={film.scenes?.[s.index]}
                fallback={film.scenesOnDisk?.[s.index]}
                name={s.name}
                n={s.index + 1}
                ratio={RATIO[film.format] ?? '1'}
              />
              <div className="scene-body">
                <p className="scene-name">
                  <b>
                    {s.index + 1}. {s.name}
                  </b>
                  {s.caption && <small>{s.caption}</small>}
                </p>
                {s.flags.length ? (
                  <ul className="flags">
                    {s.flags.map((f) => (
                      <FlagRow
                        key={`${f.code}${f.text}`}
                        flag={f}
                        shown={r.proof}
                        busy={fix.isPending}
                        onFix={(body) => fix.mutate(body)}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="small ok">Reads fine</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
      {editor}
    </>
  )
}

const RATIO: Record<string, string> = { square: '1', landscape: '16 / 9', portrait: '9 / 16' }

/**
 * A scene's still: from where the film's media lives, then from the app's own disk (films
 * published before stills went with them), else a plain frame.
 */
function Still({
  src,
  fallback,
  name,
  n,
  ratio,
}: {
  src: string | undefined
  fallback?: string | undefined
  name: string
  n: number
  ratio: string
}) {
  const tries = [src, fallback].filter((u, i, all): u is string => !!u && all.indexOf(u) === i)
  const [at, setAt] = useState(0)
  const url = tries[at]
  if (!url) return <div className="still none" style={{ aspectRatio: ratio }} aria-hidden="true" />
  return (
    <img
      key={url}
      className="still"
      style={{ aspectRatio: ratio }}
      src={url}
      alt={`Scene ${n}, ${name.toLowerCase()}`}
      loading="lazy"
      onError={() => setAt((i) => i + 1)}
    />
  )
}

function FlagRow({
  flag,
  shown,
  busy,
  onFix,
}: {
  flag: Flag
  /** the results the film shows now, to swap one */
  shown: number[]
  busy: boolean
  onFix: (body: object) => void
}) {
  const [open, setOpen] = useState(false)
  const fx: Fix = flag.fix
  const listId = useId()
  return (
    <li>
      <p>{flag.text}</p>
      {fx.kind === 'none' ? (
        <p className="small muted">{fx.label}</p>
      ) : fx.kind === 'edit' ? (
        <button
          type="button"
          onClick={() => {
            const el = document.getElementById(
              fx.line === 'points' ? 'line-points-0' : `line-${fx.line}`,
            )
            el?.scrollIntoView({ block: 'center' })
            el?.focus()
          }}
        >
          {fx.label}
        </button>
      ) : fx.kind === 'wordmark' ? (
        <button type="button" disabled={busy} onClick={() => onFix({ wordmark: true })}>
          {fx.label}
        </button>
      ) : (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen(!open)}
          >
            {fx.label}
          </button>
          {open && (
            <ul className="fix-options" id={listId}>
              {fx.kind === 'fact'
                ? fx.options.map((o) => (
                    <li key={o.id}>
                      <q>{o.text}</q>
                      <small>{o.caption}</small>
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={() => onFix({ factId: o.id })}
                      >
                        Quote this instead
                      </button>
                    </li>
                  ))
                : fx.options.map((o) => (
                    <li key={o.index}>
                      <span>
                        <b>{o.value}</b> {o.label}
                      </span>
                      <small>{[o.did, o.where].filter(Boolean).join(' · ')}</small>
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          onFix({ proof: shown.map((i, j) => (j === fx.slot ? o.index : i)) })
                        }
                      >
                        Show this instead
                      </button>
                    </li>
                  ))}
            </ul>
          )}
        </>
      )}
    </li>
  )
}
