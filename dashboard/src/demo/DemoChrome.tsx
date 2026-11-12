/**
 * What only the demo build shows: a banner that says it's a demo (with the way to the real
 * app), and the 90-second tour. Loaded lazily by App.tsx when __DEMO__ is set.
 */
import { useEffect, useRef, useState } from 'react'
import { LIVE_APP } from './api.ts'
import { back, markDone, next, STOPS, shouldStart } from './tour.ts'

const storage = (): Storage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export default function DemoChrome({ onOpenFilm }: { onOpenFilm: (open: boolean) => void }) {
  const [stop, setStop] = useState<number | null>(() =>
    shouldStart(storage(), window.location.search) ? 0 : null,
  )
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (stop === null) return
    const s = STOPS[stop]!
    if (window.location.hash !== `#${s.place}`) window.location.hash = s.place
    onOpenFilm(!!s.film)
    card.current?.focus()
  }, [stop, onOpenFilm])

  const end = () => {
    markDone(storage())
    setStop(null)
    onOpenFilm(false)
  }
  useEffect(() => {
    if (stop === null) return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') end()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const s = stop === null ? null : STOPS[stop]!
  return (
    <>
      <div className="demo-banner" role="note">
        <span>
          <strong>Demo account.</strong> Nothing here is saved.
        </span>
        <span className="demo-banner-links">
          {stop === null && (
            <button type="button" className="link" onClick={() => setStop(0)}>
              Take the tour
            </button>
          )}
          <a href={LIVE_APP}>Make your own film →</a>
        </span>
      </div>
      {s && stop !== null && (
        <div
          className="tour"
          role="dialog"
          aria-modal="false"
          aria-labelledby="tour-title"
          tabIndex={-1}
          ref={card}
        >
          <p className="tour-step">
            {stop + 1} of {STOPS.length}
          </p>
          <h2 id="tour-title">{s.title}</h2>
          <p>{s.body}</p>
          {next(stop) === null ? (
            <div className="tour-actions">
              <button type="button" className="link" onClick={() => setStop(back(stop))}>
                Back
              </button>
              <a
                className="button primary-link"
                href={LIVE_APP}
                onClick={() => markDone(storage())}
              >
                Make your own film
              </a>
              <button type="button" className="link" onClick={end}>
                Explore on my own
              </button>
            </div>
          ) : (
            <div className="tour-actions">
              <button type="button" className="link" onClick={end}>
                Skip the tour
              </button>
              {stop > 0 && (
                <button type="button" className="link" onClick={() => setStop(back(stop))}>
                  Back
                </button>
              )}
              <button type="button" className="primary" onClick={() => setStop(next(stop))}>
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
