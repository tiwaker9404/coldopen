import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ago,
  api,
  type Film,
  type FollowUps as FollowUpList,
  type OutreachStatus,
  send,
} from './api.ts'
import { Copy } from './FilmPanel.tsx'

const enc = encodeURIComponent

/**
 * Sent films that are due a nudge, oldest first, each with its follow-up written and one click
 * from Gmail. Shown only when something is due.
 */
export function FollowUps({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ['followups'], queryFn: () => api<FollowUpList>('/v1/followups') })
  const list = q.data?.data ?? []
  if (list.length === 0) return null
  return (
    <section className="followups" aria-labelledby="followups-title">
      <div className="films-head">
        <h2 id="followups-title">Follow up today</h2>
        <p className="rate">
          {list.length} due{q.data!.waiting > 0 && `, ${q.data!.waiting} waiting`}
        </p>
      </div>
      <p className="jobs-note">
        No reply yet. A short nudge brings many replies; two at most, then let it go.
      </p>
      <ul className="job-list">
        {list.map((d) => (
          <li key={d.film.id}>
            <FollowUp item={d} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function FollowUp({
  item,
  onOpen,
}: {
  item: FollowUpList['data'][number]
  onOpen: (id: string) => void
}) {
  const qc = useQueryClient()
  const { film, next, message } = item
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['followups'] })
    void qc.invalidateQueries({ queryKey: ['films'] })
    void qc.invalidateQueries({ queryKey: ['outreach'] })
  }
  // gone from the list straight away; the server catches up
  const drop = () =>
    qc.setQueryData<FollowUpList>(['followups'], (d) =>
      d ? { ...d, data: d.data.filter((x) => x.film.id !== film.id) } : d,
    )
  const followed = useMutation({
    mutationFn: () => send<Film>('POST', `/v1/films/${film.id}/followup`),
    onMutate: drop,
    onSettled: refresh,
  })
  const mark = useMutation({
    mutationFn: (status: OutreachStatus) =>
      send<Film>('PUT', `/v1/films/${film.id}/outreach`, { status }),
    onMutate: drop,
    onSettled: refresh,
  })
  const o = film.outreach!
  const since = o.followedUpAt ? `Followed up ${ago(o.followedUpAt)}` : `Sent ${ago(o.sentAt)}`
  return (
    <div className="job followup">
      <div className="job-what">
        <b>{film.company ?? film.host}</b>
        <button type="button" className="link title-link" onClick={() => onOpen(film.id)}>
          {film.job?.title ?? 'Your film'}
        </button>
        <span className="job-why">
          <span className="tag">{since}</span>
          <span className="tag quiet">
            {next.kind === 'close'
              ? 'Two follow-ups, no reply'
              : next.step === 1
                ? 'First follow-up'
                : 'Last note'}
          </span>
        </span>
        {message && (
          <details className="followup-msg">
            <summary>Read the message</summary>
            <pre>{message.body}</pre>
          </details>
        )}
      </div>
      <div className="job-do followup-do">
        {message ? (
          <>
            <a
              className="button primary-link"
              href={`https://mail.google.com/mail/?view=cm&fs=1${message.to ? `&to=${enc(message.to)}` : ''}&su=${enc(message.subject)}&body=${enc(message.body)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Gmail
            </a>
            <Copy text={message.linkedin} label="Copy for LinkedIn" done="Follow-up copied" />
            <button type="button" onClick={() => followed.mutate()} disabled={followed.isPending}>
              I sent it
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={() => mark.mutate('no_reply')}
            disabled={mark.isPending}
          >
            Mark no reply
          </button>
        )}
        <button
          type="button"
          className="link"
          onClick={() => mark.mutate('replied')}
          disabled={mark.isPending}
        >
          They replied
        </button>
      </div>
    </div>
  )
}
