import { useQuery } from '@tanstack/react-query'
import { api, type Openers as OpenerStats } from './api.ts'

const LABEL = {
  homework: 'Your homework first',
  question: 'Your question first',
  film: 'Film first',
  proof: 'Your best number first',
} as const

/**
 * Which way of opening a message gets you more replies. A job seeker's drafts lead with their
 * homework or their question, a seller's with the film or their strongest number, half and
 * half; once you've sent a few of each, this shows the winner. Films sent before the homework
 * and question openers count under the way they opened.
 */
export function Openers() {
  const q = useQuery({ queryKey: ['openers'], queryFn: () => api<OpenerStats>('/v1/me/openers') })
  const d = q.data
  if (!d) return null
  // the pair you're sending now: the new one as soon as any film opened that way
  const pair =
    (d.homework?.sent ?? 0) + (d.question?.sent ?? 0) > 0
      ? (['homework', 'question'] as const)
      : (['film', 'proof'] as const)
  const [a, b] = pair
  if (d[a].sent + d[b].sent < 4) return null
  const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '–')
  return (
    <section className="openers" aria-labelledby="openers-title">
      <div className="films-head">
        <h2 id="openers-title">What's working</h2>
        <p className="rate">
          {d.leader ? `${LABEL[d.leader]} is winning` : 'Send 5 of each to see a winner'}
        </p>
      </div>
      <p className="jobs-note">
        Your drafts open two ways, half and half. Replies decide which one you keep.
      </p>
      <div className="opener-arms">
        {pair.map((k) => (
          <div key={k} className={d.leader === k ? 'arm lead' : 'arm'}>
            <b>{LABEL[k]}</b>
            <span className="arm-rate">{pct(d[k].replied, d[k].sent)}</span>
            <span className="small muted">
              {d[k].replied} replied of {d[k].sent} sent, {d[k].watched} watched
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
