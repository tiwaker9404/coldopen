/**
 * A 30-second reel for one role, rendered by coldopen's own engine like every film: an HTML
 * timeline with paused animations, seeked frame by frame and encoded with ffmpeg.
 *
 *   node launch/stills.ts .scratch/stills          # once: stills from the demo build
 *   node launch/role-reel.ts launch/reels/gtm.json --format square --stills .scratch/stills --out .scratch/reels
 *
 * Clips come from the demo's films (site/media/demo/), stills from launch/stills.ts; nothing
 * is mocked by hand. Silent, like the films.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { closeBrowser, getBrowser } from '../src/browser.ts'
import { renderSegment, seek } from '../src/render/render.ts'
import {
  checkReel,
  demoFilms,
  FORMATS,
  ITEM_S,
  loadReel,
  type ReelFormat,
  reelLength,
  TITLE_S,
} from './reels.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    format: { type: 'string', default: 'square' },
    stills: { type: 'string', default: '.scratch/stills' },
    out: { type: 'string', default: '.scratch/reels' },
  },
})
const format = values.format as ReelFormat
if (!(format in FORMATS)) throw new Error(`unknown format "${format}": square or wide`)
const { w: W, h: H } = FORMATS[format]
const wide = format === 'wide'
const FPS = 30

const file = positionals[0]
if (!file) throw new Error('which reel? node launch/role-reel.ts launch/reels/gtm.json')
const reel = loadReel(file)
const stills = resolve(values.stills!)
const films = demoFilms()
const problems = checkReel(reel, { stillsDir: stills, films })
if (problems.length) throw new Error(problems.join('\n'))

const name = basename(file, '.json')
const outDir = resolve(values.out!)
const work = join(outDir, `${name}-${format}-build`)
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })

// 1. each item's pictures: a film's frames for its few seconds, or one still
const media = reel.items.map((it, i) => {
  const dir = join(work, `i${i}`)
  mkdirSync(dir)
  if ('film' in it) {
    execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-ss',
      String(it.from),
      '-t',
      String(ITEM_S),
      '-i',
      films.get(it.film)!,
      '-vf',
      `fps=${FPS},scale=${wide ? 900 : 760}:-1`,
      '-q:v',
      '3',
      join(dir, '%04d.jpg'),
    ])
    return { dir: `i${i}`, n: readdirSync(dir).length, still: false }
  }
  writeFileSync(join(dir, 'still.png'), readFileSync(join(stills, `${it.still}.png`)))
  return { dir: `i${i}`, n: 1, still: true }
})

// 2. the dashboard's own type, embedded
const require = createRequire(import.meta.url)
const font = (pkg: string, f: string) =>
  `data:font/woff2;base64,${readFileSync(join(dirname(require.resolve(`@fontsource-variable/${pkg}/package.json`)), 'files', f)).toString('base64')}`
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)

const END = reelLength(reel)
const items = reel.items
  .map((it, i) => {
    const m = media[i]!
    const pics = m.still
      ? `<img class="still" src="${m.dir}/still.png" alt="">`
      : Array.from(
          { length: m.n },
          (_, k) => `<img class="f" src="${m.dir}/${String(k + 1).padStart(4, '0')}.jpg" alt="">`,
        ).join('')
    return `<section class="s item" data-i="${i}" data-n="${m.n}"><div class="media${m.still ? '' : ' film'}">${pics}</div><div class="side"><p class="n">${String(i + 1).padStart(2, '0')} / ${String(reel.items.length).padStart(2, '0')}</p><p class="cap">${esc(it.caption)}</p></div></section>`
  })
  .join('')

// the brand (docs/BRAND.md): Stock yellow for the title and the credits, the screening room between
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Big Shoulders';src:url(${font('big-shoulders-display', 'big-shoulders-display-latin-wght-normal.woff2')});font-weight:100 900}
@font-face{font-family:'Instrument Sans';src:url(${font('instrument-sans', 'instrument-sans-latin-wght-normal.woff2')});font-weight:400 700}
:root{--stock:#ffc21a;--muted-stock:#3d3420;--room:#17181b;--ink:#f2f2ee;--muted:#b3b5b9;--tally:#e5291f;--u:${Math.min(W, H) / 100}px}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:var(--room)}
body{font-family:'Instrument Sans';color:var(--ink);-webkit-font-smoothing:antialiased}
.s{position:absolute;inset:0;display:none;padding:calc(var(--u)*7)}
.s.on{display:flex}
.stock{background:var(--stock);color:#000;flex-direction:column;justify-content:center}
.display{font-family:'Big Shoulders';font-weight:800;line-height:.92}
.mark{display:flex;align-items:center;gap:calc(var(--u)*2.2);font-size:calc(var(--u)*9)}
.lens{width:calc(var(--u)*3.2);height:calc(var(--u)*3.2);border-radius:50%;background:var(--tally)}
.role{margin-top:calc(var(--u)*6);font-size:calc(var(--u)*3.2);font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--muted-stock)}
.title{margin-top:calc(var(--u)*1.6);font-size:calc(var(--u)*${wide ? 9 : 10});max-width:${wide ? '70%' : '92%'}}
.url{margin-top:calc(var(--u)*5);font-size:calc(var(--u)*3.4);font-weight:650;border-bottom:calc(var(--u)*.4) solid #000;align-self:flex-start}
.stripe{position:absolute;left:0;right:0;bottom:0;height:calc(var(--u)*2.4);background:repeating-linear-gradient(-55deg,#fff 0 calc(var(--u)*2.2),#000 calc(var(--u)*2.2) calc(var(--u)*4.4))}
.item{flex-direction:${wide ? 'row' : 'column-reverse'};gap:calc(var(--u)*4);align-items:${wide ? 'center' : 'stretch'}}
.media{position:relative;${wide ? 'flex:0 0 62%;height:100%' : 'flex:1;min-height:0'};border-radius:calc(var(--u)*1.4);overflow:hidden;background:#000;display:flex;align-items:center;justify-content:center}
.media .f{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:none}
.media .f.on{display:block}
.still{width:100%;height:100%;object-fit:contain;transform-origin:50% 0}
.side{${wide ? 'flex:1' : ''}}
.n{font-family:'Big Shoulders';font-weight:700;font-size:calc(var(--u)*3);color:var(--stock);letter-spacing:.04em}
.cap{margin-top:calc(var(--u)*1.2);font-size:calc(var(--u)*${wide ? 4.4 : 4.2});line-height:1.25;font-weight:600;max-width:34ch}
.a{animation-play-state:paused}
.up{animation:up 700ms cubic-bezier(.16,1,.3,1) both}
@keyframes up{from{opacity:0;transform:translateY(calc(var(--u)*3))}to{opacity:1;transform:none}}
</style></head><body>
<section class="s stock" id="title">
  <div class="mark display a up"><div class="lens"></div>coldopen</div>
  <p class="role a up" style="animation-delay:300ms">For ${esc(reel.role)} roles</p>
  <h1 class="display title a up" style="animation-delay:600ms">${esc(reel.title)}</h1>
  <div class="stripe"></div>
</section>
${items}
<section class="s stock" id="end">
  <div class="mark display a up"><div class="lens"></div>coldopen</div>
  <h2 class="display title a up" style="animation-delay:400ms">${esc(reel.end)}</h2>
  <p class="url a up" style="animation-delay:900ms">tiwaker9404.github.io/coldopen</p>
  <div class="stripe"></div>
</section>
<script>
const TITLE = ${TITLE_S}, ITEM = ${ITEM_S}, END = ${END};
const items = [...document.querySelectorAll('.item')];
for (const a of document.getAnimations()) a.pause();
window.__seek = (t) => {
  const show = (el, local) => {
    el.classList.add('on');
    for (const an of el.getAnimations({ subtree: true })) an.currentTime = local * 1000;
  };
  for (const el of document.querySelectorAll('.s')) el.classList.remove('on');
  if (t < TITLE) return show(document.getElementById('title'), t);
  const i = Math.floor((t - TITLE) / ITEM);
  if (i >= items.length) return show(document.getElementById('end'), t - TITLE - items.length * ITEM);
  const el = items[i], local = t - TITLE - i * ITEM;
  show(el, local);
  const frames = el.querySelectorAll('.f');
  const f = Math.min(frames.length - 1, Math.floor(local * ${FPS}));
  frames.forEach((img, k) => img.classList.toggle('on', k === f));
  // stills drift slowly, so a screen reads as a moment rather than a slide
  const still = el.querySelector('.still');
  if (still) still.style.transform = 'scale(' + (1 + 0.035 * (local / ITEM)) + ')';
};
window.__ready = (async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  window.__seek(0);
  return { duration: END, issues: [], fonts: [] };
})();
</script></body></html>`
const page_ = join(work, 'reel.html')
writeFileSync(page_, html)

// 3. render it like any film
const browser = await getBrowser()
const page = await browser.newPage()
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
await page.goto(pathToFileURL(page_).href, { waitUntil: 'load', timeout: 120_000 })
await page.evaluate('window.__ready')
const out = join(outDir, `coldopen-${name}-${format}.mp4`)
const r = await renderSegment(page, {
  f0: 0,
  f1: Math.round(END * FPS),
  file: out,
  onFrame: (d, n) => d % 90 === 0 && process.stderr.write(`\r  ${Math.round((d / n) * 100)}%`),
})
await seek(page, TITLE_S + ITEM_S * 1.5)
await page.screenshot({
  path: join(outDir, `coldopen-${name}-${format}.jpg`),
  type: 'jpeg',
  quality: 88,
})
await closeBrowser()
rmSync(work, { recursive: true, force: true })
console.log(`\n${name} reel (${format}): ${out}, ${END.toFixed(1)}s, ${r.frames} frames`)
