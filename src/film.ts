import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { z } from 'zod'
import { extractBrand } from './brand/extract.ts'
import type { BrandKit } from './brand/types.ts'
import { withJob } from './job/kit.ts'
import { JobPostSchema, jobFromText } from './job/post.ts'
import { fetchJob } from './job/read.ts'
import { compose, FORMATS, type Format } from './render/composition.ts'
import {
  concatSegments,
  frameRange,
  type OpenComposition,
  openComposition,
  type QaReport,
  renderExtras,
  renderSegment,
} from './render/render.ts'
import { buildTheme } from './render/theme.ts'
import { NonRetryableError } from './runtime/errors.ts'
import { defineAgent } from './runtime/types.ts'
import { buildStoryboard, type Storyboard } from './script/storyboard.ts'
import { ProfileSchema, type Script, type ScriptMeta, ScriptSchema } from './script/types.ts'
import { deterministicScript, writeScript } from './script/writer.ts'
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
  }
  script: Script
  scriptMeta: ScriptMeta
  qa: QaReport
  render: { frames: number; ms: number }
  /** the role this film answers, when made from a job post */
  job?: { title: string; url?: string }
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
      const profile = input.profile
      const format = input.format
      const dir = join(opts.filmsDir, ctx.runId)
      const rel = (p: string) => relative(opts.filmsDir, p)
      await mkdir(dir, { recursive: true })

      ctx.progress({ stage: 'research', label: `Reading ${new URL(input.url).hostname}` })
      let kit: BrandKit
      try {
        kit = await ctx.step(
          'research',
          () =>
            extractBrand(input.url, {
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
                `I couldn't open ${input.url}: ${reason}`,
                thread.threadTs,
              ),
            { mode: 'at-most-once' },
          )
        }
        // a site that won't load after retries won't load on the next execution either
        throw new NonRetryableError(`could not read ${input.url}: ${reason}`)
      }

      // a job post: read once (journaled), then its requirements join the company's facts
      if (input.job) {
        const j = input.job
        ctx.progress({ stage: 'research', label: 'Reading the job post' })
        let post: z.infer<typeof JobPostSchema>
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
          // an unreadable post won't read on the next attempt either
          throw new NonRetryableError(
            `could not read the job post: ${err instanceof Error ? err.message.split('\n')[0] : err}`,
          )
        }
        kit = withJob(kit, post)
      }

      ctx.progress({ stage: 'script', label: `Writing the script for ${kit.name}` })
      const { script, meta } = opts.llmModel
        ? await writeScript({
            kit,
            profile,
            model: opts.llmModel,
            complete: (key, messages) => ctx.llm(key, { schema: ScriptSchema, messages }),
          })
        : await ctx.step('script', async () => ({
            script: deterministicScript(kit, profile),
            meta: {
              model: 'deterministic',
              rounds: 1,
              violations: [[]],
              usedFallback: false,
              replaced: [],
            } as ScriptMeta,
          }))

      const picked = input.proof?.filter((i) => i < profile.proof.length)
      const board: Storyboard = buildStoryboard(
        kit,
        profile,
        picked?.length ? { ...script, proof: picked } : script,
      )
      const storyboardFile = join(dir, 'storyboard.json')

      ctx.progress({ stage: 'design', label: `Matching ${kit.name}'s brand` })
      const composed = await ctx.step('compose', async () => {
        const theme = await buildTheme(kit, profile)
        const shot = await readFile(join(dir, kit.screenshot.file))
        const html = compose({
          board,
          kit,
          theme,
          format,
          screenshotDataUrl: `data:image/jpeg;base64,${shot.toString('base64')}`,
        })
        const file = join(dir, `composition-${format}.html`)
        await writeFile(file, html)
        await writeFile(storyboardFile, JSON.stringify({ board, script, meta }, null, 2))
        return { file: rel(file), fontsEmbedded: theme.fontsEmbedded }
      })

      // One Chromium page per execution, opened only if something still needs rendering.
      let comp: OpenComposition | null = null
      const page = async () => {
        if (!comp)
          comp = await openComposition(
            await readFile(join(opts.filmsDir, composed.file), 'utf8'),
            format,
          )
        return comp
      }

      try {
        const segments: string[] = []
        let frames = 0
        let ms = 0
        let t = 0
        const totalFrames = Math.round(board.duration * 30)
        for (const [i, scene] of board.scenes.entries()) {
          const [f0, f1] = frameRange(t, t + scene.dur)
          t += scene.dur
          const file = join(dir, `scene-${i}-${format}.mp4`)
          const seg = await ctx.step(`render:${i}`, async () => {
            const c = await page()
            const r = await renderSegment(c.page, {
              f0,
              f1,
              file,
              onFrame: (done) =>
                ctx.progress({
                  stage: 'render',
                  label: `Rendering scene ${i + 1} of ${board.scenes.length}`,
                  scene: i,
                  percent: Math.round(((f0 + done) / totalFrames) * 100),
                }),
            })
            return { file: rel(file), ...r }
          })
          // replayed from another machine without a shared volume: re-render that scene locally
          if (!(await exists(join(opts.filmsDir, seg.file)))) {
            await renderSegment((await page()).page, { f0, f1, file })
          }
          segments.push(join(opts.filmsDir, seg.file))
          frames += seg.frames
          ms += seg.ms
        }

        ctx.progress({ stage: 'encode', label: 'Encoding the film, GIF and poster', percent: 100 })
        const out = await ctx.step('encode', async () => {
          const film = join(dir, `film-${format}.mp4`)
          await concatSegments(segments, film)
          const sceneStarts = board.scenes.map((_, i) =>
            board.scenes.slice(0, i).reduce((a, x) => a + x.dur, 0),
          )
          const c = await page()
          const extras = await renderExtras(c.page, {
            outDir: dir,
            film,
            format,
            posterAt: 2.6,
            gifFrom: sceneStarts[1]! + 0.6,
            sheetAt: board.scenes.map((s, i) => sceneStarts[i]! + s.dur * 0.72),
          })
          return {
            film: rel(film),
            poster: rel(extras.poster),
            gif: rel(extras.gif),
            sheet: rel(extras.sheet),
            qa: c.report,
          }
        })

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
          },
          script,
          scriptMeta: meta,
          qa: out.qa,
          render: { frames, ms },
          ...(kit.job ? { job: kit.job } : {}),
        }
      } finally {
        if (comp) await (comp as OpenComposition).close()
      }
    },
  })
}

export const FORMAT_SIZES = FORMATS
