import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { PER_DAY_MAX, PER_DAY_MIN } from '../../src/autopilot/settings.ts'
import { ApiError, type Autopilot, type AutopilotToday, api, type Format, send } from './api.ts'
import { safeUrl } from './safe.ts'
import { ErrorNote } from './ui.tsx'

/**
 * Autopilot, on the Profile page: films a weekday for Network this week's companies, on the
 * days they pick, from the profile and in the format they pick. Turning it on makes nothing
 * straight away; "See today's pick" shows which companies the next run's films are for.
 */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const FORMATS: { id: Format; label: string }[] = [
  { id: 'square', label: 'Square' },
  { id: 'landscape', label: 'Landscape' },
  { id: 'portrait', label: 'Portrait' },
]

export function AutopilotSection() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['autopilot'],
    queryFn: () => api<Autopilot>('/v1/autopilot'),
    retry: (n, e) => !(e instanceof ApiError && e.status === 403) && n < 2,
  })
  const [form, setForm] = useState<Autopilot | null>(null)
  const [perDay, setPerDay] = useState('20')
  const [showToday, setShowToday] = useState(false)
  useEffect(() => {
    if (!q.data) return
    setForm(q.data)
    setPerDay(String(q.data.perDay))
  }, [q.data])

  const save = useMutation({
    mutationFn: (body: Omit<Autopilot, 'profiles' | 'profileGone' | 'note'>) =>
      send<Autopilot>('PUT', '/v1/autopilot', body),
    onSuccess: (data) => {
      qc.setQueryData(['autopilot'], data)
      void qc.invalidateQueries({ queryKey: ['autopilot-today'] })
    },
  })

  const denied = q.error instanceof ApiError && q.error.status === 403
  const head = (
    <div className="section-head">
      <div>
        <h2 id="autopilot-title">Autopilot</h2>
        <p className="section-sub">
          Makes films for Network this week’s companies on the days you pick, best first. Turning it
          on makes nothing straight away: the next daily run does.
        </p>
      </div>
    </div>
  )
  if (q.isPending) return null
  if (denied || q.isError || !form)
    return (
      <section className="section" aria-labelledby="autopilot-title">
        {head}
        {denied ? <p className="empty">{q.error?.message}</p> : <ErrorNote error={q.error} />}
      </section>
    )

  const n = Number(perDay)
  const perDayOk = Number.isInteger(n) && n >= PER_DAY_MIN && n <= PER_DAY_MAX
  const set = (patch: Partial<Autopilot>) => setForm({ ...form, ...patch })
  const toggleDay = (d: number) =>
    set({
      days: form.days.includes(d)
        ? form.days.filter((x) => x !== d)
        : [...form.days, d].sort((a, b) => a - b),
    })
  const profileId = form.profileGone ? null : (form.profileId ?? form.profiles[0]?.id ?? null)
  const submit = (on = form.on) =>
    save.mutate({
      on,
      perDay: n,
      days: form.days,
      profileId,
      format: form.format,
      webhook: form.webhook?.trim() ? form.webhook.trim() : null,
    })

  return (
    <section className="section autopilot" aria-labelledby="autopilot-title">
      {head}
      {form.note && <p className="note">{form.note}</p>}
      <form
        className="autopilot-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <label className="check autopilot-on">
          <input
            type="checkbox"
            role="switch"
            aria-checked={form.on}
            checked={form.on}
            onChange={(e) => set({ on: e.target.checked })}
          />
          Autopilot is {form.on ? 'on' : 'off'}
        </label>

        <label>
          <span>Films a weekday</span>
          <input
            type="number"
            inputMode="numeric"
            min={PER_DAY_MIN}
            max={PER_DAY_MAX}
            value={perDay}
            aria-invalid={!perDayOk}
            aria-describedby="per-day-why"
            onChange={(e) => setPerDay(e.target.value)}
          />
          <small id="per-day-why">
            {perDayOk ? '' : `Pick a whole number from ${PER_DAY_MIN} to ${PER_DAY_MAX}. `}20 a
            weekday is 100 a week; LinkedIn allows about 100 connection requests a week, so the rest
            go by email.
          </small>
        </label>

        <fieldset className="autopilot-days">
          <legend>Days</legend>
          {DAYS.map((d, i) => (
            <label key={d} className={`chip${form.days.includes(i + 1) ? ' on' : ''}`}>
              <input
                type="checkbox"
                checked={form.days.includes(i + 1)}
                onChange={() => toggleDay(i + 1)}
                aria-label={DAY_NAMES[i]}
              />
              <span aria-hidden="true">{d}</span>
            </label>
          ))}
        </fieldset>

        <div className="autopilot-row">
          <label>
            <span>Profile</span>
            <select
              value={profileId ?? ''}
              onChange={(e) => set({ profileId: e.target.value, profileGone: false, note: '' })}
            >
              {form.profileGone && <option value="">Pick a profile</option>}
              {form.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Format</span>
            <select value={form.format} onChange={(e) => set({ format: e.target.value as Format })}>
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label>
          <span>
            Webhook <small>optional</small>
          </span>
          <input
            type="url"
            value={form.webhook ?? ''}
            placeholder="https://hooks.slack.com/services/…"
            onChange={(e) => set({ webhook: e.target.value })}
          />
          <small>A Slack or Discord webhook gets a note after each run.</small>
        </label>

        <ErrorNote error={save.error} lead="Couldn’t save Autopilot: " />
        <div className="actions">
          <button type="submit" className="primary" disabled={!perDayOk || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save Autopilot'}
          </button>
          <button type="button" onClick={() => setShowToday(true)}>
            See today’s pick
          </button>
          {save.isSuccess && !save.isPending && <small role="status">Saved.</small>}
        </div>
      </form>
      {showToday && <TodaysPick />}
    </section>
  )
}

/** The companies today's films would be for, without making anything */
function TodaysPick() {
  const q = useQuery({
    queryKey: ['autopilot-today'],
    queryFn: () => api<AutopilotToday>('/v1/autopilot/today'),
  })
  if (q.isPending) return <p className="hint">Working out today’s pick…</p>
  if (q.isError) return <ErrorNote error={q.error} lead="Couldn’t work out today’s pick: " />
  const t = q.data
  return (
    <section className="autopilot-today" aria-labelledby="autopilot-today-title">
      <h3 id="autopilot-today-title">Today’s pick</h3>
      <p className="hint">
        {t.runs
          ? `${t.picks.length} film${t.picks.length === 1 ? '' : 's'} for today`
          : 'Autopilot isn’t running today, but this is who it would pick'}
        {t.madeToday ? `, after the ${t.madeToday} already made` : ''}.
      </p>
      {t.picks.length === 0 ? (
        <p className="empty">Nobody left to pick today.</p>
      ) : (
        <ol className="autopilot-picks">
          {t.picks.map((p) => (
            <li key={p.site}>
              <a href={safeUrl(p.site)} target="_blank" rel="noreferrer">
                {p.company}
              </a>
              <small>{p.reasons[0]}</small>
            </li>
          ))}
        </ol>
      )}
      {t.skipped.length > 0 && (
        <p className="hint">Skipped: {t.skipped.map((s) => s.why).join('; ')}.</p>
      )}
    </section>
  )
}
