import { existsSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { join, relative } from 'node:path'
import { z } from 'zod'
import { extractBrand } from './brand/extract.ts'
import { type Homework, readHomework, withHomework } from './brand/homework.ts'
import type { BrandKit } from './brand/types.ts'
import { withJob } from './job/kit.ts'
import { isJobPage, JobPostSchema, jobFromText } from './job/post.ts'
import { fetchJob } from './job/read.ts'
import { LlmHttpError } from './llm/openai.ts'
import { openerFor } from './outreach/messages.ts'
import { type FilmMessages, messagesSchemaFor, writeMessages } from './outreach/writer.ts'
import { withRole } from './profile/pitch.ts'
import { relatedWork } from './profile/related.ts'
import { compose, FORMATS, type Format, siteShot } from './render/composition.ts'
import {
  concatSegments,
  frameRange,
  type OpenComposition,
  openComposition,
  type QaReport,
  renderExtras,
  renderSegment,
  renderStills,
} from './render/render.ts'
import { buildTheme } from './render/theme.ts'
import { NonRetryableError } from './runtime/errors.ts'
import { defineAgent } from './runtime/types.ts'
import { editViolations, quotableFacts } from './script/checks.ts'
import type { FilmBrand, ReviewFact } from './script/review.ts'
import { buildStoryboard, captionFor, type Storyboard } from './script/storyboard.ts'
import {
  type Profile,
  ProfileSchema,
  type Script,
  type ScriptMeta,
  ScriptSchema,
} from './script/types.ts'
import { deterministicScript, writeScript } from './script/writer.ts'
import { publish, type ShareConfig } from './share/client.ts'
import { viewFromRun } from './share/page.ts'
import type { SlackClient } from './slack.ts'

export const FilmInputSchema = z.object({
  url: z.string().url(),
  profile: ProfileSchema,
  format: z.enum(['square', 'landscape', 'portrait']).default('square'),
  /** optional label, e.g. the prospect's row id in a CSV batch */
  ref: z.string().max(200).optional(),
  /** batch this film belongs to */
  batch: z.string().max(64).optional(),
  /** show exactly these proof items (indices into profile.proof) instead of the writer's pick */
  proof: z.array(z.number().int().min(0)).min(1).max(3).optional(),
  /** reply in this Slack thread when the film is ready */
  slack: z.object({ channel: z.string(), threadTs: z.string() }).optional(),
  /**
   * answer a job post: its URL, its pasted text, or (from the CLI) the post already read.
   * The film then quotes one of its requirements and answers it with the sender's proof.
   */
  job: z
    .object({
      url: z.string().url().optional(),
      text: z.string().min(40).max(30_000).optional(),
      title: z.string().max(120).optional(),
      post: JobPostSchema.optional(),
    })
    .refine((j) => j.url || j.text || j.post, 'job needs a url, text, or post')
    .optional(),
  /** a script the person edited: used as written (after the hard checks) instead of writing one */
  script: ScriptSchema.optional(),
  /** the film this one re-renders with an edited script */
  editOf: z.string().max(64).optional(),
  /**
   * the fact the sender swapped in from the review: matched by its text first, then its id,
   * since a re-read of their site may number the facts differently
   */
  fact: z.object({ id: z.string().max(40), text: z.string().max(400) }).optional(),
  /** show the company's name as the logo (the sender chose it in the review) */
  wordmark: z.boolean().optional(),
  /** with a share worker: the share link expires after this many days (hosted app visitors) */
  keepDays: z.number().int().min(1).max(365).optional(),
  /**
   * the day the film is made (ms since 1970), for tests and evals: what counts as a recent post
   * is measured from it, so a fixture film doesn't change as the calendar moves. Defaults to now,
   * journaled with the homework so a replay picks the same.
   */
  now: z.number().int().positive().optional(),
})
export type FilmInput = z.infer<typeof FilmInputSchema>

export interface FilmResult {
  company: string
  host: string
  format: Format
  durationSec: number
  /** paths relative to FILMS_DIR */
  files: {
    film: string
    poster: string
    gif: string
    sheet: string
    kit: string
    storyboard: string
    /** one still per scene, from its midpoint, for the review (films made since step 10) */
    scenes?: string[]
  }
  script: Script
  scriptMeta: ScriptMeta
  qa: QaReport
  render: { frames: number; ms: number }
  /** the role this film answers, when made from a job post */
  job?: { title: string; url?: string }
  /** where the film is published, when a share worker is configured (the hosted app) */
  shared?: { id: string; link: string }
  /** the sender's project closest to this company and role: see profile/related.ts */
  related?: { name: string; url: string; line: string }
  /** what they've published lately, beyond the homepage: see brand/homework.ts */
  homework?: Homework
  /** the profile as the film used it, when the film filled it in (hiring films) */
  profile?: Profile
  /** what the review reads about the brand: the logo or wordmark, font stand-ins, contrast */
  brand?: FilmBrand
  /** the facts the film could quote (the featured one too), for "Use another fact" */
  facts?: ReviewFact[]
  /** what the film says, for writing the message that goes with it */
  highlights?: {
    /**
     * the line quoted from their site or job post, and where it's from: `source` is the host
     * or "your <title> post", `caption` the words under the quote ("From their changelog,
     * Oct 2026") and `url` the page, when it's an https link
     */
    quote: { text: string; source: string; caption?: string; url?: string }
    proof: { value: string; label: string; where?: string }[]
  }
  /**
   * the connection note, the message once they accept, InMail and the email, written by the
   * model and checked in code (outreach/writer.ts). Absent when no model wrote them: the API
   * uses the templates then.
   */
  messages?: FilmMessages
}

export interface FilmAgentOptions {
  filmsDir: string
  /** null = deterministic writer (no model, free, reproducible) */
  llmModel: string | null
  /** posts finished films back to Slack threads, when configured */
  slack?: SlackClient | null
  /** base URL for share links, e.g. https://films.example.com */
  publicUrl?: string
  /** research localhost / private-network sites (local CLI, tests); off for hosted use */
  allowPrivateNetworks?: boolean
  /** publish each finished film to a share worker, so it outlives this machine's disk */
  share?: ShareConfig | null
  /**
   * scenes rendered at once, each in its own Chromium page (its own renderer process). Defaults
   * to one fewer than the CPU count, between 1 and 4: rendering is CPU-bound.
   */
  renderPages?: number
}

/** how many scenes to render at once on this machine */
export function defaultRenderPages(cpus = availableParallelism()): number {
  return Math.max(1, Math.min(4, cpus - 1))
}

const exists = (p: string) =>
  stat(p).then(
    (s) => s.size > 0,
    () => false,
  )

/**
 * The film agent. Each ctx.* call is a checkpoint: kill the worker mid-render and the next
 * one replays research, script and finished scenes from the journal, then renders only the
 * scenes that never finished.
 */
export function createFilmAgent(opts: FilmAgentOptions) {
  return defineAgent({
    name: 'film',
    input: FilmInputSchema,
    async run(ctx, input: FilmInput): Promise<FilmResult> {
      let profile = input.profile
      const format = input.format
      const dir = join(opts.filmsDir, ctx.runId)
      const rel = (p: string) => relative(opts.filmsDir, p)
      await mkdir(dir, { recursive: true })

      // a job post: read once (journaled). A job link pasted as the website is the post itself,
      // and the film is about the company it links to.
      const jobLink = !input.job && isJobPage(input.url)
      const j = input.job ?? (jobLink ? { url: input.url } : undefined)
      let post: z.infer<typeof JobPostSchema> | undefined
      if (j) {
        ctx.progress({ stage: 'research', label: 'Reading the job post' })
        try {
          post = await ctx.step(
            'job',
            async () =>
              j.post ??
              (j.text
                ? jobFromText(j.text, j.title, j.url)
                : await fetchJob(j.url!, {
                    allowPrivateNetworks: opts.allowPrivateNetworks ?? false,
                  })),
            { retries: 1 },
          )
        } catch (err) {
          // already worded for the person (a login wall): say it as is
          if (err instanceof NonRetryableError) throw err
          // an unreadable post won't read on the next attempt either
          throw new NonRetryableError(
            `could not read the job post: ${err instanceof Error ? err.message.split('\n')[0] : err}`,
          )
        }
      }
      if (jobLink && !post?.companyUrl)
        throw new NonRetryableError(
          "couldn't find the company's website from that job post. Paste the company's website, and the job link under 'Answer a job post'",
        )
      const site = jobLink ? post!.companyUrl! : input.url

      ctx.progress({ stage: 'research', label: `Reading ${new URL(site).hostname}` })
      let kit: BrandKit
      try {
        kit = await ctx.step(
          'research',
          () =>
            extractBrand(site, {
              outDir: dir,
              allowPrivateNetworks: opts.allowPrivateNetworks ?? false,
            }),
          {
            retries: 1,
          },
        )
      } catch (err) {
        const reason = err instanceof Error ? err.message.split('\n')[0]! : String(err)
        if (input.slack && opts.slack) {
          const slack = opts.slack
          const thread = input.slack
          await ctx.tool(
            'slack-error',
            () =>
              slack.postMessage(
                thread.channel,
                `I couldn't open ${site}: ${reason}`,
                thread.threadTs,
              ),
            { mode: 'at-most-once' },
          )
        }
        // a site that won't load after retries won't load on the next execution either
        throw new NonRetryableError(`could not read ${site}: ${reason}`)
      }

      if (post) kit = withJob(kit, post)

      // homework: what they've published lately (blog, changelog, news, podcast), for the brief
      // and the email. Best effort and time-boxed: a site without feeds still gets its film.
      ctx.progress({ stage: 'research', label: `Reading what ${kit.name} published lately` })
      const homework = await ctx.step('homework', () =>
        Promise.race([
          readHomework(site, {
            allowPrivateNetworks: opts.allowPrivateNetworks ?? false,
            ...(input.now ? { now: input.now } : {}),
          }),
          new Promise<Homework>((done) =>
            setTimeout(() => done({ items: [], pages: [] }), 20_000).unref(),
          ),
        ]).catch((): Homework => ({ items: [], pages: [] })),
      )
      // a hiring film takes its lines from the post and its numbers from their site
      if (profile.preset === 'hiring') profile = withRole(profile, kit, post?.url ?? j?.url ?? site)
      // the sender's own project closest to this company and role, for the share page and email
      const related = (() => {
        const r = relatedWork(profile, kit)
        return r ? { name: r.name, url: r.url, line: r.line } : null
      })()

      // the fact scene may quote anything they've published, not just the homepage: their
      // posts, changelog, podcast notes and docs join the facts, each with where it's from.
      // Pure given the journaled homework (its readAt is the pinned day), so replays match.
      kit = withHomework(kit, homework)

      ctx.progress({ stage: 'script', label: `Writing the script for ${kit.name}` })
      const builtIn = (usedFallback: boolean) =>
        ctx.step('script', async () => ({
          script: deterministicScript(kit, profile),
          meta: {
            model: 'deterministic',
            rounds: 1,
            violations: [[]],
            usedFallback,
            replaced: [],
          } as ScriptMeta,
        }))
      let written: { script: Script; meta: ScriptMeta }
      if (input.script) {
        // the person's own words. The site may have changed since the first film: if the fact it
        // featured is gone, feature the one the built-in writer would pick.
        let s = input.script
        // a fact swapped in from the review: the same words, wherever the re-read numbered it
        const swap = input.fact
        if (swap) {
          const same = (a: string) => a.trim().toLowerCase() === swap.text.trim().toLowerCase()
          const found =
            kit.facts.find((f) => same(f.text)) ?? kit.facts.find((f) => f.id === swap.id)
          if (found) s = { ...s, insight: { ...s.insight, factId: found.id } }
        }
        if (!kit.facts.some((f) => f.id === s.insight.factId))
          s = {
            ...s,
            insight: { ...s.insight, factId: deterministicScript(kit, profile).insight.factId },
          }
        const bad = editViolations(s, kit, profile)
        if (bad.length)
          throw new NonRetryableError(`the edited script can't be used: ${bad.join('; ')}`)
        const edited = s
        written = await ctx.step('script', async () => ({
          script: edited,
          meta: {
            model: 'edited',
            rounds: 1,
            violations: [[]],
            usedFallback: false,
            replaced: [],
          } as ScriptMeta,
        }))
      } else if (!opts.llmModel) written = await builtIn(false)
      else {
        try {
          written = await writeScript({
            kit,
            profile,
            model: opts.llmModel,
            complete: (key, messages) => ctx.llm(key, { schema: ScriptSchema, messages }),
          })
        } catch (err) {
          // every model is rate limited or down: a plain, correct script beats no film
          if (
            !(err instanceof LlmHttpError) &&
            !/HTTP (429|5\d\d)|fetch failed|timeout|ECONN/i.test(String(err))
          )
            throw err
          ctx.progress({ stage: 'script', label: 'Models are busy; using the built-in writer' })
          written = await builtIn(true)
        }
      }
      const { script, meta } = written

      const picked = input.proof?.filter((i) => i < profile.proof.length)
      const board: Storyboard = buildStoryboard(
        kit,
        profile,
        picked?.length ? { ...script, proof: picked } : script,
      )
      const storyboardFile = join(dir, 'storyboard.json')
      const highlights = highlightsOf(board)

      // the messages that carry the film, written before compose, so a crash mid-render replays
      // them from the journal instead of calling the model again. An edited film writes them
      // again: its lines may be the ones a draft used.
      let messages: FilmMessages | null = null
      if (opts.llmModel && (profile.preset === 'candidate' || profile.preset === 'sales')) {
        ctx.progress({ stage: 'script', label: `Writing the messages for ${kit.name}` })
        // the research pick depends on the date: journaled, so a replay picks the same post
        const now = await ctx.step('messages-clock', async () => Date.now())
        const model = opts.llmModel
        const film = {
          company: kit.name,
          ...(kit.job ? { job: kit.job } : {}),
          script,
          highlights,
          ...(related ? { related } : {}),
          requirements: kit.facts.filter((f) => f.kind === 'requirement').map((f) => f.text),
        }
        let written: FilmMessages | null = null
        try {
          written = await writeMessages({
            film,
            profile,
            homework,
            // a job seeker's film opens with the homework or the question, as the API serves it
            opener: openerFor(ctx.runId, profile.preset),
            model,
            now,
            complete: (key, m) =>
              ctx.llm(key, { schema: messagesSchemaFor(profile.preset), messages: m }),
          })
        } catch (err) {
          // every model is rate limited or down, or can't keep to the shape: the templates write
          // the messages (the API falls back to them), and the film still ships
          if (
            !(err instanceof LlmHttpError) &&
            !/HTTP (429|5\d\d)|fetch failed|timeout|ECONN|failed validation/i.test(String(err))
          )
            throw err
          ctx.log(`messages fell back to templates: ${String(err).split('\n')[0]}`)
        }
        const result = written
        messages = await ctx.step('messages', async () => result)
      }

      ctx.progress({ stage: 'design', label: `Matching ${kit.name}'s brand` })
      const composed = await ctx.step('compose', async () => {
        const theme = await buildTheme(kit, profile, {
          allowPrivateNetworks: opts.allowPrivateNetworks ?? false,
        })
        const site = siteShot(kit, board)
        const shot = await readFile(join(dir, site.file)).catch(() =>
          readFile(join(dir, kit.screenshot.file)),
        )
        const html = compose({
          board,
          kit,
          theme,
          format,
          screenshotDataUrl: `data:image/jpeg;base64,${shot.toString('base64')}`,
          shotBox: existsSync(join(dir, site.file)) ? site.box : kit.screenshot.headlineBox,
          ...(input.wordmark ? { wordmark: true } : {}),
        })
        const file = join(dir, `composition-${format}.html`)
        await writeFile(file, html)
        await writeFile(storyboardFile, JSON.stringify({ board, script, meta }, null, 2))
        const brand: FilmBrand = {
          logo: kit.logo && !input.wordmark ? 'image' : 'wordmark',
          ...(kit.logo ? { logoSize: { width: kit.logo.width, height: kit.logo.height } } : {}),
          fallbacks: theme.fallbacks,
          fonts: { display: kit.fonts.display.family, body: kit.fonts.body.family },
          contrast: theme.contrast,
          about: { headline: kit.headline, description: kit.description },
        }
        return { file: rel(file), fontsEmbedded: theme.fontsEmbedded, brand }
      })

      // Chromium pages, opened only if something still needs rendering. Scenes render in
      // parallel, one per page; each scene is still its own checkpoint, so a crash redoes only
      // the scenes that were in progress.
      const html = () => readFile(join(opts.filmsDir, composed.file), 'utf8')
      const pool: OpenComposition[] = []
      const idle: OpenComposition[] = []
      const waiting: ((c: OpenComposition) => void)[] = []
      const width = Math.max(
        1,
        Math.min(opts.renderPages ?? defaultRenderPages(), board.scenes.length),
      )
      let opening = 0
      const acquire = async (): Promise<OpenComposition> => {
        const free = idle.pop()
        if (free) return free
        if (pool.length + opening < width) {
          opening++
          try {
            const c = await openComposition(await html(), format)
            pool.push(c)
            return c
          } finally {
            opening--
          }
        }
        return new Promise((r) => waiting.push(r))
      }
      const release = (c: OpenComposition) => {
        const next = waiting.shift()
        if (next) next(c)
        else idle.push(c)
      }
      const withPage = async <T>(fn: (c: OpenComposition) => Promise<T>): Promise<T> => {
        const c = await acquire()
        try {
          return await fn(c)
        } finally {
          release(c)
        }
      }

      try {
        const totalFrames = Math.round(board.duration * 30)
        const doneFrames = new Map<number, number>()
        let t = 0
        const ranges = board.scenes.map((scene) => {
          const r = frameRange(t, t + scene.dur)
          t += scene.dur
          return r
        })
        // every step is started here, in scene order, before any is awaited: replays see the
        // same sequence of steps whatever order they finish in
        const renders = ranges.map(([f0, f1], i) => {
          const file = join(dir, `scene-${i}-${format}.mp4`)
          return ctx
            .step(`render:${i}`, () =>
              withPage(async (c) => {
                const r = await renderSegment(c.page, {
                  f0,
                  f1,
                  file,
                  onFrame: (done) => {
                    doneFrames.set(i, done)
                    const all = [...doneFrames.values()].reduce((a, b) => a + b, 0)
                    ctx.progress({
                      stage: 'render',
                      label: `Rendering ${board.scenes.length} scenes`,
                      scene: i,
                      percent: Math.min(99, Math.round((all / totalFrames) * 100)),
                    })
                  },
                })
                return { file: rel(file), ...r }
              }),
            )
            .then(async (seg) => {
              // replayed on another machine without a shared volume: render that scene here
              if (!(await exists(join(opts.filmsDir, seg.file))))
                await withPage((c) => renderSegment(c.page, { f0, f1, file }))
              return seg
            })
        })
        const settled = await Promise.allSettled(renders)
        const failed = settled.find((r) => r.status === 'rejected')
        if (failed) throw (failed as PromiseRejectedResult).reason
        const segs = settled.map(
          (r) => (r as PromiseFulfilledResult<{ file: string; frames: number; ms: number }>).value,
        )
        const segments = segs.map((g) => join(opts.filmsDir, g.file))
        const frames = segs.reduce((a, g) => a + g.frames, 0)
        // CPU time across pages; the film's wall clock is in the step timings
        const ms = segs.reduce((a, g) => a + g.ms, 0)

        ctx.progress({ stage: 'encode', label: 'Encoding the film, GIF and poster', percent: 100 })
        const out = await ctx.step('encode', async () => {
          const film = join(dir, `film-${format}.mp4`)
          await concatSegments(segments, film)
          const sceneStarts = board.scenes.map((_, i) =>
            board.scenes.slice(0, i).reduce((a, x) => a + x.dur, 0),
          )
          const c = await acquire()
          const extras = await renderExtras(c.page, {
            outDir: dir,
            film,
            format,
            posterAt: 2.6,
            gifFrom: sceneStarts[1]! + 0.6,
            sheetAt: board.scenes.map((s, i) => sceneStarts[i]! + s.dur * 0.72),
          })
          // one still per scene, at its midpoint, for the review's strip of frames
          const stills = await renderStills(c.page, {
            outDir: dir,
            at: board.scenes.map((s, i) => sceneStarts[i]! + s.dur / 2),
          })
          return {
            film: rel(film),
            poster: rel(extras.poster),
            gif: rel(extras.gif),
            sheet: rel(extras.sheet),
            scenes: stills.map(rel),
            qa: c.report,
          }
        })

        // the hosted app's disk is temporary: the film lives on the share worker from here on
        let shared: { id: string; link: string } | undefined
        if (opts.share) {
          const cfg = opts.share
          ctx.progress({ stage: 'deliver', label: 'Publishing the share link', percent: 100 })
          shared = await ctx.step(
            'publish',
            () =>
              publish(cfg, {
                id: `${
                  kit.name
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, '')
                    .slice(0, 40) || 'film'
                }-${ctx.runId.slice(-10).toLowerCase()}`,
                view: viewFromRun({ ...input, profile }, {
                  ...(related ? { related } : {}),
                  company: kit.name,
                  format,
                  files: { film: out.film },
                  highlights,
                } as FilmResult),
                dir,
                ...(input.keepDays ? { ttlSeconds: input.keepDays * 86_400 } : {}),
              }),
            { retries: 2 },
          )
        }

        if (input.slack && opts.slack) {
          const slack = opts.slack
          const thread = input.slack
          const share = opts.publicUrl
            ? `${opts.publicUrl.replace(/\/$/, '')}/f/${ctx.runId}`
            : null
          ctx.progress({ stage: 'deliver', label: 'Posting to Slack', percent: 100 })
          // Slack uploads have no idempotency key: at-most-once, so a crash here can never
          // post the film twice. If it's ambiguous, the run stops for a human to check.
          await ctx.tool(
            'slack-reply',
            () =>
              slack.uploadFile({
                channel: thread.channel,
                threadTs: thread.threadTs,
                file: join(opts.filmsDir, out.film),
                title: `${kit.name}: ${board.duration}s film`,
                comment: `Here's the film for ${kit.name}.${share ? ` Share page: ${share}` : ''}`,
              }),
            { mode: 'at-most-once' },
          )
        }

        return {
          company: kit.name,
          host: kit.host,
          format,
          durationSec: board.duration,
          files: {
            film: out.film,
            poster: out.poster,
            gif: out.gif,
            sheet: out.sheet,
            kit: rel(join(dir, 'kit.json')),
            storyboard: rel(storyboardFile),
            scenes: out.scenes,
          },
          script,
          scriptMeta: meta,
          qa: out.qa,
          render: { frames, ms },
          ...(kit.job ? { job: kit.job } : {}),
          ...(shared ? { shared } : {}),
          highlights,
          ...(messages ? { messages } : {}),
          ...(homework.items.length || homework.pages.length ? { homework } : {}),
          ...(related ? { related } : {}),
          // a hiring film's profile was filled in from the post and the site
          ...(profile !== input.profile ? { profile } : {}),
          brand: composed.brand,
          facts: factsFor(kit, profile, script.insight.factId),
        }
      } finally {
        await Promise.all(pool.map((c) => c.close()))
      }
    },
  })
}

export const FORMAT_SIZES = FORMATS

/**
 * The facts a review may offer in place of the featured one: those that read on their own,
 * featured first, then in the order the writers prefer them (the kit's), with their captions.
 */
export function factsFor(kit: BrandKit, profile: Profile, featured: string): ReviewFact[] {
  const own = profile.preset === 'recruiter' || profile.preset === 'hiring'
  const ok = quotableFacts(kit)
  const list = [
    ...kit.facts.filter((f) => f.id === featured),
    ...ok.filter((f) => f.id !== featured),
  ]
  return list.slice(0, 12).map((f) => ({
    id: f.id,
    text: f.text,
    kind: f.kind,
    caption: captionFor(f, { own, ...(kit.job ? { job: kit.job.title } : {}) }),
    ...(f.source?.url && /^https:\/\/\S{4,300}$/.test(f.source.url) ? { url: f.source.url } : {}),
  }))
}

function highlightsOf(board: Storyboard): FilmResult['highlights'] {
  const insight = board.scenes.find((s) => s.kind === 'insight')
  const proof = board.scenes.find((s) => s.kind === 'proof')
  return {
    quote:
      insight?.kind === 'insight'
        ? {
            text: insight.value ? `${insight.value} ${insight.text}` : insight.text,
            source: insight.source,
            caption: insight.caption,
            ...(insight.sourceUrl ? { url: insight.sourceUrl } : {}),
          }
        : { text: '', source: '' },
    proof: proof?.kind === 'proof' ? proof.stats : [],
  }
}
