import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api, type Me, type Stats, send } from './api.ts'

/** Inside an iframe (the Hugging Face page), cookies and GitHub sign-in don't work. */
const framed = (() => {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
})()

/** Top right: sign in, or who you are with a small menu. Only on the hosted app. */
export function AccountMenu({ me, onStats }: { me: Me; onStats: () => void }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])
  const out = useMutation({
    mutationFn: () => fetch('/auth/logout', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries(),
  })
  const wipe = useMutation({
    mutationFn: () => send('DELETE', '/v1/me'),
    onSuccess: () => {
      setConfirming(false)
      setOpen(false)
      void qc.invalidateQueries()
    },
  })
  if (!me.hosted) return null
  const canDelete = !!me.user || (me.films?.used ?? 0) > 0
  if (!me.user && !canDelete) return me.signIn ? <SignIn me={me} /> : null

  return (
    <div className="account" ref={box}>
      {!me.user && me.signIn && <SignIn me={me} keep />}
      <button
        type="button"
        className="me"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {me.user?.avatar ? (
          <img src={me.user.avatar} alt="" width={26} height={26} />
        ) : (
          <span className="initial" aria-hidden="true">
            {me.user ? (
              me.user.login.charAt(0).toUpperCase()
            ) : (
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <circle
                  cx="8"
                  cy="5.5"
                  r="2.8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="M2.8 14c.6-2.8 2.7-4.3 5.2-4.3s4.6 1.5 5.2 4.3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
              </svg>
            )}
          </span>
        )}
        <span className="sr">Account</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <p className="menu-who">
            {me.user ? me.user.login : 'Trying coldopen without an account'}
            {me.films && (
              <small>
                {Math.max(0, me.films.limit - me.films.used)} of {me.films.limit} films left today
              </small>
            )}
          </p>
          {me.stats && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onStats()
              }}
            >
              Launch numbers
            </button>
          )}
          {canDelete &&
            (confirming ? (
              <div className="menu-confirm">
                <p>Delete your profiles, films and share links? This can’t be undone.</p>
                <div>
                  <button type="button" className="danger" onClick={() => wipe.mutate()}>
                    {wipe.isPending ? 'Deleting…' : 'Delete everything'}
                  </button>
                  <button type="button" className="link" onClick={() => setConfirming(false)}>
                    Keep it
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" role="menuitem" onClick={() => setConfirming(true)}>
                Delete my data
              </button>
            ))}
          {me.user && (
            <button type="button" role="menuitem" onClick={() => out.mutate()}>
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function FramedNotice() {
  if (!framed) return null
  return (
    <p className="note">
      Sign-in works best in its own tab.{' '}
      <a href={window.location.href} target="_blank" rel="noreferrer">
        Open coldopen in a new tab
      </a>
    </p>
  )
}

export function Privacy({ me }: { me: Me }) {
  if (!me.hosted) return null
  return (
    <footer className="privacy">
      <p>
        Your résumé is read once to draft your profile and isn’t kept. Films and profiles are kept{' '}
        {me.keepsDays === null
          ? 'until you delete them'
          : `${me.keepsDays} days${me.user ? '' : ', or 30 if you sign in'}`}
        . Views are counted without storing anyone’s IP address.{' '}
        <a href="/privacy">Privacy and terms</a>. coldopen is{' '}
        <a href="https://github.com/tiwaker9404/coldopen" target="_blank" rel="noreferrer">
          open source
        </a>
        .
      </p>
    </footer>
  )
}

/** The owner's funnel: is anyone using it, and do the films get replies? */
export function StatsPanel({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState(7)
  const q = useQuery({
    queryKey: ['stats', days],
    queryFn: () => api<Stats>(`/v1/funnel?days=${days}`),
    refetchInterval: 30_000,
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const s = q.data
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '')
  const steps: [string, number, string][] = s
    ? [
        ['Visitors', s.visitors, ''],
        ['Made a film', s.makers, pct(s.makers, s.visitors)],
        ['Signed up', s.signups, ''],
        ['Films made', s.films, s.failed ? `${s.failed} failed` : ''],
        ['Sent', s.sent, pct(s.sent, s.succeeded)],
        ['Watched', s.watched, pct(s.watched, s.sent)],
        ['Replied', s.replied, pct(s.replied, s.sent)],
        ['Interviews', s.interviews, ''],
      ]
    : []
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop closes; Escape and the Close button do the same
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users close with Escape or the Close button
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Launch numbers">
        <header className="drawer-head">
          <div>
            <h2>Launch numbers</h2>
            <p>Everyone using this app, not just you</p>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </header>
        <div className="switch" role="radiogroup" aria-label="Period">
          {[1, 7, 30].map((d) => (
            // biome-ignore lint/a11y/useSemanticElements: radio-styled buttons are the WAI-ARIA pattern for this control
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={days === d}
              onClick={() => setDays(d)}
            >
              {d === 1 ? 'Today' : `${d} days`}
            </button>
          ))}
        </div>
        {q.error && <p className="error">{q.error.message}</p>}
        {s && (
          <>
            <ol className="funnel">
              {steps.map(([label, n, note]) => (
                <li key={label}>
                  <span>{label}</span>
                  <b>{n.toLocaleString()}</b>
                  <small>{note}</small>
                </li>
              ))}
            </ol>
            {s.edits > 0 && (
              <p className="small muted">
                {s.edits} film{s.edits === 1 ? ' was' : 's were'} re-rendered with edited lines.
              </p>
            )}
            {s.failures.length > 0 && (
              <section className="block">
                <h3>Why films failed</h3>
                <ol className="log">
                  {s.failures.map((f) => (
                    <li key={f.error}>
                      <span>{f.error}</span>
                      <small>{f.n}×</small>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        )}
      </aside>
    </div>
  )
}

/** Sign-in buttons, Google first; "keep" says why when they've already made something */
export function SignIn({ me, keep = false }: { me: Me; keep?: boolean }) {
  const ways = me.providers?.length ? me.providers : ['github' as const]
  const target = framed ? '_blank' : '_top'
  return (
    <div className="signin-ways">
      {keep && <small>Sign in to keep your films</small>}
      {ways.map((w, i) => (
        <a
          key={w}
          className={i === 0 ? 'button signin-main' : 'quiet-link'}
          href={`/auth/${w}`}
          target={target}
        >
          {w === 'google' ? 'Continue with Google' : i === 0 ? 'Continue with GitHub' : 'or GitHub'}
        </a>
      ))}
    </div>
  )
}
