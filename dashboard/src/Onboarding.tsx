import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { draftFromResume, type ProfileData } from './api.ts'
import { BLANK, EXAMPLES } from './examples.ts'

/** a real film, from the project's own landing page */
const SAMPLE = 'https://tiwaker9404.github.io/coldopen/media'

/**
 * The first screen: no profile yet. One thing to do, drop a résumé. The draft opens in the
 * profile editor to check before saving; nothing is kept until then.
 */
export function Onboarding({
  hosted,
  onDraft,
  onBlank,
}: {
  hosted: boolean
  onDraft: (d: ProfileData, notice: string) => void
  onBlank: (d: ProfileData, notice?: string) => void
}) {
  // the example lives on the landing page; if it can't load, the page works without it
  const [sample, setSample] = useState(true)
  return (
    <section className="onboard" aria-labelledby="onboard-title">
      <figure className="sample" hidden={!sample}>
        <video
          onError={() => setSample(false)}
          src={`${SAMPLE}/linear.mp4`}
          poster={`${SAMPLE}/linear.jpg`}
          autoPlay
          muted
          loop
          playsInline
          aria-label="An example film, made for Linear"
        />
        <figcaption>Made for Linear from linear.app and one résumé.</figcaption>
      </figure>
      <h1 id="onboard-title">A 30-second film for every company you apply to.</h1>
      <p className="lede">
        Paste a job link and coldopen reads the company’s site, picks the results from your résumé
        that answer the role, and renders a short film in their colors. You send the link and see
        when they watch.
      </p>
      <p className="proof-line">
        <b>60%</b> of the first 15 films got a reply. Beta users are seeing 50–70% more replies than
        with plain messages.
      </p>
      <ResumeDraft hosted={hosted} onDraft={onDraft}>
        <button type="button" className="link" onClick={() => onBlank(BLANK)}>
          Fill it in myself
        </button>
        <label className="example">
          <span className="sr">Start from an example</span>
          <select
            value=""
            onChange={(e) => {
              const ex = EXAMPLES.find((x) => x.id === e.target.value)
              if (ex)
                onBlank(
                  { ...ex.data, proof: ex.data.proof.map((x) => ({ ...x, where: x.where ?? '' })) },
                  `This is the ${ex.label.toLowerCase()} example. Replace every line with your own.`,
                )
            }}
          >
            <option value="" disabled>
              Or start from an example
            </option>
            {EXAMPLES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
      </ResumeDraft>
    </section>
  )
}

/** Drop a résumé, say the role, get a profile draft to check. Nothing is saved here. */
export function ResumeDraft({
  hosted,
  onDraft,
  children,
}: {
  hosted: boolean
  onDraft: (d: ProfileData, notice: string) => void
  children?: React.ReactNode
}) {
  const [file, setFile] = useState<File | null>(null)
  const [over, setOver] = useState(false)
  const [role, setRole] = useState('')
  const [exclude, setExclude] = useState('')

  const draft = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Choose your résumé first: PDF, Word, Markdown or text')
      if (!role.trim())
        throw new Error('Add the role you’re going for, so the right results are picked')
      return draftFromResume(
        file,
        role.trim(),
        exclude
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      )
    },
    onSuccess: ({ profile: p, meta }) =>
      onDraft(
        { ...p, proof: p.proof.map((x) => ({ ...x, where: x.where ?? '' })) },
        `Drafted from ${file?.name ?? 'your résumé'}. Every number is copied from it word for word. Read each line, then save.` +
          (meta.dropped.length
            ? ` ${meta.dropped.length} item${meta.dropped.length === 1 ? ' was' : 's were'} left out because ${meta.dropped.length === 1 ? 'it' : 'they'} couldn’t be matched to your résumé.`
            : ''),
      ),
  })

  return (
    <div className="resume">
      <label
        className={`drop${over ? ' over' : ''}${file ? ' has' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f) setFile(f)
        }}
      >
        <input
          type="file"
          className="sr"
          accept=".pdf,.docx,.md,.txt,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <>
            <b>{file.name}</b>
            <span>Choose a different file</span>
          </>
        ) : (
          <>
            <b>Drop your résumé here, or choose it</b>
            <span>PDF, Word or text{hosted ? '. Read once, not kept.' : ''}</span>
          </>
        )}
      </label>
      <div className="pair">
        <label>
          Role you’re going for
          <input
            value={role}
            placeholder="Solutions engineer"
            onChange={(e) => setRole(e.target.value)}
          />
        </label>
        <label>
          <span>
            Leave out <small>optional</small>
          </span>
          <input
            value={exclude}
            placeholder="A current employer, say"
            onChange={(e) => setExclude(e.target.value)}
          />
        </label>
      </div>
      {draft.error && <p className="error">{draft.error.message}</p>}
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={draft.isPending}
          onClick={() => draft.mutate()}
        >
          {draft.isPending ? 'Reading your résumé…' : 'Draft my profile'}
        </button>
        {children}
      </div>
    </div>
  )
}
