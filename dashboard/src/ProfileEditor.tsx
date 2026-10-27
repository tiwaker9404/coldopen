import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { type Profile, type ProfileData, send } from './api.ts'

const BLANK: ProfileData = {
  preset: 'sales',
  sender: { name: '', company: '', role: '' },
  offer: '',
  points: ['', '', ''],
  proof: [
    { value: '', label: '' },
    { value: '', label: '' },
  ],
  cta: { line: 'Worth a 15-minute look?', contact: '' },
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'profile'

export function ProfileEditor({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [d, setD] = useState<ProfileData>(profile?.data ?? BLANK)
  const [name, setName] = useState(profile?.name ?? '')
  const set = (patch: Partial<ProfileData>) => setD({ ...d, ...patch })

  const save = useMutation({
    mutationFn: () => {
      const data: ProfileData = {
        ...d,
        sender: {
          name: d.sender.name.trim(),
          ...(d.sender.company?.trim() ? { company: d.sender.company.trim() } : {}),
          ...(d.sender.role?.trim() ? { role: d.sender.role.trim() } : {}),
        },
        points: d.points.map((p) => p.trim()).filter(Boolean),
        proof: d.proof.filter((p) => p.value.trim() && p.label.trim()),
      }
      const label =
        name.trim() || `${data.sender.name}${data.sender.company ? `, ${data.sender.company}` : ''}`
      const id = profile?.id ?? slug(label)
      return send<Profile>('PUT', `/v1/profiles/${id}`, { name: label, data }).then(() => id)
    },
    onSuccess: onSaved,
  })

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop closes; Escape and the Close button do the same
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users close with Escape or the Close button
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="panel editor"
        role="dialog"
        aria-modal="true"
        aria-label="Profile"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className="panel-head">
          <h2>{profile ? 'Edit profile' : 'Who are the films from?'}</h2>
          <button type="button" className="close" onClick={onClose}>
            Close
          </button>
        </div>

        <fieldset className="preset">
          <legend>Use it for</legend>
          <label>
            <input
              type="radio"
              checked={d.preset === 'sales'}
              onChange={() => set({ preset: 'sales' })}
            />{' '}
            Selling a product
          </label>
          <label>
            <input
              type="radio"
              checked={d.preset === 'candidate'}
              onChange={() => set({ preset: 'candidate' })}
            />{' '}
            Applying for a job
          </label>
        </fieldset>

        <div className="two">
          <label>
            Your name
            <input
              required
              value={d.sender.name}
              onChange={(e) => set({ sender: { ...d.sender, name: e.target.value } })}
            />
          </label>
          <label>
            {d.preset === 'candidate' ? 'Role you want (optional)' : 'Company'}
            <input
              value={(d.preset === 'candidate' ? d.sender.role : d.sender.company) ?? ''}
              onChange={(e) =>
                set({
                  sender: {
                    ...d.sender,
                    ...(d.preset === 'candidate'
                      ? { role: e.target.value }
                      : { company: e.target.value }),
                  },
                })
              }
            />
          </label>
        </div>

        <label>
          {d.preset === 'candidate' ? 'What you bring, in one line' : 'What you offer, in one line'}
          <input
            required
            minLength={3}
            maxLength={120}
            value={d.offer}
            placeholder={
              d.preset === 'candidate'
                ? 'An engineer who ships AI agents customers use'
                : 'Product analytics that shows which features keep customers'
            }
            onChange={(e) => set({ offer: e.target.value })}
          />
        </label>

        <fieldset>
          <legend>Points the script can use (2 to 6, each under ten words)</legend>
          {d.points.map((p, i) => (
            <input
              // biome-ignore lint/suspicious/noArrayIndexKey: editable list keyed by position
              key={i}
              aria-label={`Point ${i + 1}`}
              value={p}
              maxLength={120}
              onChange={(e) =>
                set({ points: d.points.map((x, j) => (j === i ? e.target.value : x)) })
              }
            />
          ))}
          {d.points.length < 6 && (
            <button
              type="button"
              className="text"
              onClick={() => set({ points: [...d.points, ''] })}
            >
              Add a point
            </button>
          )}
        </fieldset>

        <fieldset>
          <legend>Proof, shown word for word (1 to 5)</legend>
          {d.proof.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: editable list keyed by position
            <div className="proof-row" key={i}>
              <input
                aria-label={`Proof ${i + 1} number`}
                placeholder="31%"
                maxLength={12}
                value={p.value}
                onChange={(e) =>
                  set({
                    proof: d.proof.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                  })
                }
              />
              <input
                aria-label={`Proof ${i + 1} label`}
                placeholder="lift in retention at Brightline"
                maxLength={60}
                value={p.label}
                onChange={(e) =>
                  set({
                    proof: d.proof.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                  })
                }
              />
            </div>
          ))}
          {d.proof.length < 5 && (
            <button
              type="button"
              className="text"
              onClick={() => set({ proof: [...d.proof, { value: '', label: '' }] })}
            >
              Add proof
            </button>
          )}
        </fieldset>

        <div className="two">
          <label>
            Closing ask
            <input
              required
              maxLength={60}
              value={d.cta.line}
              onChange={(e) => set({ cta: { ...d.cta, line: e.target.value } })}
            />
          </label>
          <label>
            Email or link
            <input
              required
              maxLength={80}
              value={d.cta.contact}
              onChange={(e) => set({ cta: { ...d.cta, contact: e.target.value } })}
            />
          </label>
        </div>

        <label>
          Profile name
          <input
            value={name}
            placeholder="Shown in the From menu"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {save.error && <p className="error">{save.error.message}</p>}
        <div className="editor-actions">
          <button type="submit" className="primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>
    </div>
  )
}
