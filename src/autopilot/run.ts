import { consume, filmLimit, refund } from '../api/accounts.ts'
import type { Config } from '../config.ts'
import type { Sql } from '../db/index.ts'
import { FilmInputSchema } from '../film.ts'
import { hostOf, RECENT_DAYS, type Target, WEEK_ZONE } from '../jobs/targets.ts'
import { createRun } from '../runtime/store.ts'
import { type Profile, ProfileSchema } from '../script/types.ts'
import { dayOf, isOn, PICKED_MAX, type Picked, pickToday, type Skipped, untried } from './pick.ts'
import type { AutopilotSettings } from './settings.ts'

/**
 * The morning run: makes today's Autopilot films, at most ONE per owner per call, so a GitHub
 * Actions job calling it every 3 minutes spaces the films out (Groq's free tier allows about
 * 8k tokens a minute, and a film's script and messages take several thousand).
 *
 * The first call of the day stores the day's pick on the autopilot_runs row, best first, and
 * every later call works through that stored list, so the order can't change if scoring does
 * during the morning, and a run that stopped halfway carries on where it left off. Films go
 * through createRun like any other (the batches route's way), so they get the normal limits,
 * pipeline and model chain. Nothing is ever sent to anyone.
 */

export interface AutopilotDeps {
  /** Network this week's companies scored from this profile, best first (the cached, sliced scorer) */
  targets: (owner: string, profileId: string) => Promise<Target[]>
  /** start renderers for the films just queued */
  kick: () => void
}

export interface OwnerResult {
  owner: string
  /** the film made on this call, if any */
  made: string | null
  /** films still to make today */
  remaining: number
  /** nothing more to make today: at films a weekday, out of picks, off today, or at a limit */
  done: boolean
  /** why it's done before films a weekday, in plain words */
  why?: string
}

type Row = AutopilotSettings & { owner: string }
interface DayRow {
  picked: Picked[] | null
  made: { id: string; site: string; company: string; at: string }[] | null
  skipped: Skipped[] | null
}

export async function runAutopilotOnce(
  sql: Sql,
  cfg: Config,
  now: number,
  deps: AutopilotDeps,
): Promise<{ owners: OwnerResult[]; done: boolean }> {
  const rows = await sql<Row[]>`
    select owner, "on", per_day, days, profile_id, format, webhook
    from autopilot where "on" order by owner`
  const owners: OwnerResult[] = []
  for (const row of rows) {
    try {
      owners.push(await runOwner(sql, cfg, now, deps, { ...row, days: [...row.days] }))
    } catch (err) {
      // one owner's trouble never stops the others' films; the next call tries again
      owners.push({
        owner: row.owner,
        made: null,
        remaining: row.perDay,
        done: false,
        why: `couldn't make a film this time: ${String(err).split('\n')[0]}`,
      })
    }
  }
  if (owners.some((o) => o.made)) deps.kick()
  return { owners, done: owners.every((o) => o.done) }
}

async function runOwner(
  sql: Sql,
  cfg: Config,
  now: number,
  deps: AutopilotDeps,
  s: Row,
): Promise<OwnerResult> {
  const day = dayOf(now)
  const finished = (why?: string): OwnerResult => ({
    owner: s.owner,
    made: null,
    remaining: 0,
    done: true,
    ...(why ? { why } : {}),
  })
  if (!isOn(s, now)) return finished('today is not one of its days')

  const profile = s.profileId ? await jobSeekerProfile(sql, s.owner, s.profileId) : undefined
  if (!profile) {
    // the profile it films from was deleted (or isn't a job seeker's now): off until they pick one
    const why = 'the profile Autopilot used is gone, so Autopilot turned off'
    await sql`update autopilot set "on" = false, updated_at = now() where owner = ${s.owner}`
    await sql`
      insert into autopilot_runs (owner, day, picked, made, skipped)
      values (${s.owner}, ${day.date}::date, '[]', '[]', ${sql.json([{ site: '', why }] as never)})
      on conflict (owner, day) do update
        set skipped = coalesce(autopilot_runs.skipped, '[]'::jsonb) || excluded.skipped`
    return finished(why)
  }

  // the day's pick, stored once: best first, with room for picks that fail
  const [have] = await sql<{ n: number }[]>`
    select count(*)::int as n from autopilot_runs where owner = ${s.owner} and day = ${day.date}::date`
  if (!have?.n) {
    const targets = await deps.targets(s.owner, s.profileId!)
    const { picks, skipped } = pickToday({
      targets,
      settings: { perDay: PICKED_MAX },
      madeToday: [],
      now,
    })
    await sql`
      insert into autopilot_runs (owner, day, picked, made, skipped)
      values (${s.owner}, ${day.date}::date, ${sql.json(picks as never)}, '[]',
        ${sql.json(skipped as never)})
      on conflict (owner, day) do nothing`
  }

  // one call at a time per owner, so two overlapping calls can't both make the same film
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql
    await t`select pg_advisory_xact_lock(hashtext(${`autopilot:${s.owner}`}))`
    const [run] = await t<DayRow[]>`
      select picked, made, skipped from autopilot_runs
      where owner = ${s.owner} and day = ${day.date}::date`
    const today = await t<{ host: string | null; failed: boolean }[]>`
      select coalesce(output->>'host', input->>'url') as host,
        status in ('failed', 'cancelled') as failed
      from runs where agent = 'film' and owner = ${s.owner} and origin = 'autopilot'
        and (created_at at time zone ${WEEK_ZONE})::date = ${day.date}::date`
    const madeN = today.filter((f) => !f.failed).length
    if (madeN >= s.perDay) return finished()

    // companies filmed by hand since the pick, and anything already tried today
    const byHand = await t<{ host: string | null }[]>`
      select coalesce(output->>'host', input->>'url') as host from runs
      where agent = 'film' and owner = ${s.owner} and origin is distinct from 'autopilot'
        and status not in ('failed', 'cancelled')
        and created_at > now() - make_interval(days => ${RECENT_DAYS})`
    const skipped: Skipped[] = [...(run?.skipped ?? [])]
    const tried = [
      ...today.map((f) => f.host ?? ''),
      ...byHand.map((f) => f.host ?? ''),
      ...skipped.map((x) => x.site),
    ]
    const queue = untried(run?.picked ?? [], tried)
    const unlimited = await unlimitedOwner(t, cfg, s.owner)
    let made: { id: string; site: string; company: string } | null = null
    let stop: string | undefined
    let next = 0
    for (const p of queue) {
      next++
      const parsed = FilmInputSchema.safeParse({
        url: /^https?:\/\//i.test(p.site) ? p.site : `https://${p.site}`,
        profile,
        format: s.format,
        ...(unlimited ? {} : { keepDays: s.owner.startsWith('u:') ? 30 : 7 }),
      })
      if (!parsed.success || !hostOf(p.site)) {
        skipped.push({
          site: p.site,
          why: `${p.company}'s website isn't a link a film can start from`,
        })
        continue
      }
      const limit = unlimited ? null : await takeFilm(t, cfg, s.owner)
      if (limit) {
        stop = limit
        break
      }
      const r = await createRun(t, {
        agent: 'film',
        input: parsed.data,
        owner: s.owner,
        origin: 'autopilot',
      })
      made = { id: r.run.id, site: p.site, company: p.company }
      break
    }
    await t`
      update autopilot_runs set
        made = coalesce(made, '[]'::jsonb) || ${sql.json((made ? [{ ...made, at: new Date(now).toISOString() }] : []) as never)},
        skipped = ${sql.json(skipped as never)}
      where owner = ${s.owner} and day = ${day.date}::date`
    const count = madeN + (made ? 1 : 0)
    const left = Math.max(0, s.perDay - count)
    // picks after the one just filmed are still there for the next call
    const more = next < queue.length
    const done = left === 0 || !!stop || !more
    return {
      owner: s.owner,
      made: made?.id ?? null,
      remaining: done ? 0 : left,
      done,
      ...(stop
        ? { why: stop }
        : !more && left > 0
          ? { why: 'no companies left to pick today' }
          : {}),
    }
  }) as Promise<OwnerResult>
}

/** their profile by id, only while it's a job seeker's */
async function jobSeekerProfile(sql: Sql, owner: string, id: string): Promise<Profile | undefined> {
  const [p] = await sql<{ data: unknown }[]>`
    select data from profiles where owner = ${owner} and id = ${id}`
  const parsed = p ? ProfileSchema.safeParse(p.data) : null
  return parsed?.success && parsed.data.preset === 'candidate' ? parsed.data : undefined
}

/** a private install, its operator, or an account in UNLIMITED_GITHUB_USERS: no daily limit */
async function unlimitedOwner(sql: Sql, cfg: Config, owner: string): Promise<boolean> {
  if (!cfg.HOSTED || owner === 'team') return true
  if (!owner.startsWith('u:') || !cfg.UNLIMITED_GITHUB_USERS.length) return false
  const [u] = await sql<{ login: string }[]>`select login from users where id = ${owner.slice(2)}`
  return !!u && cfg.UNLIMITED_GITHUB_USERS.includes(u.login.toLowerCase())
}

/**
 * The same daily limits a film made by hand counts against (the person's and coldopen's), so
 * Autopilot can never make more than they could. Returns why it stopped, or null.
 */
async function takeFilm(sql: Sql, cfg: Config, owner: string): Promise<string | null> {
  if (!(await consume(sql, `films:${owner}`, filmLimit(cfg, owner)))) {
    await refund(sql, `films:${owner}`)
    return `that's your ${filmLimit(cfg, owner)} films for today`
  }
  if (!(await consume(sql, 'global', cfg.GLOBAL_DAILY_FILMS))) {
    await refund(sql, 'global')
    await refund(sql, `films:${owner}`)
    return 'coldopen has made all the films it can today'
  }
  return null
}
