import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Privacy } from './Account.tsx'
import { AutopilotSection } from './Autopilot.tsx'
import { type Me, type Profile, send } from './api.ts'
import { Tools } from './Guide.tsx'
import { ErrorNote, useToast } from './ui.tsx'

/**
 * Everything about you, on one page: the profiles your films are made from (one per kind of
 * role you apply for), then the tools coldopen connects to.
 */
export function ProfilesPage({
  me,
  profiles,
  onEdit,
  onNew,
}: {
  me: Me | undefined
  profiles: Profile[]
  onEdit: (p: Profile) => void
  onNew: () => void
}) {
  // one card at a time can be asking "Delete …?"
  const [confirming, setConfirming] = useState<string | null>(null)
  return (
    <div className="page-body">
      <section className="section" aria-labelledby="profiles-title">
        <div className="section-head">
          <div>
            <h2 id="profiles-title">Your profiles</h2>
            <p className="section-sub">
              What your films say about you. Keep one per kind of role, like one for engineering
              jobs and one for solutions roles, and pick which to use when you make a film.
            </p>
          </div>
          <button type="button" className="primary" onClick={onNew}>
            New profile
          </button>
        </div>
        {profiles.length === 0 ? (
          <p className="empty">No profile yet. Make one from your résumé in about a minute.</p>
        ) : (
          <ul className="profile-list">
            {profiles.map((p, i) => (
              <li key={p.id}>
                <ProfileCard
                  profile={p}
                  isDefault={i === 0}
                  only={profiles.length === 1}
                  nextDefault={i === 0 ? profiles[1]?.name : undefined}
                  confirming={confirming === p.id}
                  onConfirm={(on) => setConfirming(on ? p.id : null)}
                  onEdit={() => onEdit(p)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {profiles.length > 0 && <AutopilotSection />}

      <section className="section" aria-labelledby="tools-title">
        <div className="section-head">
          <div>
            <h2 id="tools-title">Connected tools</h2>
            <p className="section-sub">
              Optional extras that make sending faster. Everything works without them.
            </p>
          </div>
        </div>
        <Tools me={me} />
      </section>

      {me && <Privacy me={me} />}
    </div>
  )
}

/**
 * One profile, with Edit and Delete. Delete asks first, on the card itself: films already made
 * copied the profile when they were queued, so they keep working whatever happens here.
 */
function ProfileCard({
  profile: p,
  isDefault,
  only,
  nextDefault,
  confirming,
  onConfirm,
  onEdit,
}: {
  profile: Profile
  isDefault: boolean
  only: boolean
  /** the profile that becomes the default when this one goes */
  nextDefault: string | undefined
  confirming: boolean
  onConfirm: (on: boolean) => void
  onEdit: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const deleteRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  // "Keep it" hands focus back to the Delete button it came from
  const [refocus, setRefocus] = useState(false)
  const remove = useMutation({
    mutationFn: () => send('DELETE', `/v1/profiles/${encodeURIComponent(p.id)}`),
    onSuccess: () => {
      onConfirm(false)
      toast({ text: `Deleted ${p.name}.` })
      void qc.invalidateQueries({ queryKey: ['profiles'] })
    },
  })
  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
    else if (refocus) {
      deleteRef.current?.focus()
      setRefocus(false)
    }
  }, [confirming, refocus])
  const what = [
    `Delete ${p.name}? Films you already made keep working.`,
    only && 'You’ll need a profile to make films.',
    isDefault && !only && nextDefault && `${nextDefault} becomes your default.`,
  ]
    .filter(Boolean)
    .join(' ')
  const askId = `delete-${p.id}`
  return (
    <div className="profile-card">
      <div>
        <b>
          {p.name}
          {isDefault && <span className="pill">Used by default</span>}
        </b>
        <span>
          {[p.data.sender.name, p.data.sender.role, p.data.sender.company]
            .filter(Boolean)
            .join(', ')}
        </span>
        <p>{p.data.offer}</p>
        <small>
          {p.data.proof.length} results, {p.data.points.length} strengths
          {p.data.cta.book ? ', booking link set' : ', no booking link yet'}
        </small>
        {remove.isError && <ErrorNote error={remove.error} lead="Couldn’t delete it: " />}
      </div>
      {confirming ? (
        // biome-ignore lint/a11y/useSemanticElements: a fieldset would read as a form; this is one question
        <div className="profile-confirm" role="group" aria-labelledby={askId}>
          <p id={askId}>{what}</p>
          <div>
            <button
              type="button"
              ref={confirmRef}
              className="danger"
              aria-label={`Delete profile ${p.name}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? 'Deleting…' : 'Delete profile'}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                remove.reset()
                setRefocus(true)
                onConfirm(false)
              }}
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="profile-actions">
          <button type="button" onClick={onEdit}>
            Edit profile
          </button>
          <button
            type="button"
            ref={deleteRef}
            aria-label={`Delete ${p.name}`}
            onClick={() => {
              remove.reset()
              onConfirm(true)
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
