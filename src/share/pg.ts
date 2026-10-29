import type { Sql } from '../db/index.ts'
import type { ViewRow, ViewStore, ViewSummary } from './views.ts'

type DbRow = Omit<ViewRow, 'firstSeen' | 'lastSeen' | 'seconds'> & {
  firstSeen: Date | string
  lastSeen: Date | string
  seconds: number | string
}

const toRow = (r: DbRow): ViewRow => ({
  ...r,
  firstSeen: new Date(r.firstSeen).toISOString(),
  lastSeen: new Date(r.lastSeen).toISOString(),
  seconds: Number(r.seconds),
})

/** Sessions in Postgres. Concurrent reports for one session only ever move it forward. */
export function pgViewStore(sql: Sql): ViewStore {
  return {
    async get(filmId, session) {
      const [r] = await sql<DbRow[]>`
        select * from film_views where film_id = ${filmId} and session = ${session}`
      return r ? toRow(r) : undefined
    },
    async put(row) {
      await sql`
        insert into film_views ${sql(row as unknown as Record<string, unknown>)}
        on conflict (film_id, session) do update set
          last_seen = greatest(film_views.last_seen, excluded.last_seen),
          played = film_views.played or excluded.played,
          seconds = greatest(film_views.seconds, excluded.seconds),
          finished = film_views.finished or excluded.finished`
    },
  }
}

export async function filmViews(sql: Sql, filmId: string, limit = 100) {
  const [rows, summaries] = await Promise.all([
    sql<DbRow[]>`
      select * from film_views where film_id = ${filmId} order by last_seen desc limit ${limit}`,
    viewSummaries(sql, [filmId]),
  ])
  return { summary: summaries.get(filmId) ?? NO_VIEWS, sessions: rows.map(toRow) }
}

/** One summary per film, in one query, for film lists and CSV exports. */
export async function viewSummaries(sql: Sql, ids: string[]): Promise<Map<string, ViewSummary>> {
  if (ids.length === 0) return new Map()
  const rows = await sql<
    {
      filmId: string
      opens: number
      viewers: number
      plays: number
      finishes: number
      bestSeconds: number
      firstPlayAt: Date | null
      lastSeen: Date | null
    }[]
  >`
    select film_id,
      count(*)::int as opens,
      count(distinct viewer)::int as viewers,
      (count(*) filter (where played))::int as plays,
      (count(*) filter (where finished))::int as finishes,
      coalesce(max(seconds), 0)::float8 as best_seconds,
      min(first_seen) filter (where played) as first_play_at,
      max(last_seen) as last_seen
    from film_views where film_id = any(${ids}) group by film_id`
  return new Map(
    rows.map((r) => [
      r.filmId,
      {
        opens: r.opens,
        viewers: r.viewers,
        plays: r.plays,
        finishes: r.finishes,
        bestSeconds: Math.round(r.bestSeconds * 10) / 10,
        firstPlayAt: r.firstPlayAt ? new Date(r.firstPlayAt).toISOString() : null,
        lastSeen: r.lastSeen ? new Date(r.lastSeen).toISOString() : null,
      },
    ]),
  )
}

export const NO_VIEWS: ViewSummary = {
  opens: 0,
  viewers: 0,
  plays: 0,
  finishes: 0,
  bestSeconds: 0,
  firstPlayAt: null,
  lastSeen: null,
}
