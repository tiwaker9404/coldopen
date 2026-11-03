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
  /** a booking link (Calendly, Cal.com...): the page's main button when there is one */
  book?: string
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
    ...(p.cta.book ? { book: p.cta.book } : {}),
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
addEventListener('pagehide',()=>{if(played)send('progress')});
document.querySelectorAll('a[data-track]').forEach(a=>a.addEventListener('click',()=>send('click')));})()</script>`
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
  // the hosted app has a privacy page; the project's GitHub page doesn't
  const privacy = made.hostname === 'github.com' ? null : new URL('/privacy', made).toString()
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
:root{color-scheme:light dark;--bg:#F6F6F3;--fg:#141414;--muted:#5E6168;--rule:#D9DAD6;--stock:#FFC21A;--tally:#E5291F}
@media (prefers-color-scheme:dark){:root{--bg:#17181B;--fg:#F2F2EE;--muted:#A8AAAE;--rule:#2E3035}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px 16px}
main{width:min(100%,${v.format === 'landscape' ? 960 : v.format === 'portrait' ? 420 : 640}px)}
.slate{background:#000;border-radius:14px;overflow:hidden;box-shadow:0 24px 56px -28px rgb(0 0 0/.5)}
.clap{height:18px;background:repeating-linear-gradient(-55deg,#fff 0 16px,#000 16px 32px)}
video{width:100%;height:auto;display:block;background:#000}
.fields{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.5fr) auto;color:#fff;border-top:1px solid #333}
.fields div{padding:9px 14px 11px;border-right:1px solid #333;min-width:0}
.fields div:last-child{border-right:0}
.fields span{display:block;font-size:12px;color:#A8AAAE}
.fields b{display:block;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
h1{font-size:22px;line-height:1.25;font-weight:700;margin:22px 0 4px;letter-spacing:-.01em}
p{margin:0;color:var(--muted)}
.row{display:flex;justify-content:space-between;align-items:center;gap:16px 24px;flex-wrap:wrap}
.do{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
a.cta{display:inline-block;background:var(--stock);color:#000;text-decoration:none;font-weight:650;padding:13px 22px;border-radius:999px}
a.cta.alt{background:none;color:var(--fg);box-shadow:inset 0 0 0 1.5px var(--fg)}
a.cta:focus-visible{outline:3px solid #1F5BD8;outline-offset:3px}
footer{margin-top:44px;padding-top:16px;border-top:1px solid var(--rule);font-size:13px;color:var(--muted)}
footer a{color:inherit}
.made{display:inline-flex;align-items:center;gap:7px;color:var(--fg);font-weight:650}
.made::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--tally)}
</style></head><body><main>
<figure class="slate" style="margin:0">
<div class="clap" aria-hidden="true"></div>
<video src="${url}/${v.film}" poster="${url}/poster.jpg" controls playsinline preload="metadata" width="${w}" height="${h}"></video>
<figcaption class="fields"><div><span>Made for</span><b>${esc(v.company)}</b></div><div><span>From</span><b>${esc(v.from)}</b></div><div><span>Runs</span><b>0:30</b></div></figcaption>
</figure>
<div class="row"><div><h1>${esc(v.ctaLine)}</h1><p>${esc(v.firstName)} made this film for ${esc(v.company)}.</p></div>
<div class="do">${v.book ? `<a class="cta" data-track href="${esc(v.book)}" target="_blank" rel="noopener">Book 15 minutes</a><a class="cta alt" data-track href="${esc(contactHref(v.contact))}">Reply</a>` : `<a class="cta" data-track href="${esc(contactHref(v.contact))}">Reply to ${esc(v.firstName)}</a>`}</div></div>
<footer><a class="made" href="${esc(made.toString())}">Made with coldopen</a>. Make one for a company you'd like to work with.${privacy ? `<br>Views are counted without storing your IP address. <a href="${esc(privacy)}">Privacy</a>` : ''}</footer>
</main>${track ? trackingScript(track) : ''}</body></html>`
}
