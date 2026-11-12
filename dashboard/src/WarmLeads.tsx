import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { draftTouch } from '../../src/outreach/warm.ts'
import { api, send, type TouchKind, type WarmLeads as WarmList } from './api.ts'
import { Copy } from './FilmPanel.tsx'
import { safeUrl } from './safe.ts'
import { ErrorNote } from './ui.tsx'

type Item = WarmList['data'][number]

/** what each touch is, in a few words */
const KIND: Record<TouchKind, string> = {
  thankYou: 'Thank-you',
  proofOfWork: 'What you built',
  stayInTouch: 'Stay in touch',
  referralAsk: 'Referral ask',
  referralBump: 'One bump',
}
const HINT: Record<TouchKind, string> = {
  thankYou: 'Send it today. Name one thing they said, and ask who else to talk to.',
  proofOfWork: 'Built from what they said. Paste the link, then send it.',
  stayInTouch: 'Six weeks on: something new, no ask.',
  referralAsk:
    'A role that fits just opened there. One ask, a way out, and a blurb they can forward.',
  referralBump: 'A week since the ask. One short bump, then let it go.',
}

/**
 * Warm leads, on Today above Network this week: people who replied, and the one touch due for
 * each. Every touch comes drafted; the sender sends it themselves, then marks it done. Shown
 * only when something is due.
 */
export function WarmLeads() {
  const q = useQuery({ queryKey: ['warm'], queryFn: () => api<WarmList>('/v1/warm') })
  const list = q.data?.data ?? []
  if (q.isError)
    return (
      <section className="warm" aria-labelledby="warm-title">
        <h2 id="warm-title">Warm leads</h2>
        <ErrorNote error={q.error} lead="Couldn’t load your warm leads: " />
      </section>
    )
  if (list.length === 0) return null
  const n = q.data!.month.conversations
  return (
    <section className="warm" aria-labelledby="warm-title">
      <div className="films-head">
        <h2 id="warm-title">Warm leads</h2>
        <p className="rate">
          {n} {n === 1 ? 'conversation' : 'conversations'} this month
        </p>
      </div>
      <p className="jobs-note">
        They replied. Thank them, keep in touch, and ask for a referral when a role that fits opens.
      </p>
      <ul className="job-list">
        {list.map((d) => (
          <li key={`${d.film.id}:${d.next.kind}:${d.next.role?.id ?? ''}`}>
            <WarmTouch item={d} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function WarmTouch({ item }: { item: Item }) {
  const qc = useQueryClient()
  const id = useId()
  const { film, next, draft } = item
  const [said, setSaid] = useState(item.said ?? '')
  const [build, setBuild] = useState(item.buildNote ?? '')
  const [link, setLink] = useState('')
  const refresh = () => void qc.invalidateQueries({ queryKey: ['warm'] })
  // gone from the list straight away; the server catches up
  const drop = () =>
    qc.setQueryData<WarmList>(['warm'], (d) =>
      d ? { ...d, data: d.data.filter((x) => x.film.id !== film.id) } : d,
    )
  const done = useMutation({
    mutationFn: () =>
      send('POST', `/v1/warm/${film.id}/done`, {
        kind: next.kind,
        ...(next.role ? { roleId: next.role.id } : {}),
        ...(next.kind === 'thankYou' ? { said: said.trim() } : {}),
        ...(next.kind === 'thankYou' && build.trim() ? { buildNote: build.trim() } : {}),
        ...(next.kind === 'proofOfWork' ? { buildLink: link.trim() } : {}),
      }),
    onSuccess: drop,
    onSettled: refresh,
  })
  const stop = useMutation({
    mutationFn: () => send('POST', `/v1/warm/${film.id}/stop`),
    onMutate: drop,
    onSettled: refresh,
  })

  // the thank-you and the proof-of-work note are drafted again as the sender types
  const profile = item.profile
  const live =
    profile && (next.kind === 'thankYou' || next.kind === 'proofOfWork')
      ? draftTouch({
          kind: next.kind,
          company: film.company ?? film.host ?? '',
          profile,
          said: next.kind === 'thankYou' ? said : item.said,
          buildNote: next.kind === 'thankYou' ? build : item.buildNote,
          buildLink: link,
        })
      : null
  const body = live?.body ?? draft.body
  const who = film.recipient?.name ?? 'They'
  const company = film.company ?? film.host ?? 'their company'
  const copied = draft.blurb ? `${body}\n\n——\n\nTo forward:\n\n${draft.blurb}` : body
  const ready =
    next.kind === 'thankYou'
      ? said.trim().length >= 3
      : next.kind === 'proofOfWork'
        ? /^https:\/\/\S{4,}$/.test(link.trim())
        : true

  return (
    <article className="job warm-touch" aria-labelledby={`${id}-who`}>
      <div className="job-what">
        <h3 id={`${id}-who`} className="warm-who">
          {who} <span className="muted">at {company}</span>
        </h3>
        <span className="job-why">
          <span className="tag">{KIND[next.kind]}</span>
          {next.role && (
            <a className="tag quiet" href={safeUrl(next.role.url)} target="_blank" rel="noreferrer">
              {next.role.title}
            </a>
          )}
        </span>
        <p className="small muted">{HINT[next.kind]}</p>
        {next.kind === 'thankYou' && (
          <div className="warm-boxes">
            <label>
              <span>One thing they said</span>
              <input
                value={said}
                maxLength={240}
                onChange={(e) => setSaid(e.target.value)}
                placeholder="how they onboard new carriers by hand"
              />
            </label>
            <label>
              <span>Something I’ll build from what you said (optional)</span>
              <input
                value={build}
                maxLength={160}
                onChange={(e) => setBuild(e.target.value)}
                placeholder="a small script that checks carrier rates every morning"
              />
            </label>
          </div>
        )}
        {next.kind === 'proofOfWork' && (
          <div className="warm-boxes">
            <label>
              <span>Link to what you built</span>
              <input
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                placeholder="https://github.com/you/the-thing"
              />
            </label>
          </div>
        )}
        <details className="followup-msg" open={next.kind !== 'stayInTouch'}>
          <summary>Read the message</summary>
          <pre>{body}</pre>
          {draft.blurb && (
            <>
              <p className="small muted">A blurb they can forward to the hiring manager:</p>
              <pre>{draft.blurb}</pre>
            </>
          )}
        </details>
        {item.flags.length > 0 && !live && (
          <ul className="small warm-flags" aria-label="Check before sending">
            {item.flags.map((f) => (
              <li key={`${f.rule}${f.why}`}>{f.why}</li>
            ))}
          </ul>
        )}
        <ErrorNote error={done.error ?? stop.error} inline />
      </div>
      <div className="job-do followup-do">
        <Copy
          text={copied}
          label={draft.blurb ? 'Copy the ask and blurb' : 'Copy'}
          done="Copied. Send it yourself, then mark it done."
          className="primary"
        />
        <button
          type="button"
          onClick={() => done.mutate()}
          disabled={done.isPending || !ready}
          title={ready ? undefined : 'Fill in the box above first'}
        >
          Mark done
        </button>
        <button
          type="button"
          className="link"
          onClick={() => stop.mutate()}
          disabled={stop.isPending}
          aria-label={`Stop reminders for ${who} at ${company}`}
        >
          Stop reminders
        </button>
      </div>
    </article>
  )
}
