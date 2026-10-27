import type { BrandKit } from '../brand/types.ts'
import type { Scene, Storyboard } from '../script/storyboard.ts'
import type { Field, FilmTheme } from './theme.ts'

/**
 * A film is a web page on a timeline. Every scene is HTML/CSS with paused CSS animations;
 * window.__seek(t) sets every animation to exactly time t, so any frame can be rendered
 * deterministically, in any order, by any worker. Layout is in "u" units (1% of the short
 * side), so the same composition renders square, landscape or portrait.
 */

export type Format = 'square' | 'landscape' | 'portrait'
export const FORMATS: Record<Format, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** split into word spans for staggered reveals; each word masked so it rises into view */
function wordsHtml(text: string, startMs: number, stepMs: number, cls = 'w', suffix = ''): string {
  const list = text.split(/\s+/).filter(Boolean)
  if (suffix && list.length) list[list.length - 1] += suffix
  return list
    .map(
      (w, i) =>
        `<span class="mask"><span class="${cls}" style="animation-delay:${startMs + i * stepMs}ms">${esc(w)}</span></span>`,
    )
    .join(' ')
}

function vars(f: Field): string {
  return `--bg:${f.bg};--fg:${f.fg};--accent:${f.accent};--muted:${f.muted};`
}

interface SceneCtx {
  kit: BrandKit
  theme: FilmTheme
  shot: string | null
  logo: string | null
}

function sceneHtml(s: Scene, i: number, start: number, c: SceneCtx): string {
  const open = (field: Field, extra = '') =>
    `<section class="scene ${s.kind}" data-i="${i}" data-start="${start}" data-dur="${s.dur}" style="${vars(field)}${extra}">`
  switch (s.kind) {
    case 'hook':
      return `${open(c.theme.dark)}
        ${c.logo ? `<div class="chip in" style="animation-delay:150ms"><img src="${c.logo}" alt=""></div>` : ''}
        <div class="hook-wrap">
          <h1 class="display hook-text" data-fit data-lines="3">${wordsHtml(s.text, 250, 110)}</h1>
          <div class="rule grow" style="animation-delay:900ms"></div>
          <p class="sub in" style="animation-delay:1250ms">${esc(s.sub)}</p>
        </div>
      </section>`
    case 'site':
      return `${open(c.theme.light)}
        <h2 class="display caption" data-fit data-lines="2">${wordsHtml(s.caption, 200, 70)}</h2>
        <div class="browser in-up" style="animation-delay:450ms">
          <div class="bar"><i></i><i></i><i></i><span class="url">${esc(s.host)}</span></div>
          <div class="viewport">
            <div class="zoom">
              ${c.shot ? `<img class="shot" src="${c.shot}" alt="">` : '<div class="shot missing"></div>'}
              <div class="mark"></div>
            </div>
          </div>
        </div>
      </section>`
    case 'insight':
      return `${open(c.theme.brand)}
        <div class="insight-wrap">
          <p class="from in" style="animation-delay:150ms">From ${esc(s.source)}</p>
          ${
            s.value
              ? `<div class="big display"><span class="count" data-count="${esc(s.value)}" data-delay="350" data-ms="1300">${esc(s.value)}</span></div>
                 <p class="display fact" data-fit data-lines="3">${wordsHtml(s.text, 900, 60)}</p>`
              : `<p class="display quote" data-fit data-lines="5"><span class="q in" style="animation-delay:200ms">“</span>${wordsHtml(s.text, 350, 45, 'w', '”')}</p>`
          }
          <p class="why in" style="animation-delay:2300ms" data-fit data-lines="3">${esc(s.why)}</p>
        </div>
      </section>`
    case 'pitch':
      return `${open(c.theme.light)}
        <div class="pitch-wrap">
          <p class="from in" style="animation-delay:100ms">From ${esc(s.from)}</p>
          <h2 class="display headline" data-fit data-lines="3">${wordsHtml(s.headline, 250, 80)}</h2>
          <ul class="points">
            ${s.points
              .map(
                (p, j) =>
                  `<li class="in-left" style="animation-delay:${1500 + j * 550}ms"><span class="tick"></span><span data-fit data-lines="2">${esc(p)}</span></li>`,
              )
              .join('')}
          </ul>
        </div>
      </section>`
    case 'proof':
      return `${open(c.theme.dark)}
        <div class="proof-wrap n${s.stats.length}">
          ${s.stats
            .map(
              (st, j) => `<div class="stat in-up" style="animation-delay:${200 + j * 380}ms">
                <div class="display value" data-fit data-lines="1"><span class="count" data-count="${esc(st.value)}" data-delay="${300 + j * 380}" data-ms="1100">${esc(st.value)}</span></div>
                <div class="label">${esc(st.label)}</div>
              </div>`,
            )
            .join('')}
        </div>
      </section>`
    case 'cta':
      return `${open(c.theme.brand)}
        ${c.logo ? `<div class="chip in" style="animation-delay:200ms"><img src="${c.logo}" alt=""></div>` : ''}
        <div class="cta-wrap">
          <h2 class="display cta-line" data-fit data-lines="3">${wordsHtml(s.line, 250, 110)}</h2>
          <p class="contact in" style="animation-delay:1200ms">${esc(s.contact)}</p>
        </div>
        <p class="signoff in" style="animation-delay:1700ms">${esc(s.signoff)}</p>
      </section>`
  }
}

export function compose(opts: {
  board: Storyboard
  kit: BrandKit
  theme: FilmTheme
  format: Format
  screenshotDataUrl: string | null
}): string {
  const { board, kit, theme, format } = opts
  const { width, height } = FORMATS[format]
  const ctx: SceneCtx = {
    kit,
    theme,
    shot: opts.screenshotDataUrl,
    logo: kit.logo?.dataUrl ?? null,
  }
  let t = 0
  const scenes = board.scenes.map((s, i) => {
    const html = sceneHtml(s, i, t, ctx)
    t += s.dur
    return html
  })
  const box = kit.screenshot.headlineBox
  const timeline = {
    duration: board.duration,
    shot: { w: kit.screenshot.width, h: kit.screenshot.height, box },
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>
${theme.fontCss}
:root{--u:${Math.min(width, height) / 100}px;--W:${width}px;--H:${height}px;--display:${theme.display.family};--body:${theme.body.family};--dw:${theme.display.weight}}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${width}px;height:${height}px;overflow:hidden;background:#000}
#stage{position:relative;width:${width}px;height:${height}px;overflow:hidden;font-family:var(--body);-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;font-kerning:normal}
.scene{position:absolute;inset:0;background:var(--bg);color:var(--fg);padding:calc(var(--u)*9) calc(var(--u)*7.5) calc(var(--u)*11);display:flex;flex-direction:column;visibility:hidden;animation:wipe 620ms cubic-bezier(.77,0,.18,1) both}
.scene.on{visibility:visible}
.scene[data-i="0"]{animation:none}
.display{font-family:var(--display);font-weight:var(--dw);letter-spacing:-0.025em;line-height:1.02;font-optical-sizing:auto}
.mask{display:inline-block;overflow:hidden;vertical-align:bottom;padding-bottom:0.08em;margin-bottom:-0.08em}
.w{display:inline-block;animation:rise 760ms cubic-bezier(.16,1,.3,1) both}
.in{animation:fade 600ms ease-out both}
.in-up{animation:up 820ms cubic-bezier(.16,1,.3,1) both}
.in-left{animation:left 700ms cubic-bezier(.16,1,.3,1) both}
.grow{animation:grow 900ms cubic-bezier(.65,0,.35,1) both;transform-origin:left center}
@keyframes wipe{from{clip-path:inset(100% 0 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes rise{from{transform:translateY(105%)}to{transform:translateY(0)}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes up{from{opacity:0;transform:translateY(calc(var(--u)*5))}to{opacity:1;transform:none}}
@keyframes left{from{opacity:0;transform:translateX(calc(var(--u)*-4))}to{opacity:1;transform:none}}
@keyframes grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}

/* persistent chrome: who it's from, who it's for, and the reel */
#chrome{position:absolute;inset:0;pointer-events:none;z-index:50;color:var(--fg)}
#chrome .meta{position:absolute;top:calc(var(--u)*4.2);left:calc(var(--u)*7.5);right:calc(var(--u)*7.5);display:flex;justify-content:space-between;font-size:calc(var(--u)*2.1);font-weight:500;opacity:.72;letter-spacing:.01em}
#reel{position:absolute;left:calc(var(--u)*7.5);right:calc(var(--u)*7.5);bottom:calc(var(--u)*5);display:flex;gap:calc(var(--u)*.8)}
#reel i{flex:1;height:calc(var(--u)*.45);border-radius:calc(var(--u)*.3);background:color-mix(in srgb,currentColor 22%,transparent);overflow:hidden;position:relative}
#reel b{position:absolute;inset:0;background:currentColor;transform-origin:left;transform:scaleX(0)}

.chip{position:absolute;top:calc(var(--u)*8.5);left:calc(var(--u)*7.5);background:${theme.light.bg};border-radius:calc(var(--u)*1.2);padding:calc(var(--u)*1.2) calc(var(--u)*1.6);display:flex;align-items:center;max-width:calc(var(--u)*34)}
.chip img{display:block;max-height:calc(var(--u)*4.2);max-width:calc(var(--u)*30)}

/* hook */
.hook-wrap{margin-top:auto;margin-bottom:auto;padding-top:calc(var(--u)*8)}
.hook-text{font-size:calc(var(--u)*11.5);max-width:92%}
.rule{height:calc(var(--u)*.9);width:calc(var(--u)*22);background:var(--accent);margin:calc(var(--u)*4.5) 0 calc(var(--u)*3);border-radius:calc(var(--u)*.5)}
.sub{font-size:calc(var(--u)*3);color:var(--muted)}

/* site */
.caption{font-size:calc(var(--u)*5.6);max-width:94%;margin-bottom:calc(var(--u)*4.5)}
.browser{flex:1;min-height:0;border-radius:calc(var(--u)*1.6);background:#fff;box-shadow:0 calc(var(--u)*2) calc(var(--u)*6) rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.08);overflow:hidden;display:flex;flex-direction:column}
.bar{height:calc(var(--u)*4.4);display:flex;align-items:center;gap:calc(var(--u)*.9);padding:0 calc(var(--u)*1.8);background:#eceef1;flex:none}
.bar i{width:calc(var(--u)*1.25);height:calc(var(--u)*1.25);border-radius:50%;background:#c9ccd2}
.url{margin-left:calc(var(--u)*1.5);background:#fff;border-radius:calc(var(--u)*.8);padding:calc(var(--u)*.55) calc(var(--u)*2);font-size:calc(var(--u)*1.9);color:#4a4f57;font-family:var(--body)}
.viewport{position:relative;flex:1;overflow:hidden;background:#fff}
.zoom{position:absolute;left:0;top:0;transform-origin:0 0;animation:zoom 4200ms cubic-bezier(.65,0,.35,1) 1100ms both}
@keyframes zoom{from{transform:translate(0,0) scale(var(--s0))}to{transform:translate(var(--tx),var(--ty)) scale(var(--s1))}}
.shot{display:block}
.shot.missing{background:#e9ebee}
.mark{position:absolute;border:calc(var(--u)*.55) solid var(--accent);border-radius:calc(var(--u)*1.2);background:color-mix(in srgb,var(--accent) 14%,transparent);animation:mark 700ms cubic-bezier(.16,1,.3,1) 2300ms both}
@keyframes mark{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}

/* insight */
.insight-wrap{margin-top:auto;margin-bottom:auto}
.from{font-size:calc(var(--u)*2.4);color:var(--muted);margin-bottom:calc(var(--u)*3);font-weight:500}
.big{font-size:calc(var(--u)*26);line-height:.88;letter-spacing:-0.045em;margin-left:-0.04em}
.fact{font-size:calc(var(--u)*6.2);max-width:92%;margin-top:calc(var(--u)*3)}
.quote{font-size:calc(var(--u)*6.4);max-width:94%;line-height:1.08}
.q{display:inline-block;color:var(--accent)}
.why{font-size:calc(var(--u)*3.3);max-width:74%;margin-top:calc(var(--u)*5);line-height:1.35;padding-left:calc(var(--u)*2.2);border-left:calc(var(--u)*.6) solid var(--accent)}

/* pitch */
.pitch-wrap{margin-top:auto;margin-bottom:auto}
.headline{font-size:calc(var(--u)*7.6);max-width:94%}
.points{list-style:none;margin-top:calc(var(--u)*5.5);display:flex;flex-direction:column;gap:calc(var(--u)*2.6)}
.points li{display:flex;align-items:baseline;gap:calc(var(--u)*2.2);font-size:calc(var(--u)*3.9);line-height:1.25;font-weight:500}
.tick{flex:none;width:calc(var(--u)*3);height:calc(var(--u)*.7);background:var(--accent);border-radius:calc(var(--u)*.4);transform:translateY(calc(var(--u)*-1))}

/* proof */
.proof-wrap{margin:auto 0;display:grid;gap:calc(var(--u)*5.5)}
.proof-wrap.n2,.proof-wrap.n3{grid-template-columns:repeat(var(--cols),1fr)}
.stat .value{font-size:calc(var(--u)*13);line-height:1;color:var(--accent);letter-spacing:-0.04em;white-space:nowrap}
.stat{min-width:0}
.stat .label{font-size:calc(var(--u)*2.9);margin-top:calc(var(--u)*1.6);line-height:1.3;max-width:24ch}

/* cta */
.cta-wrap{margin-top:auto;margin-bottom:auto;padding-top:calc(var(--u)*6)}
.cta-line{font-size:calc(var(--u)*10);max-width:92%}
.contact{font-size:calc(var(--u)*3.6);margin-top:calc(var(--u)*4);font-weight:600;border-bottom:calc(var(--u)*.4) solid var(--accent);display:inline-block;padding-bottom:calc(var(--u)*.5)}
.signoff{font-size:calc(var(--u)*2.3);color:var(--muted)}
</style></head><body>
<div id="stage">
${scenes.join('\n')}
<div id="chrome"><div class="meta"><span>${esc(board.sender)}</span><span>for ${esc(board.company)}</span></div>
<div id="reel">${board.scenes.map(() => '<i><b></b></i>').join('')}</div></div>
</div>
<script>
const TL = ${JSON.stringify(timeline)};
const scenes = [...document.querySelectorAll('.scene')].map((el) => ({ el, start: +el.dataset.start, dur: +el.dataset.dur }));
const chrome = document.getElementById('chrome');
const reel = [...document.querySelectorAll('#reel b')];
const issues = [];

// pause every animation; time is driven only by __seek
for (const a of document.getAnimations()) a.pause();

function layoutShot() {
  const vp = document.querySelector('.site .viewport');
  const img = document.querySelector('.site .shot');
  const zoom = document.querySelector('.site .zoom');
  const mark = document.querySelector('.site .mark');
  if (!vp || !zoom) return;
  const W = vp.clientWidth, H = vp.clientHeight;
  const s0 = W / TL.shot.w;
  if (img) { img.style.width = TL.shot.w + 'px'; img.style.height = TL.shot.h + 'px'; }
  zoom.style.width = TL.shot.w + 'px'; zoom.style.height = TL.shot.h + 'px';
  const b = TL.shot.box;
  if (!b) { zoom.style.setProperty('--s0', s0); zoom.style.setProperty('--s1', s0 * 1.08); zoom.style.setProperty('--tx', '0px'); zoom.style.setProperty('--ty', '0px'); mark.style.display = 'none'; return; }
  const pad = 18;
  mark.style.left = (b.x - pad) + 'px'; mark.style.top = (b.y - pad) + 'px';
  mark.style.width = (b.w + pad * 2) + 'px'; mark.style.height = (b.h + pad * 2) + 'px';
  mark.style.borderWidth = (6 / s0) + 'px'; mark.style.borderRadius = (14 / s0) + 'px';
  // zoom so the headline fills ~78% of the frame width, centered, never showing past the image edge
  const s1 = Math.max(s0 * 1.15, Math.min(s0 * 2.2, (W * 0.78) / (b.w + pad * 2)));
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  let tx = W / 2 - cx * s1, ty = H / 2 - cy * s1;
  tx = Math.min(0, Math.max(W - TL.shot.w * s1, tx));
  ty = Math.min(0, Math.max(H - TL.shot.h * s1, ty));
  zoom.style.setProperty('--s0', s0); zoom.style.setProperty('--s1', s1);
  zoom.style.setProperty('--tx', tx + 'px'); zoom.style.setProperty('--ty', ty + 'px');
}

// shrink text until it fits its box and line budget; report anything that still can't
function fit() {
  for (const el of document.querySelectorAll('[data-fit]')) {
    const maxLines = +(el.dataset.lines || 3);
    let size = parseFloat(getComputedStyle(el).fontSize);
    const min = size * 0.55;
    const over = () => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || size * 1.1;
      const lines = Math.round(el.scrollHeight / lh);
      return lines > maxLines || el.scrollWidth > el.clientWidth + 1;
    };
    let guard = 0;
    while (over() && size > min && guard++ < 40) { size *= 0.95; el.style.fontSize = size + 'px'; }
    if (over()) issues.push({ kind: 'overflow', text: el.textContent.trim().slice(0, 60) });
  }
  for (const s of document.querySelectorAll('.scene')) {
    if (s.scrollHeight > s.clientHeight + 2) issues.push({ kind: 'scene-overflow', scene: s.className });
  }
}

const pw = document.querySelector('.proof-wrap');
if (pw) {
  const n = pw.children.length;
  const wide = ${width >= height};
  pw.style.setProperty('--cols', wide ? n : (n === 3 ? 1 : n));
  if (!wide && n === 3) pw.style.gridTemplateColumns = '1fr';
}

function fmtCount(target, p) {
  const m = target.match(/^([^\\d]*)(\\d[\\d,.]*)(.*)$/);
  if (!m) return target;
  const raw = m[2].replace(/,/g, '');
  const num = parseFloat(raw);
  // counting from 0 to 1 reads as a glitch; only big numbers count up
  if (!isFinite(num) || num < 10) return target;
  const decimals = (raw.split('.')[1] || '').length;
  const v = num * p;
  let s = v.toFixed(decimals);
  if (m[2].includes(',')) s = Number(s).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return m[1] + s + m[3];
}
const ease = (x) => 1 - Math.pow(1 - x, 4);

window.__seek = (t) => {
  let current = 0;
  scenes.forEach((s, i) => {
    const local = t - s.start;
    const on = local >= 0 && local < s.dur + 0.7;
    s.el.classList.toggle('on', on);
    s.el.style.zIndex = i + 1;
    if (local >= 0 && local < s.dur) current = i;
    if (!on) return;
    for (const a of s.el.getAnimations({ subtree: true })) a.currentTime = local * 1000;
    for (const c of s.el.querySelectorAll('.count')) {
      const p = Math.max(0, Math.min(1, (local * 1000 - +c.dataset.delay) / +c.dataset.ms));
      c.textContent = fmtCount(c.dataset.count, ease(p));
    }
  });
  const cs = scenes[current];
  chrome.style.color = getComputedStyle(cs.el).getPropertyValue('--fg');
  reel.forEach((b, j) => {
    const p = j < current ? 1 : j > current ? 0 : Math.min(1, (t - cs.start) / cs.dur);
    b.style.transform = 'scaleX(' + p + ')';
  });
};

window.__ready = (async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  for (const s of scenes) s.el.style.visibility = 'visible';
  layoutShot();
  fit();
  for (const s of scenes) s.el.style.visibility = '';
  window.__seek(0);
  return { duration: TL.duration, issues, fonts: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family) };
})();
</script></body></html>`
}
