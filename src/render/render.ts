import { spawn } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'puppeteer'
import { getBrowser } from '../browser.ts'
import { FORMATS, type Format } from './composition.ts'

export const FPS = 30
const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg'

export interface QaReport {
  duration: number
  issues: { kind: string; text?: string; scene?: string }[]
  fonts: string[]
}

export interface OpenComposition {
  page: Page
  report: QaReport
  close: () => Promise<void>
}

/** Load a composition into a page sized exactly to the film and wait for fonts + fitting. */
export async function openComposition(html: string, format: Format): Promise<OpenComposition> {
  const { width, height } = FORMATS[format]
  const browser = await getBrowser()
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width, height, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'load', timeout: 60_000 })
  const report = (await page.evaluate('window.__ready')) as QaReport
  return { page, report, close: () => context.close().catch(() => {}) }
}

export async function seek(page: Page, t: number): Promise<void> {
  await page.evaluate((x) => (window as unknown as { __seek: (t: number) => void }).__seek(x), t)
}

/** Frame range [from, to) in seconds, for one scene or the whole film. */
export function frameRange(from: number, to: number, fps = FPS): [number, number] {
  return [Math.round(from * fps), Math.round(to * fps)]
}

function ffmpeg(
  args: string[],
  input?: 'pipe',
): { proc: ReturnType<typeof spawn>; done: Promise<void> } {
  const proc = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: [input === 'pipe' ? 'pipe' : 'ignore', 'ignore', 'pipe'],
  })
  let err = ''
  proc.stderr?.on('data', (d) => {
    err += d.toString()
  })
  const done = new Promise<void>((resolve, reject) => {
    proc.on('error', (e) => reject(new Error(`could not start ffmpeg (${FFMPEG}): ${e.message}`)))
    proc.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.slice(-800)}`)),
    )
  })
  return { proc, done }
}

/**
 * Render frames [f0, f1) to an H.264 segment. Each segment is self-contained, so scenes can
 * be rendered by different workers (or resumed after a crash) and concatenated losslessly.
 */
export async function renderSegment(
  page: Page,
  opts: {
    f0: number
    f1: number
    file: string
    fps?: number
    onFrame?: (done: number, total: number) => void
  },
): Promise<{ frames: number; ms: number }> {
  const fps = opts.fps ?? FPS
  const started = Date.now()
  const { proc, done } = ffmpeg(
    [
      '-f',
      'image2pipe',
      '-framerate',
      String(fps),
      '-c:v',
      'mjpeg',
      '-i',
      '-',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(fps),
      '-g',
      String(fps * 2),
      '-movflags',
      '+faststart',
      opts.file,
    ],
    'pipe',
  )
  const stdin = proc.stdin!
  const total = opts.f1 - opts.f0
  try {
    for (let f = opts.f0; f < opts.f1; f++) {
      await seek(page, f / fps)
      const jpg = (await page.screenshot({
        type: 'jpeg',
        quality: 94,
        optimizeForSpeed: true,
      })) as Uint8Array
      if (!stdin.write(jpg)) await new Promise((r) => stdin.once('drain', r))
      opts.onFrame?.(f - opts.f0 + 1, total)
    }
  } finally {
    stdin.end()
  }
  await done
  return { frames: total, ms: Date.now() - started }
}

export async function concatSegments(files: string[], out: string): Promise<void> {
  const list = `${out}.txt`
  await writeFile(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'))
  try {
    const { done } = ffmpeg([
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      out,
    ])
    await done
  } finally {
    await rm(list, { force: true })
  }
}

/** Poster frame, an email-ready looping GIF, and a contact sheet of key moments. */
export async function renderExtras(
  page: Page,
  opts: {
    outDir: string
    film: string
    posterAt: number
    sheetAt: number[]
    gifFrom: number
    format: Format
  },
): Promise<{ poster: string; gif: string; sheet: string }> {
  const poster = join(opts.outDir, 'poster.jpg')
  await seek(page, opts.posterAt)
  await page.screenshot({ path: poster, type: 'jpeg', quality: 90 })

  const tmp = join(opts.outDir, '.sheet')
  await mkdir(tmp, { recursive: true })
  for (const [i, t] of opts.sheetAt.entries()) {
    await seek(page, t)
    await page.screenshot({ path: join(tmp, `k${i}.jpg`), type: 'jpeg', quality: 88 })
  }
  const sheet = join(opts.outDir, 'contact-sheet.jpg')
  const cols = 3
  const rows = Math.ceil(opts.sheetAt.length / cols)
  const tileW = opts.format === 'portrait' ? 270 : 480
  await ffmpeg([
    '-framerate',
    '1',
    '-i',
    join(tmp, 'k%d.jpg'),
    '-vf',
    `scale=${tileW}:-1,tile=${cols}x${rows}:padding=8:margin=8:color=0x16181d`,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    sheet,
  ]).done
  await rm(tmp, { recursive: true, force: true })

  // a 4.5 s loop of their own homepage being highlighted: the GIF an outreach email embeds
  const gif = join(opts.outDir, 'preview.gif')
  const w = opts.format === 'landscape' ? 600 : 480
  await ffmpeg([
    '-ss',
    String(opts.gifFrom),
    '-t',
    '4.5',
    '-i',
    opts.film,
    '-filter_complex',
    `fps=12,scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`,
    '-loop',
    '0',
    gif,
  ]).done
  return { poster, gif, sheet }
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
}
