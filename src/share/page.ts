import type { FilmInput, FilmResult } from '../film.ts'
import type { Storyboard } from '../script/storyboard.ts'

/**
 * The page a prospect lands on from the GIF in an email: the film, one clear action, and
 * nothing else. Open Graph tags make the link unfurl with the poster in Slack and LinkedIn.
 *
 * The same page is served by the API server and by the Cloudflare share worker, so it is
 * built from a small view model rather than a whole film run, and it must not import
 * anything that needs Node.
 */
export interface ShareView {
  company: string
  format: 'square' | 'landscape' | 'portrait'
  /** "Ashwin Tiwari" or "Ashwin Tiwari, Acme" */
  from: string
  /** first name, for the reply button */
  firstName: string
  ctaLine: string
  contact: string
  /** the film's file name, e.g. film-square.mp4 */
  film: string
}

export const FORMAT_SIZE = {
  square: [1080, 1080],
  landscape: [1920, 1080],
  portrait: [1080, 1920],
} as const

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A film run from the API server. */
export function viewFromRun(input: FilmInput, out: FilmResult): ShareView {
  const p = input.profile
  return {
    company: out.company,
    format: out.format,
    from: p.sender.company ? `${p.sender.name} at ${p.sender.company}` : p.sender.name,
    firstName: p.sender.name.split(' ')[0]!,
    ctaLine: p.cta.line,
    contact: p.cta.contact,
    film: out.files.film.split('/').pop()!,
  }
}

/** A film folder made by the CLI: storyboard.json has everything the page shows. */
export function viewFromStoryboard(board: Storyboard, film: string): ShareView {
  const cta = board.scenes.find((s) => s.kind === 'cta')
  if (cta?.kind !== 'cta') throw new Error('storyboard has no closing scene')
  const format = (film.match(/film-(square|landscape|portrait)\.mp4$/)?.[1] ??
    'square') as ShareView['format']
  // board.sender is "Name, Company" or "Name"
  const [name, company] = board.sender.split(/,\s*(.+)/)
  return {
    company: board.company,
    format,
    from: company ? `${name} at ${company}` : name!,
    firstName: name!.split(' ')[0]!,
    ctaLine: cta.line,
    contact: cta.contact,
    film,
  }
}

function contactHref(contact: string) {
  if (contact.includes('@') && !contact.startsWith('http')) return `mailto:${contact}`
  return contact.startsWith('http') ? contact : `https://${contact}`
}

/**
 * Reports what the viewer actually did, not just that the page loaded: email security
 * scanners and link unfurlers fetch pages all day but don't press play. Adding ?preview to
 * the link turns reporting off, so the sender can watch their own film without counting.
 */
function trackingScript(endpoint: string) {
  return `<script>(()=>{const v=document.querySelector('video');if(!v||/[?&]preview\\b/.test(location.search))return;
const s=(crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2)+Date.now()).replace(/[^a-zA-Z0-9-]/g,'').slice(0,40);
let max=0,played=false,last=0;
const send=e=>{const b=JSON.stringify({s,e,t:Math.round(max*10)/10,d:Math.round(v.duration||0),...(e==='open'&&document.referrer?{r:document.referrer.slice(0,300)}:{})});
try{if(!navigator.sendBeacon||!navigator.sendBeacon(${JSON.stringify(endpoint)},new Blob([b],{type:'text/plain'})))fetch(${JSON.stringify(endpoint)},{method:'POST',body:b,keepalive:true,headers:{'content-type':'text/plain'}})}catch{}};
send('open');
v.addEventListener('play',()=>{if(!played){played=true;send('play')}});
v.addEventListener('timeupdate',()=>{max=Math.max(max,v.currentTime);if(played&&Date.now()-last>5000){last=Date.now();send('progress')}});
v.addEventListener('ended',()=>{max=v.duration||max;send('end')});
addEventListener('pagehide',()=>{if(played)send('progress')});})()</script>`
}

/**
 * @param url    the page's own public URL; files are served under it
 * @param track  where the page reports views (omit to serve a page without tracking)
 * @param app    where "Made with coldopen" points: the hosted app, or the project
 */
export function sharePage(
  v: ShareView,
  url: string,
  track?: string,
  app = 'https://github.com/tiwaker9404/coldopen',
): string {
  const made = new URL(app)
  made.searchParams.set('ref', 'share')
  const title = `A 30-second film for ${v.company}`
  const [w, h] = FORMAT_SIZE[v.format]
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(`${v.from} made this for ${v.company}.`)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(`From ${v.from}`)}">
<meta property="og:image" content="${url}/poster.jpg">
<meta property="og:video" content="${url}/${v.film}">
<meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="${w}"><meta property="og:video:height" content="${h}">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">
<style>
:root{color-scheme:light dark;--bg:#f4f5f7;--fg:#15171c;--muted:#5d6370;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121418;--fg:#eef0f3;--muted:#9aa1ad;--card:#1b1e24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px}
main{width:min(100%,${v.format === 'landscape' ? 960 : v.format === 'portrait' ? 420 : 640}px)}
video{width:100%;height:auto;display:block;border-radius:14px;background:#000;box-shadow:0 20px 50px rgba(0,0,0,.18)}
h1{font-size:20px;font-weight:650;margin:20px 0 2px}p{margin:0;color:var(--muted)}
.row{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-top:4px}
a.cta{display:inline-block;background:var(--fg);color:var(--bg);text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px}
a.cta:focus-visible{outline:3px solid #3f6fd8;outline-offset:3px}
footer{margin-top:40px;font-size:13px;color:var(--muted);text-align:center}
footer a{color:inherit}
</style></head><body><main>
<video src="${url}/${v.film}" poster="${url}/poster.jpg" controls playsinline preload="metadata" width="${w}" height="${h}"></video>
<div class="row"><div><h1>${esc(v.ctaLine)}</h1><p>From ${esc(v.from)}, made for ${esc(v.company)}</p></div>
<a class="cta" href="${esc(contactHref(v.contact))}">Reply to ${esc(v.firstName)}</a></div>
<footer><a href="${esc(made.toString())}">Made with coldopen</a>. Make one for a company you'd like to work with.</footer>
</main>${track ? trackingScript(track) : ''}</body></html>`
}
