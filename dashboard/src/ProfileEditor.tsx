import { useMutation } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { draftFromResume, type Profile, type ProfileData, send } from './api.ts'

const BLANK: ProfileData = {
  preset: 'sales',
  sender: { name: '', company: '', role: '' },
  offer: '',
  points: ['', '', ''],
  proof: [
    { value: '', label: '', where: '' },
    { value: '', label: '', where: '' },
  ],
  cta: { line: 'Worth a 15-minute look?', contact: '' },
}

/** Starter profiles for different roles, bundled from profiles/ at build time. */
const EXAMPLES = Object.entries(
  import.meta.glob<{ default: ProfileData }>(
    ['../../profiles/examples/*.json', '../../profiles/*.example.json'],
    { eager: true },
  ),
)
  .map(([path, mod]) => ({
    id: path
      .split('/')
      .pop()!
      .replace(/(\.example)?\.json$/, ''),
    data: mod.default,
  }))
  .map((e) => ({
    ...e,
    label:
      e.id === 'sales'
        ? 'Selling a product (founder or SDR)'
        : e.id === 'candidate'
          ? 'Software engineer'
          : (e.data.sender.role ?? e.id),
  }))
  .sort((a, b) => (a.id === 'sales' ? -1 : b.id === 'sales' ? 1 : a.label.localeCompare(b.label)))

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'profile'

const MAX_PROOF = 8

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
  const [notice, setNotice] = useState<string | null>(null)
  const set = (patch: Partial<ProfileData>) => setD({ ...d, ...patch })

  // starting points: a résumé, or an example for your kind of role
  const file = useRef<HTMLInputElement>(null)
  const [role, setRole] = useState('')
  const [exclude, setExclude] = useState('')
  const draft = useMutation({
    mutationFn: () => {
      const f = file.current?.files?.[0]
      if (!f) throw new Error('Choose your résumé first (PDF, Word, Markdown or text)')
      if (!role.trim())
        throw new Error('Say which role you’re applying for, so the right points are picked')
      return draftFromResume(
        f,
        role.trim(),
        exclude
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      )
    },
    onSuccess: ({ profile: p, meta }) => {
      setD({
        ...p,
        proof: p.proof.map((x) => ({ ...x, where: x.where ?? '' })),
        // keep what the person already typed
        sender: { ...p.sender, name: d.sender.name.trim() || p.sender.name },
        cta: { ...p.cta, contact: d.cta.contact.trim() || p.cta.contact },
      })
      if (!name) setName(`${p.sender.name}, ${p.sender.role ?? role}`)
      setNotice(
        `Drafted from your résumé${meta.model === 'deterministic' ? '' : ` by ${meta.model.replace(/^openai-compatible:/, '')}`}. ` +
          'Every number is copied from it word for word. Read each line before saving.' +
          (meta.dropped.length
            ? ` Left out ${meta.dropped.length} item(s) it couldn’t match to your résumé.`
            : ''),
      )
    },
  })

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
        proof: d.proof
          .filter((p) => p.value.trim() && p.label.trim())
          .map((p) => ({
            value: p.value.trim(),
            label: p.label.trim(),
            ...(p.where?.trim() ? { where: p.where.trim() } : {}),
          })),
      }
      const label =
        name.trim() || `${data.sender.name}${data.sender.company ? `, ${data.sender.company}` : ''}`
      const id = profile?.id ?? slug(label)
      return send<Profile>('PUT', `/v1/profiles/${id}`, { name: label, data }).then(() => id)
    },
    onSuccess: onSaved,
  })

  const setProof = (i: number, patch: Partial<ProfileData['proof'][number]>) =>
    set({ proof: d.proof.map((x, j) => (j === i ? { ...x, ...patch } : x)) })

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

        {!profile && (
          <section className="start" aria-label="Start from">
            <div className="start-card">
              <h3>Start from your résumé</h3>
              <p>
                For job seekers in any role. Your proof points are pulled from it, numbers word for
                word.
              </p>
              <input
                ref={file}
                type="file"
                aria-label="Résumé file"
                accept=".pdf,.docx,.md,.txt,application/pdf"
              />
              <div className="two">
                <label>
                  Role you’re applying for
                  <input
                    value={role}
                    placeholder="Data analyst"
                    onChange={(e) => setRole(e.target.value)}
                  />
                </label>
                <label>
                  Leave out (optional)
                  <input
                    value={exclude}
                    placeholder="Current employer, comma-separated"
                    onChange={(e) => setExclude(e.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                className="primary"
                disabled={draft.isPending}
                onClick={() => draft.mutate()}
              >
                {draft.isPending ? 'Reading your résumé…' : 'Draft my profile'}
              </button>
              {draft.error && <p className="error">{draft.error.message}</p>}
            </div>
            <label className="start-example">
              Or start from an example
              <select
                defaultValue=""
                onChange={(e) => {
                  const ex = EXAMPLES.find((x) => x.id === e.target.value)
                  if (!ex) return
                  setD({
                    ...ex.data,
                    proof: ex.data.proof.map((x) => ({ ...x, where: x.where ?? '' })),
                  })
                  setNotice(
                    `Loaded the ${ex.label.toLowerCase()} example. Replace every line with your own.`,
                  )
                }}
              >
                <option value="" disabled>
                  Choose a role
                </option>
                {EXAMPLES.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          </section>
        )}

        {notice && <p className="notice">{notice}</p>}

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
                ? 'An analyst who turns messy data into dashboards leaders use'
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
          <legend>
            Proof, shown word for word (1 to {MAX_PROOF}; each film shows the 3 that fit best)
          </legend>
          <div className="proof-head" aria-hidden="true">
            <span>Number</span>
            <span>What it counts</span>
            <span>Where</span>
          </div>
          {d.proof.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: editable list keyed by position
            <div className="proof-row" key={i}>
              <input
                aria-label={`Proof ${i + 1} number`}
                placeholder="31%"
                maxLength={12}
                value={p.value}
                onChange={(e) => setProof(i, { value: e.target.value })}
              />
              <input
                aria-label={`Proof ${i + 1} label`}
                placeholder="lift in week-4 retention"
                maxLength={60}
                value={p.label}
                onChange={(e) => setProof(i, { label: e.target.value })}
              />
              <input
                aria-label={`Proof ${i + 1} where`}
                placeholder="Brightline"
                maxLength={40}
                value={p.where ?? ''}
                onChange={(e) => setProof(i, { where: e.target.value })}
              />
            </div>
          ))}
          {d.proof.length < MAX_PROOF && (
            <button
              type="button"
              className="text"
              onClick={() => set({ proof: [...d.proof, { value: '', label: '', where: '' }] })}
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
            placeholder="Shown in the From menu, e.g. Priya, data analyst"
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
