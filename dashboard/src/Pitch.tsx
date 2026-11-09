import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { type Film, type ProfileData, send } from './api.ts'
import { ErrorNote } from './ui.tsx'

/**
 * Pitch a role: the recruiter side of coldopen. A recruiter or founder pastes their job post
 * and one candidate's profile, and gets a 30-second film in their own brand that answers the
 * role's requirements with the candidate's own record.
 */

const LINK = /^https?:\/\/\S+$/
const KEY = 'coldopen.pitch.from'

interface From {
  name: string
  company: string
  contact: string
  book: string
}

function loadFrom(): From {
  const blank = { name: '', company: '', contact: '', book: '' }
  try {
    return { ...blank, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return blank
  }
}

function saveFrom(f: From) {
  try {
    localStorage.setItem(KEY, JSON.stringify(f))
  } catch {
    /* storage blocked: the form just starts empty next time */
  }
}

export function Pitch({ onMade }: { onMade: (id: string) => void }) {
  const qc = useQueryClient()
  const [job, setJob] = useState('')
  const [site, setSite] = useState('')
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  // one candidate (a film made for them) or everyone (a hiring film to post on LinkedIn)
  const [mode, setMode] = useState<'one' | 'everyone'>('one')
  const everyone = mode === 'everyone'
  const [from, setFrom] = useState<From>(loadFrom)
  const set = (k: keyof From) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFrom({ ...from, [k]: e.target.value })
  const pasted = job.trim().length > 0 && !LINK.test(job.trim())

  const make = useMutation({
    mutationFn: async () => {
      const j = job.trim()
      if (!j) throw new Error('Paste the job post’s link, or its whole description')
      if (pasted && j.length < 40)
        throw new Error('That’s too short for a job post; paste all of it')
      if (pasted && !site.trim())
        throw new Error('Add your company’s website, so the film is in your brand')
      if (!everyone && text.trim().length < 80)
        throw new Error(
          'Paste the candidate’s whole profile or résumé, with the bullets under each role',
        )
      if (!from.name.trim() || (!everyone && !from.contact.trim()))
        throw new Error(everyone ? 'Add your name' : 'Add your name and where they can reply')
      saveFrom(from)
      const profile = await send<ProfileData>('POST', '/v1/pitch/profile', {
        ...(everyone ? {} : { candidateText: text }),
        ...(!everyone && name.trim() ? { candidateName: name.trim() } : {}),
        recruiter: {
          name: from.name.trim(),
          ...(from.company.trim() ? { company: from.company.trim() } : {}),
          contact: from.contact.trim() || 'the job post',
          ...(from.book.trim() ? { book: from.book.trim() } : {}),
        },
      })
      return send<Film>('POST', '/v1/films', {
        url: pasted ? site.trim() : j,
        profile,
        format: 'square',
        ...(pasted ? { job: { text: j } } : {}),
      })
    },
    onSuccess: (f) => {
      setText('')
      setName('')
      void qc.invalidateQueries({ queryKey: ['films'] })
      void qc.invalidateQueries({ queryKey: ['me'] })
      onMade(f.id)
    },
  })

  return (
    <form
      className="pitch"
      onSubmit={(e) => {
        e.preventDefault()
        make.mutate()
      }}
    >
      <div className="switch" role="radiogroup" aria-label="Who the film is for">
        {(
          [
            ['one', 'For one candidate'],
            ['everyone', 'For everyone: a hiring post'],
          ] as const
        ).map(([k, label]) => (
          // biome-ignore lint/a11y/useSemanticElements: radio-styled buttons are the WAI-ARIA pattern for this control
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={mode === k}
            onClick={() => setMode(k)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="muted small">
        {everyone
          ? 'A 30-second film that announces the role in your brand, with a LinkedIn post ready to paste. Made for small teams hiring without a recruiter.'
          : 'A 30-second film made for one person, answering your role with their own results, plus a short InMail.'}
      </p>
      <ol className="pitch-steps">
        <li>
          <h2>The role</h2>
          <label>
            Job post
            <input
              value={job}
              onChange={(e) => setJob(e.target.value)}
              placeholder="jobs.ashbyhq.com/acme/…, or paste the whole post"
              autoComplete="off"
              spellCheck={false}
            />
            <small>
              Greenhouse, Lever, Ashby or your careers page.{' '}
              {everyone
                ? 'The film shows what the role would do, in the post’s own words.'
                : 'The film quotes one requirement from it.'}
            </small>
          </label>
          {pasted && (
            <label>
              Your company’s website
              <input
                value={site}
                onChange={(e) => setSite(e.target.value)}
                placeholder="acme.com"
                autoComplete="url"
              />
              <small>The film takes your colors, fonts and logo from it.</small>
            </label>
          )}
        </li>
        {!everyone && (
          <li>
            <h2>The candidate</h2>
            <label>
              <span>
                Their name <small>(optional: read from their profile when it’s there)</small>
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Priya Shah"
              />
            </label>
            <label>
              Their profile or résumé
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={9}
                placeholder="Paste their LinkedIn profile or résumé, with the bullets under each role"
              />
              <small>
                The film answers your role with their own results, word for word. Nothing is
                invented.
              </small>
            </label>
          </li>
        )}
        <li>
          <h2>From you</h2>
          <div className="pitch-from">
            <label>
              Your name
              <input value={from.name} onChange={set('name')} autoComplete="name" />
            </label>
            <label>
              <span>
                Company <small>(optional)</small>
              </span>
              <input value={from.company} onChange={set('company')} autoComplete="organization" />
            </label>
            {!everyone && (
              <>
                <label>
                  Where they reply
                  <input
                    value={from.contact}
                    onChange={set('contact')}
                    placeholder="you@acme.com"
                    autoComplete="email"
                  />
                </label>
                <label>
                  <span>
                    Booking link <small>(optional)</small>
                  </span>
                  <input
                    value={from.book}
                    onChange={set('book')}
                    placeholder="https://cal.com/you/15min"
                  />
                </label>
              </>
            )}
          </div>
        </li>
      </ol>
      <div className="pitch-go">
        <button type="submit" className="primary" disabled={make.isPending}>
          {make.isPending ? 'Starting the film…' : 'Make the film'}
        </button>
        <span className="muted small">
          About a minute. You get the film, a share link that shows when they watch, and a short
          InMail.
        </span>
      </div>
      <ErrorNote error={make.error} />
    </form>
  )
}
