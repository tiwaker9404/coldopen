import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, send, type Target, type Targets } from './api.ts'
import { safeUrl } from './safe.ts'
import { ErrorNote, useToast } from './ui.tsx'

/**
 * Network this week, on Today: the companies most worth a film and a warm message right now,
 * whether or not they have an opening, each with the plain reasons it's on the list. One button
 * starts the film from their website; "Not for me" takes a company off (undo in the toast).
 */
export function NetworkThisWeek({ onMake }: { onMake: (site: string) => void }) {
  const q = useQuery({
    queryKey: ['targets'],
    queryFn: () => api<Targets>('/v1/targets?limit=10'),
    staleTime: 5 * 60_000,
  })
  const r = q.data
  if (q.isPending) return null
  if (q.isError)
    return (
      <section className="targets" aria-labelledby="targets-title">
        <h2 id="targets-title">Network this week</h2>
        <ErrorNote error={q.error} lead="Couldn’t work out this week’s companies: " />
      </section>
    )
  if (!r || r.data.length === 0) return null
  const { made, target } = r.week
  return (
    <section className="targets" aria-labelledby="targets-title">
      <div className="films-head">
        <h2 id="targets-title">Network this week</h2>
        <p className="rate">
          {made} of {target} this week
          <span className="sr-only"> (films made, against your weekly target)</span>
        </p>
      </div>
      <p className="jobs-note">
        {r.roles.length ? `For ${r.roles.join(', ')}. ` : ''}
        The companies most worth a film and a warm message now, opening or not.
      </p>
      <ul className="target-list">
        {r.data.map((t) => (
          <li key={t.site}>
            <TargetCard t={t} onMake={onMake} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function TargetCard({ t, onMake }: { t: Target; onMake: (site: string) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['targets'] })
    void qc.invalidateQueries({ queryKey: ['jobs'] })
    void qc.invalidateQueries({ queryKey: ['startups'] })
  }
  const undo = useMutation({
    mutationFn: () => send('POST', '/v1/targets/unhide', { site: t.site }),
    onSettled: refresh,
  })
  const hide = useMutation({
    mutationFn: () => send('POST', '/v1/targets/hide', { site: t.site }),
    onMutate: () => {
      // gone from the list straight away; the server catches up
      qc.setQueryData<Targets>(['targets'], (d) =>
        d ? { ...d, data: d.data.filter((x) => x.site !== t.site) } : d,
      )
    },
    onSuccess: () =>
      toast({
        text: `${t.company} is off your list.`,
        action: { label: 'Undo', run: () => undo.mutate() },
      }),
    onSettled: refresh,
  })
  const titleId = `target-${t.site.replace(/[^a-z0-9]+/gi, '-')}`
  return (
    <article className="target" aria-labelledby={titleId}>
      <div className="target-what">
        <h3 id={titleId}>
          <a href={safeUrl(t.site)} target="_blank" rel="noreferrer">
            {t.company}
          </a>
        </h3>
        {t.oneLiner && <p className="startup-line">{t.oneLiner}</p>}
        <p className="job-why">
          {t.yc && <span className="tag yc">YC {t.yc.batch}</span>}
          {/* small teams say their size in the first reason already */}
          {t.teamSize && t.teamSize > 200 ? (
            <span className="tag">
              {t.teamSize} {t.teamSize === 1 ? 'person' : 'people'}
            </span>
          ) : null}
        </p>
        <ul className="target-reasons" aria-label={`Why ${t.company}`}>
          {t.reasons.map((why) => (
            <li key={why}>{why}</li>
          ))}
        </ul>
        <ErrorNote error={hide.error} inline />
      </div>
      <div className="target-do">
        <button type="button" className="primary" onClick={() => onMake(t.site)}>
          Make the film
        </button>
        <button
          type="button"
          className="link"
          disabled={hide.isPending}
          onClick={() => hide.mutate()}
          aria-label={`Not for me: hide ${t.company}`}
        >
          Not for me
        </button>
      </div>
    </article>
  )
}
