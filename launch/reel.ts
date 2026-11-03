/**
 * The launch reel, rendered by coldopen's own engine: an HTML timeline with paused
 * animations, seeked frame by frame and encoded with ffmpeg, the same way every film is.
 *
 *   node launch/reel.ts <films-dir> <out.mp4> [clips.json]
 *
 * clips.json lists which moment of which film to show (default: launch/clips.json):
 *   [{ "dir": "linear.app-55a3ef", "from": 24.9, "caption": "One clear ask.",
 *      "role": "Solutions Engineer", "take": 2 }, ...]
 * Each dir is a film folder made by the CLI. The company name comes from its kit.json and the
 * running time from its storyboard.json; role and take are optional and fill the slate.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { closeBrowser, getBrowser } from '../src/browser.ts'
import { renderSegment, seek } from '../src/render/render.ts'

const [
  filmsDir = '.scratch/reel/films',
  out = '.scratch/reel/coldopen-launch.mp4',
  clipsFile = join(import.meta.dirname, 'clips.json'),
] = process.argv.slice(2)
const W = 1080
const H = 1350
const work = resolve(dirname(out), 'reel-build')
rmSync(work, { recursive: true, force: true })
mkdirSync(join(work, 'frames'), { recursive: true })

type ClipSpec = { dir: string; from: number; caption: string; role?: string; take?: number }
const specs: ClipSpec[] = existsSync(clipsFile)
  ? JSON.parse(readFileSync(clipsFile, 'utf8'))
  : [
      {
        dir: 'northwind',
        from: 3.7,
        caption: 'Their homepage, with the promise they lead with highlighted.',
      },
      {
        dir: 'lumen',
        from: 8.7,
        caption: 'A number from their site, set in their font and colors.',
      },
      { dir: 'parcelpine', from: 24.9, caption: 'One clear ask, signed by the sender.' },
    ]
const runs = (dir: string) => {
  try {
    const s = JSON.parse(readFileSync(join(filmsDir, dir, 'storyboard.json'), 'utf8'))
    const d = Math.round(Number(s.meta?.duration) || 30)
    return `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`
  } catch {
    return '0:30'
  }
}
const CLIPS = specs.map((c, i) => ({
  ...c,
  id: `clip${i}`,
  company: JSON.parse(readFileSync(join(filmsDir, c.dir, 'kit.json'), 'utf8')).name as string,
  role: c.role ?? 'Pitch film',
  take: c.take ?? 1,
  runs: runs(c.dir),
}))
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)
const CLIP_DUR = 3.8
const FPS = 30

// 1. pull the clip frames out of the real films
for (const c of CLIPS) {
  const film = readdirSync(join(filmsDir, c.dir)).find((f) => /^film-.*\.mp4$/.test(f))!
  mkdirSync(join(work, 'frames', c.id), { recursive: true })
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-ss',
    String(c.from),
    '-t',
    String(CLIP_DUR),
    '-i',
    join(filmsDir, c.dir, film),
    '-vf',
    `fps=${FPS},scale=860:-1`,
    '-q:v',
    '3',
    join(work, 'frames', c.id, '%04d.jpg'),
  ])
  execFileSync('ffmpeg', [
    '-loglevel',
    'error',
    '-y',
    '-ss',
    '2.6',
    '-i',
    join(filmsDir, c.dir, film),
    '-frames:v',
    '1',
    '-vf',
    'scale=320:-1',
    '-q:v',
    '3',
    join(work, `${c.id}-poster.jpg`),
  ])
}
const frameCount = (id: string) => readdirSync(join(work, 'frames', id)).length

// 2. fonts: the dashboard's own type, embedded
const require = createRequire(import.meta.url)
const font = (pkg: string, file: string) =>
  `data:font/woff2;base64,${readFileSync(join(dirname(require.resolve(`@fontsource-variable/${pkg}/package.json`)), 'files', file)).toString('base64')}`

// 3. the timeline
const T = {
  title: 0,
  composer: 3.6,
  clips: 9.0,
  grid: 9.0 + CLIP_DUR * CLIPS.length,
  crash: 9.0 + CLIP_DUR * CLIPS.length + 5.0,
  outro: 9.0 + CLIP_DUR * CLIPS.length + 9.4,
}
const END = T.outro + 5.2
const scenes = [
  ['title', T.title, T.composer],
  ['composer', T.composer, T.clips],
  ['clips', T.clips, T.grid],
  ['grid', T.grid, T.crash],
  ['crash', T.crash, T.outro],
  ['outro', T.outro, END],
] as const

const clipHtml = CLIPS.map((c, i) => {
  const n = frameCount(c.id)
  const imgs = Array.from(
    { length: n },
    (_, k) => `<img class="f" src="frames/${c.id}/${String(k + 1).padStart(4, '0')}.jpg" alt="">`,
  ).join('')
  return `<div class="clip" data-clip="${i}" data-n="${n}"><p class="for">for ${esc(c.company)}</p><figure class="take"><div class="clap"><i></i></div><div class="player">${imgs}</div><div class="fields"><div><span>Company</span><b>${esc(c.company)}</b></div><div><span>Role</span><b>${esc(c.role)}</b></div><div><span>Take</span><b>${c.take}</b></div><div><span>Runs</span><b>${c.runs}</b></div></div></figure><p class="cap">${esc(c.caption)}</p></div>`
}).join('')

// the brand (docs/BRAND.md): Stock yellow for the title and the credits, the screening room
// (the app's dark mode) for everything in between, and the slate wherever a film appears
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Big Shoulders';src:url(${font('big-shoulders-display', 'big-shoulders-display-latin-wght-normal.woff2')});font-weight:100 900}
@font-face{font-family:'Instrument Sans';src:url(${font('instrument-sans', 'instrument-sans-latin-wght-normal.woff2')});font-weight:400 700}
:root{--stock:#ffc21a;--slate:#000;--stock-muted:#3d3420;--room:#17181b;--surface:#1f2024;--soft:#25262a;--ink:#f2f2ee;--muted:#b3b5b9;--rule:#2e3035;--tally:#e5291f;--u:10.8px}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:var(--room)}
body{font-family:'Instrument Sans';color:var(--ink);-webkit-font-smoothing:antialiased}
.s{position:absolute;inset:0;padding:calc(var(--u)*9) calc(var(--u)*8);display:none;flex-direction:column;background:var(--room)}
.s.on{display:flex}
.s.stock{background:var(--stock);color:var(--slate)}
#title,#composer,#outro{justify-content:center;padding-bottom:calc(var(--u)*14)}
.display{font-family:'Big Shoulders';font-weight:800;line-height:.9;letter-spacing:-0.005em}
.a{animation-play-state:paused;animation-fill-mode:both}
.up{animation:up 800ms cubic-bezier(.16,1,.3,1) both}
.fade{animation:fade 600ms ease-out both}
@keyframes up{from{opacity:0;transform:translateY(calc(var(--u)*4))}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
/* the mark: the tally light that means "recording", then the word */
.mark{display:flex;align-items:center;gap:calc(var(--u)*2.6)}
.lens{width:calc(var(--u)*4.4);height:calc(var(--u)*4.4);border-radius:50%;background:var(--tally);flex:none}
.word{font-size:calc(var(--u)*19)}
.lines{margin-top:calc(var(--u)*7);font-size:calc(var(--u)*11.5)}
.lines p+p{margin-top:calc(var(--u)*.6);color:var(--stock-muted)}
.stripe{height:calc(var(--u)*2.6);background:repeating-linear-gradient(-55deg,#fff 0 calc(var(--u)*2.4),#000 calc(var(--u)*2.4) calc(var(--u)*4.8));position:absolute;left:0;right:0;bottom:0}
/* composer */
.kicker{font-size:calc(var(--u)*11)}
.card{background:var(--surface);border:1px solid var(--rule);border-radius:calc(var(--u)*2);padding:calc(var(--u)*2.6);margin-top:calc(var(--u)*7)}
.row{display:flex;gap:calc(var(--u)*1.6)}
.input{flex:1;white-space:nowrap;overflow:hidden;border:1px solid var(--rule);background:var(--soft);border-radius:calc(var(--u)*1.4);padding:calc(var(--u)*2.4) calc(var(--u)*2.8);font-size:calc(var(--u)*4.2);min-height:calc(var(--u)*10)}
.caret{display:inline-block;width:3px;height:1.1em;background:var(--stock);vertical-align:-.15em;margin-left:2px}
.btn{background:var(--stock);color:var(--slate);border-radius:calc(var(--u)*1.4);padding:0 calc(var(--u)*3.6);font-size:calc(var(--u)*3.6);font-weight:650;display:flex;align-items:center;white-space:nowrap}
.btn.pressed{transform:scale(.96);background:#e6ad0f}
.status{margin-top:calc(var(--u)*5);display:flex;gap:calc(var(--u)*2.4);align-items:center;font-size:calc(var(--u)*4);font-weight:600;opacity:0}
.status .dot{width:calc(var(--u)*2.2);height:calc(var(--u)*2.2);border-radius:50%;background:var(--tally)}
.track{height:calc(var(--u)*.9);background:var(--rule);border-radius:4px;margin-top:calc(var(--u)*2);overflow:hidden}
.track b{display:block;height:100%;background:var(--stock);width:0}
/* clips: every film shown as a take, clapper on top and the slate under it */
.clip{position:absolute;inset:0;padding:calc(var(--u)*6) calc(var(--u)*8);display:none;flex-direction:column;align-items:center}
.clip.on{display:flex}
.for{align-self:flex-start;font-family:'Big Shoulders';font-weight:800;font-size:calc(var(--u)*7.4);line-height:1;margin-bottom:calc(var(--u)*2.6)}
.take{width:860px;border-radius:calc(var(--u)*1.6);overflow:hidden;background:#000}
.clap{height:calc(var(--u)*3.4);position:relative;background:#000}
.clap i{position:absolute;inset:0;background:repeating-linear-gradient(-55deg,#fff 0 calc(var(--u)*2.2),#000 calc(var(--u)*2.2) calc(var(--u)*4.4));transform-origin:0 100%}
.player{position:relative;width:860px;height:860px;overflow:hidden}
.player .f{position:absolute;inset:0;width:100%;height:100%;display:none}
.player .f.on{display:block}
.fields{display:grid;grid-template-columns:1.2fr 1.6fr auto auto;border-top:1px solid #333;color:#fff}
.fields div{padding:calc(var(--u)*1.2) calc(var(--u)*1.8) calc(var(--u)*1.5);border-right:1px solid #333;min-width:0}
.fields div:last-child{border-right:0}
.fields span{display:block;font-size:calc(var(--u)*1.9);color:#a8aaae}
.fields b{display:block;font-family:'Big Shoulders';font-weight:700;font-size:calc(var(--u)*3.6);line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.cap{align-self:flex-start;margin-top:calc(var(--u)*3);font-size:calc(var(--u)*3.6);line-height:1.3;max-width:36ch;color:var(--muted)}
/* grid: the films on a filmstrip, one frame per film, perforations along both edges */
.big{font-size:calc(var(--u)*9.4)}
.strip{margin:calc(var(--u)*6) calc(var(--u)*-8) 0;background:#000;padding:calc(var(--u)*4.4) calc(var(--u)*8)}
.strip::before,.strip::after{content:'';display:block;height:calc(var(--u)*1.6);background:repeating-linear-gradient(90deg,transparent 0 calc(var(--u)*1.4),#3a3b40 calc(var(--u)*1.4) calc(var(--u)*3.6),transparent calc(var(--u)*3.6) calc(var(--u)*5));border-radius:2px}
.posters{display:flex;gap:calc(var(--u)*2);margin:calc(var(--u)*2.4) 0}
.posters img{flex:1;min-width:0;aspect-ratio:1;border-radius:calc(var(--u)*.6);display:block;object-fit:cover}
.small{font-size:calc(var(--u)*3.8);line-height:1.38;color:var(--muted);margin-top:calc(var(--u)*5);max-width:38ch}
.stock .small{color:var(--stock-muted)}
/* crash */
.reel{display:flex;gap:calc(var(--u)*1.2);margin-top:calc(var(--u)*8)}
.reel i{flex:1;height:calc(var(--u)*2.6);border-radius:calc(var(--u)*.6);background:var(--rule);position:relative;overflow:hidden}
.reel b{position:absolute;inset:0;background:var(--stock);transform-origin:left;transform:scaleX(0)}
.cut{margin-top:calc(var(--u)*3);display:flex;justify-content:space-between;font-size:calc(var(--u)*3.4);font-weight:600}
.cut .x{color:#ff4d40}
.pid{color:var(--muted);font-weight:500;font-variant-numeric:tabular-nums}
/* outro: the credits */
.credits{margin-top:calc(var(--u)*6);display:grid;grid-template-columns:auto 1fr;gap:calc(var(--u)*1) calc(var(--u)*4);font-size:calc(var(--u)*3.6)}
.credits span{color:var(--stock-muted)}
.credits b{font-weight:650}
.repo{font-size:calc(var(--u)*4.4);font-weight:650;margin-top:calc(var(--u)*5);border-bottom:calc(var(--u)*.5) solid var(--slate);align-self:flex-start;padding-bottom:calc(var(--u)*.6)}
</style></head><body>
<section class="s stock" id="title">
  <div class="mark a up" style="animation-delay:100ms"><div class="lens"></div><h1 class="display word">coldopen</h1></div>
  <div class="lines display"><p class="a up" style="animation-delay:900ms">A 30-second film</p><p class="a up" style="animation-delay:1500ms">for every company you apply to.</p></div>
  <div class="stripe"></div>
</section>
<section class="s" id="composer">
  <p class="display kicker a up" style="animation-delay:100ms">One job link in.</p>
  <div class="card a up" style="animation-delay:300ms"><div class="row"><div class="input"><span id="typed"></span><span class="caret"></span></div><div class="btn" id="btn">Make film</div></div></div>
  <div class="status" id="status"><span class="dot"></span><div style="flex:1"><span id="stage">Reading the site</span><div class="track"><b id="bar"></b></div></div></div>
</section>
<section class="s" id="clips" style="padding:0">${clipHtml}</section>
<section class="s" id="grid" style="justify-content:center">
  <h2 class="display big a up" style="animation-delay:100ms">Every film looks like the company it’s for.</h2>
  <div class="strip a fade" style="animation-delay:350ms"><div class="posters">${CLIPS.map((c, i) => `<img class="a up" style="animation-delay:${500 + i * 180}ms" src="${c.id}-poster.jpg" alt="">`).join('')}</div></div>
  <p class="small a fade" style="animation-delay:1400ms">Colors, logo and typeface come from their own site. Every fact on screen is quoted from it, and every number is checked in code.</p>
</section>
<section class="s" id="crash" style="justify-content:center">
  <h2 class="display big a up" style="animation-delay:100ms">Kill the renderer halfway through.</h2>
  <div class="reel">${Array.from({ length: 6 }, () => '<i><b></b></i>').join('')}</div>
  <div class="cut"><span class="x" id="died" style="opacity:0">Worker killed at scene 3</span><span class="pid" id="pid">pid 4182</span></div>
  <p class="small a fade" style="animation-delay:2600ms" id="resumed">A new worker picks the film up. Finished scenes are kept, so only what’s left gets rendered.</p>
</section>
<section class="s stock" id="outro">
  <div class="mark a up" style="animation-delay:100ms"><div class="lens"></div><h1 class="display word">coldopen</h1></div>
  <div class="lines display"><p class="a up" style="animation-delay:600ms">A 60% reply rate</p><p class="a up" style="animation-delay:1100ms">in my first week.</p></div>
  <div class="credits a fade" style="animation-delay:1700ms"><span>Directed by</span><b>you</b><span>Written from</span><b>your résumé</b><span>Ran on</span><b>free, open-source tools</b></div>
  <p class="repo a fade" style="animation-delay:2200ms">github.com/tiwaker9404/coldopen</p>
  <div class="stripe"></div>
</section>
<script>
const SC = ${JSON.stringify(scenes)};
const URLTEXT = ${JSON.stringify(process.env.REEL_URL ?? 'jobs.lever.co/acme/4821')};
const STAGES = [['Reading the site', 2.0], ['Writing the script', 2.6], ['Matching their brand', 3.2], ['Rendering scene 1 of 6', 3.8], ['Rendering scene 4 of 6', 4.6]];
const clips = [...document.querySelectorAll('.clip')];
const CLIP = ${CLIP_DUR};
for (const a of document.getAnimations()) a.pause();
window.__seek = (t) => {
  for (const [id, a, b] of SC) {
    const el = document.getElementById(id);
    const on = t >= a && t < b;
    el.classList.toggle('on', on);
    if (!on) continue;
    const local = t - a;
    for (const an of el.getAnimations({ subtree: true })) an.currentTime = local * 1000;
    if (id === 'composer') {
      const typed = Math.max(0, Math.min(URLTEXT.length, Math.floor((local - 0.6) / 0.055)));
      document.getElementById('typed').textContent = URLTEXT.slice(0, typed);
      document.getElementById('btn').classList.toggle('pressed', local > 1.85 && local < 2.0);
      const st = document.getElementById('status');
      st.style.opacity = local > 2.0 ? '1' : '0';
      let label = STAGES[0][0];
      for (const [l, at] of STAGES) if (local >= at) label = l;
      document.getElementById('stage').textContent = label;
      document.getElementById('bar').style.width = Math.max(0, Math.min(100, ((local - 2.0) / 3.2) * 100)) + '%';
    }
    if (id === 'clips') {
      const i = Math.min(clips.length - 1, Math.floor(local / CLIP));
      clips.forEach((c, j) => c.classList.toggle('on', j === i));
      const c = clips[i];
      const f = Math.min(+c.dataset.n - 1, Math.floor((local - i * CLIP) * ${FPS}));
      c.querySelectorAll('.f').forEach((img, k) => img.classList.toggle('on', k === f));
      // the one orchestrated moment: the clapper closes once, as the first take starts
      const stick = clips[0].querySelector('.clap i');
      const k = Math.max(0, Math.min(1, local / 0.28));
      stick.style.transform = 'rotate(' + (-12 * (1 - k * k)) + 'deg)';
    }
    if (id === 'crash') {
      const segs = [...document.querySelectorAll('#crash .reel b')];
      const p = (x) => Math.max(0, Math.min(1, x));
      // scenes 1-2 render, 3 dies halfway, then a new worker renders 3-6
      const fill = [p((local - 0.5) / 0.5), p((local - 1.0) / 0.5), local < 2.2 ? p((local - 1.5) / 0.5) * 0.5 : p((local - 2.6) / 0.4), p((local - 3.0) / 0.35), p((local - 3.35) / 0.35), p((local - 3.7) / 0.35)];
      segs.forEach((b, j) => { b.style.transform = 'scaleX(' + fill[j] + ')'; b.style.background = (j === 2 && local >= 1.9 && local < 2.6) ? 'var(--tally)' : 'var(--stock)'; });
      document.getElementById('died').style.opacity = local >= 1.9 ? '1' : '0';
      document.getElementById('pid').textContent = local >= 2.6 ? 'pid 4211 (new worker)' : 'pid 4182';
    }
  }
};
window.__ready = (async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  window.__seek(0);
  return { duration: ${END}, issues: [], fonts: [] };
})();
</script></body></html>`

const file = join(work, 'reel.html')
writeFileSync(file, html)

// 4. render it like any film
const browser = await getBrowser()
const page = await browser.newPage()
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: 120_000 })
await page.evaluate('window.__ready')
const total = Math.round(END * FPS)
const r = await renderSegment(page, {
  f0: 0,
  f1: total,
  file: resolve(out),
  onFrame: (d, n) => d % 60 === 0 && process.stderr.write(`\r  ${Math.round((d / n) * 100)}%`),
})
for (const [name, t] of [
  ['poster', 1.9],
  ['grid', T.grid + 2.2],
  ['crash', T.crash + 3.6],
] as const) {
  await seek(page, t)
  await page.screenshot({
    path: resolve(dirname(out), `reel-${name}.jpg`),
    type: 'jpeg',
    quality: 90,
  })
}
await closeBrowser()
console.log(
  `\nlaunch reel: ${out} (${END.toFixed(1)}s, ${r.frames} frames in ${(r.ms / 1000).toFixed(0)}s)`,
)
