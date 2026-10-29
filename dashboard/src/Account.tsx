import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { type Me, send } from './api.ts'

/** Inside an iframe (the Hugging Face page), cookies and GitHub sign-in don't work. */
const framed = (() => {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
})()

/** Sign in, who you are, and what you have left today. Only on the hosted app. */
export function AccountBar({ me }: { me: Me }) {
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const out = useMutation({
    mutationFn: () => fetch('/auth/logout', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries(),
  })
  const wipe = useMutation({
    mutationFn: () => send('DELETE', '/v1/me'),
    onSuccess: () => {
      setConfirming(false)
      void qc.invalidateQueries()
    },
  })
  const left = me.films ? Math.max(0, me.films.limit - me.films.used) : null
  return (
    <div className="account">
      {left !== null && (
        <span className="left">
          {left === 0 ? 'No films left today' : `${left} film${left === 1 ? '' : 's'} left today`}
        </span>
      )}
      {me.user ? (
        <>
          <span className="me-user">
            {me.user.avatar && (
              <img className="avatar" src={me.user.avatar} alt="" width={22} height={22} />
            )}
            {me.user.login}
          </span>
          <button type="button" className="text" onClick={() => out.mutate()}>
            Sign out
          </button>
        </>
      ) : (
        me.signIn && (
          <a className="button signin" href="/auth/github" target={framed ? '_blank' : '_top'}>
            Sign in with GitHub
          </a>
        )
      )}
      {(me.user || (me.films && me.films.used > 0)) &&
        (confirming ? (
          <span className="confirm">
            Delete your profiles, films and share links?{' '}
            <button type="button" className="danger" onClick={() => wipe.mutate()}>
              {wipe.isPending ? 'Deleting…' : 'Delete'}
            </button>
            <button type="button" className="text" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className="text" onClick={() => setConfirming(true)}>
            Delete my data
          </button>
        ))}
    </div>
  )
}

export function FramedNotice() {
  if (!framed) return null
  return (
    <p className="notice">
      Sign-in works best in its own tab.{' '}
      <a href={window.location.href} target="_blank" rel="noreferrer">
        Open coldopen in a new tab
      </a>
    </p>
  )
}

/** What a first-time visitor sees instead of an empty page. */
export function FirstRun({ onStart, hasProfile }: { onStart: () => void; hasProfile: boolean }) {
  return (
    <section className="firstrun" aria-label="How it works">
      <ol>
        <li className={hasProfile ? 'done' : 'now'}>
          <b>Start from your résumé.</b> Upload it and say which role you want. coldopen drafts your
          profile, and every number in it has to come from the résumé.
          {!hasProfile && (
            <button type="button" className="primary" onClick={onStart}>
              Upload your résumé
            </button>
          )}
        </li>
        <li className={hasProfile ? 'now' : ''}>
          <b>Paste a company's website.</b> Add the job post too, and the film answers one of its
          requirements with your proof.
        </li>
        <li>
          <b>Send the link.</b> You'll see when they open it, press play and watch to the end.
        </li>
      </ol>
    </section>
  )
}

export function PrivacyNote({ me }: { me: Me }) {
  if (!me.hosted) return null
  return (
    <p className="privacy">
      Your résumé is read to draft your profile and isn't kept. Films and profiles are kept{' '}
      {me.keepsDays} days{me.user ? '' : ' (30 if you sign in)'}, and you can delete them any time.
      Share pages count views without storing anyone's IP address.
    </p>
  )
}
