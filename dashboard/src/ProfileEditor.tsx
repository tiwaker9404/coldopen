import { useMutation } from '@tanstack/react-query'
import { type InputHTMLAttributes, useEffect, useRef, useState } from 'react'
import { ApiError, type Profile, type ProfileData, send } from './api.ts'
import { BLANK } from './examples.ts'
import { GitHubRepos } from './GitHubRepos.tsx'
import { MAX_PROJECTS, needsLine } from './github.ts'
import { ResumeDraft } from './Onboarding.tsx'
import {
  clearField,
  errorsByField,
  MAX,
  type ProfileBody,
  pasteInto,
  prepare,
  profileId,
  validate,
} from './profileForm.ts'
import { ErrorNote } from './ui.tsx'

const MAX_PROOF = 8

/** the id of a field's input, for its label and its messages */
const fid = (path: string) => `f-${path.replace(/\./g, '-')}`

/**
 * The profile, with one Save for everything in it: you, your strengths, skills, schools,
 * results, projects (typed or ticked from GitHub) and how the film ends. It's checked against
 * the same schema the server uses before anything is sent, and every problem is shown next to
 * its field. Account keys and connected tools save on their own, on the Profile page.
 */
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
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [summary, setSummary] = useState('')
  const [tries, setTries] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const keep = useRef<HTMLButtonElement>(null)
  const job = d.preset === 'candidate'

  // a draft or example that hasn't been saved yet counts as a change worth asking about
  const start = useRef(!profile && draft ? '' : JSON.stringify(prepare(d, name).body))
  const dirty = JSON.stringify(prepare(d, name).body) !== start.current

  const set = (patch: Partial<ProfileData>, path?: string) => {
    setD((cur) => ({ ...cur, ...patch }))
    if (path) setErrors((e) => clearField(e, path))
  }
  const err = (path: string) => errors[path]

  /** closing with unsaved changes asks first, whichever way you close */
  const close = useRef(() => {})
  close.current = () => {
    if (dirty && !leaving) setLeaving(true)
    else if (leaving) setLeaving(false)
    else onClose()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (leaving) keep.current?.focus()
  }, [leaving])

  // after a check fails, bring the first problem into view and put the cursor there
  useEffect(() => {
    if (!tries) return
    const first = form.current?.querySelector<HTMLElement>('[aria-invalid="true"], .list-error')
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (first instanceof HTMLInputElement) first.focus({ preventScroll: true })
  }, [tries])

  const save = useMutation({
    mutationFn: (body: ProfileBody) => {
      const id = profile?.id ?? profileId(body.name)
      return send<Profile>('PUT', `/v1/profiles/${id}`, body).then(() => id)
    },
    onSuccess: onSaved,
    onError: (e) => {
      // the server checks too; if it still finds something, show it by the field
      if (e instanceof ApiError && e.fields.length) {
        setErrors(errorsByField(e.fields))
        setTries((n) => n + 1)
      }
    },
  })

  const submit = () => {
    const checked = validate(d, name)
    if (!checked.ok) {
      setErrors(errorsByField(checked.fields))
      setSummary(checked.message)
      setTries((n) => n + 1)
      return
    }
    setErrors({})
    setSummary('')
    save.mutate(checked.body)
  }

  const projects = d.projects ?? []
  const setProject = (
    i: number,
    key: keyof NonNullable<ProfileData['projects']>[number],
    value: string,
  ) =>
    set(
      { projects: projects.map((x, j) => (j === i ? { ...x, [key]: value } : x)) },
      `projects.${i}.${key}`,
    )
  const setProof = (i: number, key: keyof ProfileData['proof'][number], value: string) =>
    set(
      { proof: d.proof.map((x, j) => (j === i ? { ...x, [key]: value } : x)) },
      `proof.${i}.${key}`,
    )
  const listError = (path: string) =>
    err(path) && (
      <p className="field-error list-error" id={`f-${path}-err`}>
        {err(path)}
      </p>
    )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop closes; Escape and the Close button do the same
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users close with Escape or the Close button
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && close.current()}>
      <form
        ref={form}
        className="drawer editor"
        role="dialog"
        aria-modal="true"
        aria-label="Your profile"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <header className="drawer-head">
          <div>
            <h2>{profile ? 'Your profile' : draft ? 'Check your profile' : 'Your profile'}</h2>
            <p>What every film says about you, in your own words.</p>
          </div>
          <button type="button" className="x" onClick={() => close.current()} aria-label="Close">
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
                setErrors({})
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
            <label htmlFor={fid('sender.name')}>
              Name
              <Text
                path="sender.name"
                error={err('sender.name')}
                value={d.sender.name}
                onValue={(v) => set({ sender: { ...d.sender, name: v } }, 'sender.name')}
              />
            </label>
            <label htmlFor={fid(job ? 'sender.role' : 'sender.company')}>
              {job ? 'Role you want' : 'Company'}
              <Text
                path={job ? 'sender.role' : 'sender.company'}
                error={err(job ? 'sender.role' : 'sender.company')}
                value={(job ? d.sender.role : d.sender.company) ?? ''}
                onValue={(v) =>
                  set(
                    { sender: { ...d.sender, ...(job ? { role: v } : { company: v }) } },
                    job ? 'sender.role' : 'sender.company',
                  )
                }
              />
            </label>
          </div>
          <label htmlFor={fid('offer')}>
            {job ? 'What you bring, in one line' : 'What you offer, in one line'}
            <Text
              path="offer"
              max={MAX.offer}
              error={err('offer')}
              value={d.offer}
              placeholder={
                job
                  ? 'An analyst who turns messy data into dashboards leaders use'
                  : 'Product analytics that shows which features keep customers'
              }
              onValue={(v) => set({ offer: v }, 'offer')}
            />
          </label>
        </fieldset>

        <fieldset>
          <legend>What the film can say about you</legend>
          <p className="hint">
            2 to 6 short lines. The script rewords these for each company and adds nothing new.
          </p>
          {listError('points')}
          {d.points.map((p, i) => (
            <div className="listrow" key={`p${i.toString()}`}>
              <Text
                path={`points.${i}`}
                max={MAX.point}
                error={err(`points.${i}`)}
                aria-label={`Point ${i + 1}`}
                value={p}
                placeholder={i === 0 ? 'Built dashboards a leadership team used weekly' : ''}
                onValue={(v) =>
                  set({ points: d.points.map((x, j) => (j === i ? v : x)) }, `points.${i}`)
                }
              />
              {d.points.length > 2 && (
                <button
                  type="button"
                  className="link"
                  aria-label={`Remove point ${i + 1}`}
                  onClick={() => set({ points: d.points.filter((_, j) => j !== i) }, 'points')}
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
          <Text
            path="skills"
            error={err('skills')}
            aria-label="Skills and tools"
            value={(d.skills ?? []).join(', ')}
            onValue={(v) =>
              set(
                {
                  skills: v
                    .split(',')
                    .map((x) => x.trimStart())
                    .slice(0, 40),
                },
                'skills',
              )
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
            <Text
              path="schools"
              error={err('schools')}
              aria-label="Schools"
              value={(d.schools ?? []).join(', ')}
              onValue={(v) =>
                set(
                  {
                    schools: v
                      .split(',')
                      .map((x) => x.trimStart())
                      .slice(0, 4),
                  },
                  'schools',
                )
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
          {listError('proof')}
          <div className="proof proof-head" aria-hidden="true">
            <span>Number</span>
            <span>What it measures</span>
            <span>Where</span>
          </div>
          {d.proof.map((p, i) => (
            <div className="proof" key={`r${i.toString()}`}>
              <Text
                path={`proof.${i}.value`}
                max={MAX.proofValue}
                error={err(`proof.${i}.value`)}
                aria-label={`Result ${i + 1}: number`}
                placeholder="31%"
                value={p.value}
                onValue={(v) => setProof(i, 'value', v)}
              />
              <Text
                path={`proof.${i}.label`}
                max={MAX.proofLabel}
                error={err(`proof.${i}.label`)}
                aria-label={`Result ${i + 1}: what it measures`}
                placeholder="faster month-end close"
                value={p.label}
                onValue={(v) => setProof(i, 'label', v)}
              />
              <Text
                path={`proof.${i}.where`}
                max={MAX.proofWhere}
                error={err(`proof.${i}.where`)}
                aria-label={`Result ${i + 1}: where`}
                placeholder="Acme Corp"
                value={p.where ?? ''}
                onValue={(v) => setProof(i, 'where', v)}
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
          {listError('projects')}
          {projects.map((x, i) => {
            const ask = needsLine(x) && !err(`projects.${i}.line`)
            return (
              <div className="project" key={`j${i.toString()}`}>
                <Text
                  path={`projects.${i}.name`}
                  max={MAX.projectName}
                  error={err(`projects.${i}.name`)}
                  aria-label={`Project ${i + 1}: name`}
                  placeholder="integration-triage"
                  value={x.name}
                  onValue={(v) => setProject(i, 'name', v)}
                />
                <Text
                  path={`projects.${i}.url`}
                  error={err(`projects.${i}.url`)}
                  aria-label={`Project ${i + 1}: link`}
                  placeholder="https://github.com/you/project"
                  inputMode="url"
                  value={x.url}
                  onValue={(v) => setProject(i, 'url', v)}
                />
                <Text
                  wrap="wide"
                  className={ask ? 'needs' : undefined}
                  path={`projects.${i}.line`}
                  max={MAX.projectLine}
                  error={err(`projects.${i}.line`)}
                  hint={ask ? 'No description on GitHub. Add one line on what it does.' : undefined}
                  aria-label={`Project ${i + 1}: what it does`}
                  placeholder={
                    ask
                      ? 'Add one line: what it does'
                      : 'Diagnoses failing API calls from logs and drafts the reply'
                  }
                  value={x.line}
                  onValue={(v) => setProject(i, 'line', v)}
                />
                <button
                  type="button"
                  className="link wide"
                  aria-label={`Remove project ${i + 1}`}
                  onClick={() => set({ projects: projects.filter((_, j) => j !== i) }, 'projects')}
                >
                  Remove
                </button>
              </div>
            )
          })}
          <div className="project-add">
            <GitHubRepos
              projects={projects}
              onChange={(next) => set({ projects: next }, 'projects')}
            />
            {projects.length < MAX_PROJECTS && (
              <button
                type="button"
                className="link"
                onClick={() => set({ projects: [...projects, { name: '', url: '', line: '' }] })}
              >
                Add one by hand
              </button>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend>How the film ends</legend>
          <div className="pair">
            <label htmlFor={fid('cta.line')}>
              The ask
              <Text
                path="cta.line"
                max={MAX.ctaLine}
                error={err('cta.line')}
                value={d.cta.line}
                onValue={(v) => set({ cta: { ...d.cta, line: v } }, 'cta.line')}
              />
            </label>
            <label htmlFor={fid('cta.contact')}>
              Email or link
              <Text
                path="cta.contact"
                max={MAX.ctaContact}
                error={err('cta.contact')}
                value={d.cta.contact}
                placeholder="you@example.com"
                onValue={(v) => set({ cta: { ...d.cta, contact: v } }, 'cta.contact')}
              />
            </label>
          </div>
          <label htmlFor={fid('cta.book')}>
            <span>
              Booking link{' '}
              <small>optional: Calendly or Cal.com, the main button on your film’s page</small>
            </span>
            <Text
              path="cta.book"
              error={err('cta.book')}
              inputMode="url"
              value={d.cta.book ?? ''}
              placeholder="https://cal.com/you/15min"
              onValue={(v) => {
                const { book: _old, ...rest } = d.cta
                set({ cta: v ? { ...rest, book: v } : rest }, 'cta.book')
              }}
            />
          </label>
          <label htmlFor={fid('name')}>
            <span>
              Profile name <small>shown when you have more than one</small>
            </span>
            <Text
              path="name"
              max={MAX.name}
              error={err('name')}
              value={name}
              placeholder={[d.sender.name, job ? d.sender.role : d.sender.company]
                .filter(Boolean)
                .join(', ')}
              onValue={(v) => {
                setName(v)
                setErrors((e) => clearField(e, 'name'))
              }}
            />
          </label>
        </fieldset>

        {summary && Object.keys(errors).length > 0 && (
          <p className="error" role="alert">
            {summary}
          </p>
        )}
        <ErrorNote error={save.error} />
        <div className="drawer-foot">
          {leaving ? (
            <div className="leave">
              <b>Discard your changes?</b>
              <button type="button" onClick={onClose}>
                Discard
              </button>
              <button type="button" className="link" ref={keep} onClick={() => setLeaving(false)}>
                Keep editing
              </button>
            </div>
          ) : (
            <>
              <button type="submit" className="primary" disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save profile'}
              </button>
              <button type="button" className="link" onClick={() => close.current()}>
                Cancel
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}

/**
 * One text field: pasted text is tidied into one line instead of cut off, a counter appears
 * near the limit (it never truncates), and a problem shows right under it.
 */
function Text({
  path,
  value,
  onValue,
  max,
  error,
  hint,
  wrap,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'maxLength'> & {
  /** where the field lives in the profile, like 'proof.2.label' */
  path: string
  value: string
  onValue: (v: string) => void
  max?: number
  error?: string
  /** a nudge that isn't an error, like asking for a missing line */
  hint?: string
  /** a class for the wrapper, for grid placement */
  wrap?: string
}) {
  const id = fid(path)
  const n = value.length
  const near = max !== undefined && n >= Math.floor(max * 0.8)
  const over = max !== undefined && n > max
  const said = [error && `${id}-err`, !error && hint && `${id}-hint`, near && `${id}-n`]
    .filter(Boolean)
    .join(' ')
  return (
    <span className={`field${wrap ? ` ${wrap}` : ''}`}>
      <input
        {...rest}
        id={id}
        data-field={path}
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={said || undefined}
        onChange={(e) => onValue(e.target.value)}
        onPaste={(e) => {
          const el = e.currentTarget
          const next = pasteInto(
            value,
            e.clipboardData.getData('text/plain'),
            el.selectionStart ?? value.length,
            el.selectionEnd ?? value.length,
          )
          if (!next) return
          e.preventDefault()
          onValue(next.value)
          requestAnimationFrame(() => el.setSelectionRange(next.caret, next.caret))
        }}
      />
      {near && max !== undefined && (
        <small id={`${id}-n`} className={over ? 'counter over' : 'counter'}>
          {over ? `${n} of ${max} characters: ${n - max} too many` : `${n} of ${max}`}
        </small>
      )}
      {error ? (
        <small id={`${id}-err`} className="field-error">
          {error}
        </small>
      ) : (
        hint && (
          <small id={`${id}-hint`} className="field-ask">
            {hint}
          </small>
        )
      )}
    </span>
  )
}
