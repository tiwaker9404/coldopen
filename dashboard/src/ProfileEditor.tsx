import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { type Profile, type ProfileData, send } from './api.ts'
import { BLANK } from './examples.ts'
import { GitHubRepos } from './GitHubRepos.tsx'
import { ResumeDraft } from './Onboarding.tsx'
import { ErrorNote } from './ui.tsx'

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'profile'

const MAX_PROOF = 8

export function ProfileEditor({
  profile,
  draft,
  notice,
  onClose,
  onSaved,
}: {
  profile: Profile | null
  /** a résumé draft or an example to start from */
  draft?: ProfileData
  notice?: string
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [d, setD] = useState<ProfileData>(profile?.data ?? draft ?? BLANK)
  const [note, setNote] = useState(notice)
  const [name, setName] = useState(profile?.name ?? '')
  const set = (patch: Partial<ProfileData>) => setD({ ...d, ...patch })
  const job = d.preset === 'candidate'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
        ...(d.skills
          ? { skills: [...new Set(d.skills.map((k) => k.trim()).filter(Boolean))].slice(0, 40) }
          : {}),
        ...(d.schools
          ? {
              schools: [...new Set(d.schools.map((k) => k.trim()).filter((k) => k.length >= 2))]
                .map((k) => k.slice(0, 60))
                .slice(0, 4),
            }
          : {}),
        proof: d.proof
          .filter((p) => p.value.trim() && p.label.trim())
          .map((p) => ({
            value: p.value.trim(),
            label: p.label.trim(),
            ...(p.where?.trim() ? { where: p.where.trim() } : {}),
          })),
      }
      const projects = (d.projects ?? [])
        .map((x) => ({ name: x.name.trim(), url: x.url.trim(), line: x.line.trim() }))
        .filter((x) => x.name || x.url || x.line)
      for (const x of projects) {
        if (!x.name || !x.line) throw new Error('Give each project a name and one line')
        if (!/^https:\/\/\S{4,}$/.test(x.url))
          throw new Error(`The link for ${x.name} should start with https://`)
      }
      data.projects = projects.length ? projects.slice(0, 8) : undefined
      if (data.points.length < 2)
        throw new Error('Add at least 2 things the film can say about you')
      if (data.proof.length < 1) throw new Error('Add at least one result with a number')
      const label =
        name.trim() ||
        [data.sender.name, job ? data.sender.role : data.sender.company].filter(Boolean).join(', ')
      const id = profile?.id ?? slug(label)
      return send<Profile>('PUT', `/v1/profiles/${id}`, { name: label, data }).then(() => id)
    },
    onSuccess: onSaved,
  })

  const projects = d.projects ?? []
  const setProject = (i: number, patch: Partial<NonNullable<ProfileData['projects']>[number]>) =>
    set({ projects: projects.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  const setProof = (i: number, patch: Partial<ProfileData['proof'][number]>) =>
    set({ proof: d.proof.map((x, j) => (j === i ? { ...x, ...patch } : x)) })

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop closes; Escape and the Close button do the same
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users close with Escape or the Close button
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="drawer editor"
        role="dialog"
        aria-modal="true"
        aria-label="Your profile"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <header className="drawer-head">
          <div>
            <h2>{profile ? 'Your profile' : draft ? 'Check your profile' : 'Your profile'}</h2>
            <p>What every film says about you, in your own words.</p>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </header>

        {!profile && !draft && (
          <details className="redraft">
            <summary>Start from a résumé instead</summary>
            <ResumeDraft
              hosted={false}
              onDraft={(p, n) => {
                setD(p)
                setNote(n)
              }}
            />
          </details>
        )}
        {note && <p className="note">{note}</p>}

        <div className="switch" role="radiogroup" aria-label="What the films are for">
          {(
            [
              ['candidate', 'Applying for jobs'],
              ['sales', 'Selling a product'],
            ] as const
          ).map(([k, label]) => (
            // biome-ignore lint/a11y/useSemanticElements: radio-styled buttons are the WAI-ARIA pattern for this control
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={d.preset === k}
              onClick={() => set({ preset: k })}
            >
              {label}
            </button>
          ))}
        </div>

        <fieldset>
          <legend>You</legend>
          <div className="pair">
            <label>
              Name
              <input
                required
                value={d.sender.name}
                onChange={(e) => set({ sender: { ...d.sender, name: e.target.value } })}
              />
            </label>
            <label>
              {job ? 'Role you want' : 'Company'}
              <input
                value={(job ? d.sender.role : d.sender.company) ?? ''}
                onChange={(e) =>
                  set({
                    sender: {
                      ...d.sender,
                      ...(job ? { role: e.target.value } : { company: e.target.value }),
                    },
                  })
                }
              />
            </label>
          </div>
          <label>
            {job ? 'What you bring, in one line' : 'What you offer, in one line'}
            <input
              required
              minLength={3}
              maxLength={120}
              value={d.offer}
              placeholder={
                job
                  ? 'An analyst who turns messy data into dashboards leaders use'
                  : 'Product analytics that shows which features keep customers'
              }
              onChange={(e) => set({ offer: e.target.value })}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>What the film can say about you</legend>
          <p className="hint">
            2 to 6 short lines. The script rewords these for each company and adds nothing new.
          </p>
          {d.points.map((p, i) => (
            <div className="listrow" key={`p${i.toString()}`}>
              <input
                aria-label={`Point ${i + 1}`}
                value={p}
                maxLength={120}
                placeholder={i === 0 ? 'Built dashboards a leadership team used weekly' : ''}
                onChange={(e) =>
                  set({ points: d.points.map((x, j) => (j === i ? e.target.value : x)) })
                }
              />
              {d.points.length > 2 && (
                <button
                  type="button"
                  className="link"
                  aria-label={`Remove point ${i + 1}`}
                  onClick={() => set({ points: d.points.filter((_, j) => j !== i) })}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {d.points.length < 6 && (
            <button
              type="button"
              className="link"
              onClick={() => set({ points: [...d.points, ''] })}
            >
              Add a line
            </button>
          )}
        </fieldset>

        <fieldset>
          <legend>Skills and tools</legend>
          <p className="hint">
            Comma-separated, like SQL, Salesforce, Kubernetes. Fit check counts a job’s requirement
            as answered when it names one of these.
          </p>
          <input
            aria-label="Skills and tools"
            value={(d.skills ?? []).join(', ')}
            onChange={(e) =>
              set({
                skills: e.target.value
                  .split(',')
                  .map((x) => x.trimStart())
                  .slice(0, 40),
              })
            }
            placeholder="SQL, Python, Salesforce"
          />
        </fieldset>

        {job && (
          <fieldset>
            <legend>Schools</legend>
            <p className="hint">
              Comma-separated, like Duke University. Who to reach adds alumni at each company you
              film: they answer each other far more often than strangers.
            </p>
            <input
              aria-label="Schools"
              value={(d.schools ?? []).join(', ')}
              onChange={(e) =>
                set({
                  schools: e.target.value
                    .split(',')
                    .map((x) => x.trimStart())
                    .slice(0, 4),
                })
              }
              placeholder="Duke University, Vellore Institute of Technology"
            />
          </fieldset>
        )}

        <fieldset>
          <legend>Results with numbers</legend>
          <p className="hint">
            Shown word for word. Each film shows the 3 that fit the company best.
          </p>
          <div className="proof proof-head" aria-hidden="true">
            <span>Number</span>
            <span>What it measures</span>
            <span>Where</span>
          </div>
          {d.proof.map((p, i) => (
            <div className="proof" key={`r${i.toString()}`}>
              <input
                aria-label={`Result ${i + 1}: number`}
                placeholder="31%"
                maxLength={12}
                value={p.value}
                onChange={(e) => setProof(i, { value: e.target.value })}
              />
              <input
                aria-label={`Result ${i + 1}: what it measures`}
                placeholder="faster month-end close"
                maxLength={60}
                value={p.label}
                onChange={(e) => setProof(i, { label: e.target.value })}
              />
              <input
                aria-label={`Result ${i + 1}: where`}
                placeholder="Acme Corp"
                maxLength={40}
                value={p.where ?? ''}
                onChange={(e) => setProof(i, { where: e.target.value })}
              />
            </div>
          ))}
          {d.proof.length < MAX_PROOF && (
            <button
              type="button"
              className="link"
              onClick={() => set({ proof: [...d.proof, { value: '', label: '', where: '' }] })}
            >
              Add a result
            </button>
          )}
        </fieldset>

        <fieldset>
          <legend>Things you built</legend>
          <p className="hint">
            Projects with a link. Each film puts the one closest to the company on its share page
            and in the email, so they can open real work in one click.
          </p>
          {projects.map((x, i) => (
            <div className="project" key={`p${i.toString()}`}>
              <input
                aria-label={`Project ${i + 1}: name`}
                placeholder="integration-triage"
                maxLength={60}
                value={x.name}
                onChange={(e) => setProject(i, { name: e.target.value })}
              />
              <input
                aria-label={`Project ${i + 1}: link`}
                placeholder="https://github.com/you/project"
                maxLength={300}
                value={x.url}
                onChange={(e) => setProject(i, { url: e.target.value })}
              />
              <input
                className="wide"
                aria-label={`Project ${i + 1}: what it does`}
                placeholder="Diagnoses failing API calls from logs and drafts the reply"
                maxLength={120}
                value={x.line}
                onChange={(e) => setProject(i, { line: e.target.value })}
              />
            </div>
          ))}
          {projects.length < 8 && (
            <div className="project-add">
              <GitHubRepos
                taken={projects.map((x) => x.url)}
                room={8 - projects.length}
                onAdd={(repos) =>
                  set({
                    projects: [
                      // a blank row someone started and left empty makes room
                      ...projects.filter((x) => x.name || x.url || x.line),
                      ...repos.map((r) => ({ name: r.name, url: r.url, line: r.line })),
                    ].slice(0, 8),
                  })
                }
              />
              <button
                type="button"
                className="link"
                onClick={() => set({ projects: [...projects, { name: '', url: '', line: '' }] })}
              >
                Add one by hand
              </button>
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>How the film ends</legend>
          <div className="pair">
            <label>
              The ask
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
                placeholder="you@example.com"
                onChange={(e) => set({ cta: { ...d.cta, contact: e.target.value } })}
              />
            </label>
          </div>
          <label>
            <span>
              Booking link{' '}
              <small>optional: Calendly or Cal.com, the main button on your film’s page</small>
            </span>
            <input
              type="url"
              pattern="https://.*"
              maxLength={300}
              value={d.cta.book ?? ''}
              placeholder="https://cal.com/you/15min"
              onChange={(e) => {
                const book = e.target.value.trim()
                const { book: _old, ...rest } = d.cta
                set({ cta: book ? { ...rest, book } : rest })
              }}
            />
          </label>
          <label>
            <span>
              Profile name <small>shown when you have more than one</small>
            </span>
            <input
              value={name}
              placeholder={[d.sender.name, job ? d.sender.role : d.sender.company]
                .filter(Boolean)
                .join(', ')}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </fieldset>

        <ErrorNote error={save.error} />
        <div className="drawer-foot">
          <button type="submit" className="primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save profile'}
          </button>
          <button type="button" className="link" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
