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
  /** recruiter films: the candidate it was made for */
  recipient?: string
  /** the sender's project closest to this company, shown under the film */
  related?: { name: string; url: string; line: string }
  /** who sent it: a job seeker (seen by a recruiter), a recruiter (seen by a candidate), a seller */
  kind?: 'candidate' | 'recruiter' | 'sales' | 'hiring'
  /**
   * the line the film quotes and where it's from, the same caption as under it in the film
   * ("From their changelog, Oct 2026"), linked to the page when there's an https link
   */
  fact?: { text: string; caption: string; url?: string }
  /**
   * a job seeker built the tool that made this film: "Made with <name>, which I built", the same
   * line as under the ask in the film, linked to it (https only)
   */
  creator?: { name: string; url: string }
  /** the sender's full name, for link previews ("…, from Ashwin Tiwari"); never their company */
  name?: string
  /**
   * what the link preview says under the title: the film's tease about their work, else what
   * the film noticed on their homepage
   */
  tease?: string
  /**
   * a job seeker's card under the film: one line (their offer), and, when they gave them, their
   * LinkedIn and a photo. Nothing else from the profile is uploaded.
   */
  card?: { line: string; linkedin?: string; photo?: string }
}

export const FORMAT_SIZE = {
  square: [1080, 1080],
  landscape: [1920, 1080],
  portrait: [1080, 1920],
} as const

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const HTTPS = /^https:\/\/\S{4,300}$/
const LINKEDIN = /^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]{2,100}\/?$/

/** One line, trimmed to fit: link previews cut long descriptions anyway. */
const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
}

/**
 * The film's tease about their work, as the job seeker's email has it ("I put what I'd try next
 * with Parcelpine into a 30-second film:"), read from the stored email: it's the line right before
 * the film. Else what the film noticed on their homepage. Else nothing.
 */
export function teaseOf(
  out: Pick<FilmResult, 'messages' | 'script'>,
  kind: ShareView['kind'],
): string | undefined {
  if (kind === 'candidate') {
    const lines = (out.messages?.drafts.email.body ?? '').split('\n').map((l) => l.trim())
    const at = lines.indexOf('[film]')
    const line = at > 0 ? lines[at - 1]! : ''
    if (line && !line.includes('[film]')) return oneLine(line.replace(/[:\s]+$/, '.'), 200)
  }
  const noticed = out.script?.noticed?.trim()
  return noticed ? oneLine(noticed, 200) : undefined
}

/** a job seeker's card: their one line, and their LinkedIn and photo only when they're safe links */
export function cardOf(c: unknown): ShareView['card'] | null {
  if (!c || typeof c !== 'object') return null
  const o = c as Record<string, unknown>
  if (typeof o.line !== 'string' || o.line.trim().length < 3 || o.line.length > 160) return null
  return {
    line: o.line.trim(),
    ...(typeof o.linkedin === 'string' && LINKEDIN.test(o.linkedin)
      ? { linkedin: o.linkedin }
      : {}),
    ...(typeof o.photo === 'string' && HTTPS.test(o.photo) ? { photo: o.photo } : {}),
  }
}

/** A film run from the API server. */
export function viewFromRun(input: FilmInput, out: FilmResult): ShareView {
  const p = input.profile
  const job = p.preset === 'candidate'
  const tease = teaseOf(out, p.preset)
  const card = job
    ? cardOf({ line: p.offer, linkedin: p.sender.linkedin, photo: p.sender.photo })
    : null
  return {
    company: out.company,
    format: out.format,
    from: p.sender.company ? `${p.sender.name} at ${p.sender.company}` : p.sender.name,
    firstName: p.sender.name.split(' ')[0]!,
    name: p.sender.name,
    // a job seeker's film ends on its own warm ask; the profile's is the fallback
    ctaLine: (job && out.script?.cta?.trim()) || p.cta.line,
    contact: p.cta.contact,
    ...(p.cta.book ? { book: p.cta.book } : {}),
    film: out.files.film.split('/').pop()!,
    kind: p.preset,
    ...(p.preset === 'recruiter' && p.recipient ? { recipient: p.recipient.name } : {}),
    ...(out.related ? { related: out.related } : {}),
    ...(factOf(out.highlights?.quote) ? { fact: factOf(out.highlights?.quote)! } : {}),
    ...(p.preset === 'candidate' && creatorOf(p.creator) ? { creator: creatorOf(p.creator)! } : {}),
    ...(tease ? { tease } : {}),
    ...(card ? { card } : {}),
  }
}

/** what the sender built that made the film: a name and an https link, or nothing */
export function creatorOf(c: unknown): ShareView['creator'] | null {
  if (!c || typeof c !== 'object') return null
  const o = c as Record<string, unknown>
  if (typeof o.name !== 'string' || o.name.trim().length < 2 || o.name.length > 40) return null
  if (typeof o.url !== 'string' || !/^https:\/\/\S{4,300}$/.test(o.url)) return null
  return { name: o.name.trim(), url: o.url }
}

/** the quote and its caption for the page; a link only when it's an https page */
function factOf(
  q: { text: string; caption?: string; url?: string } | undefined,
): ShareView['fact'] | null {
  if (!q?.text || !q.caption) return null
  return {
    text: q.text,
    caption: q.caption,
    ...(q.url && /^https:\/\/\S{4,300}$/.test(q.url) ? { url: q.url } : {}),
  }
}

/** A film folder made by the CLI: storyboard.json has everything the page shows. */
export function viewFromStoryboard(board: Storyboard, film: string): ShareView {
  const cta = board.scenes.find((s) => s.kind === 'cta')
  if (cta?.kind !== 'cta') throw new Error('storyboard has no closing scene')
  const insight = board.scenes.find((s) => s.kind === 'insight')
  const fact =
    insight?.kind === 'insight'
      ? factOf({
          text: insight.value ? `${insight.value} ${insight.text}` : insight.text,
          caption: insight.caption,
          ...(insight.sourceUrl ? { url: insight.sourceUrl } : {}),
        })
      : null
  const site = board.scenes.find((s) => s.kind === 'site')
  const noticed = site?.kind === 'site' ? site.caption?.trim() : ''
  const format = (film.match(/film-(square|landscape|portrait)\.mp4$/)?.[1] ??
    'square') as ShareView['format']
  // board.sender is "Name, Company" or "Name"
  const [name, company] = board.sender.split(/,\s*(.+)/)
  return {
    company: board.company,
    format,
    from: company ? `${name} at ${company}` : name!,
    firstName: name!.split(' ')[0]!,
    name: name!,
    ctaLine: cta.line,
    contact: cta.contact,
    film,
    ...(noticed ? { tease: oneLine(noticed, 200) } : {}),
    ...(board.recipient ? { recipient: board.recipient, kind: 'recruiter' as const } : {}),
    ...(fact ? { fact } : {}),
    ...(creatorOf(cta.made) ? { creator: creatorOf(cta.made)! } : {}),
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

/** the sender card's styles, only on pages that have one (a seller's page is as it was) */
const CARD_CSS = `.sender{margin-top:28px;padding:16px 18px;border:1px solid var(--rule);border-radius:12px;display:flex;gap:14px;align-items:flex-start}
.sender img{width:56px;height:56px;border-radius:50%;object-fit:cover;flex:none;background:var(--rule)}
.sender .who{margin:0;color:var(--fg)}
.sender .who a{color:inherit;font-size:14px}
.sender .line{margin:2px 0 0}
.sender .creator{margin:8px 0 0}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`

/**
 * Who sent it, under the ask: a photo when they gave one, their name and LinkedIn, the one line
 * from their profile, and what they built. Missing pieces leave no gap.
 */
function senderCard(v: ShareView, creator: string): string {
  const c = v.card!
  const name = v.name ?? v.firstName
  // the photo is someone else's server: don't tell it which film page asked
  const photo = c.photo
    ? `<img src="${esc(c.photo)}" alt="" width="56" height="56" loading="lazy" referrerpolicy="no-referrer">`
    : ''
  const linkedin = c.linkedin
    ? ` · <a href="${esc(c.linkedin)}" target="_blank" rel="noopener">LinkedIn<span class="sr"> profile of ${esc(name)}</span></a>`
    : ''
  return `<section class="sender" aria-label="Who sent it">${photo}<div><p class="who"><b>${esc(name)}</b>${linkedin}</p><p class="line">${esc(c.line)}</p>${creator}</div></section>`
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
  // who the film is for, and what the viewer on the other side might want to make
  const forWho = v.recipient ?? v.company
  const title = v.kind === 'hiring' ? `${v.company} is hiring` : `A 30-second film for ${forWho}`
  const other =
    v.kind === 'recruiter'
      ? {
          ref: 'share-candidate',
          hash: '',
          line: "Job hunting? Make a film for a company you'd like to work with.",
        }
      : v.kind === 'candidate'
        ? {
            ref: 'share-recruiter',
            hash: '#pitch',
            line: 'Hiring? Pitch your roles to candidates the same way.',
          }
        : { ref: 'share', hash: '', line: "Make one for a company you'd like to work with." }
  made.searchParams.set('ref', other.ref)
  // the project's GitHub page has no #pitch; the hosted app does
  if (other.hash && made.hostname !== 'github.com') made.hash = other.hash
  const [w, h] = FORMAT_SIZE[v.format]
  // link previews name the person, never their company: "A 30-second film for Deel, from Ashwin Tiwari"
  const preview = `${title}, from ${v.name ?? v.firstName}`
  const creatorLine = v.creator
    ? `<p class="creator">Made with <a data-track href="${esc(v.creator.url)}" target="_blank" rel="noopener">${esc(v.creator.name)}</a>, which I built</p>`
    : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(`${v.from} made this for ${v.company}.`)}">
<meta property="og:title" content="${esc(preview)}">
<meta property="og:description" content="${esc(v.tease ?? `From ${v.from}`)}">
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
.related{margin-top:28px;padding:16px 18px;border:1px solid var(--rule);border-radius:12px;display:grid;gap:4px}
.related span{font-size:13px;color:var(--muted)}
.related a{color:var(--fg);text-decoration:none}
.related a:hover b{text-decoration:underline}
.creator{margin:14px 0 0;font-size:15px;color:var(--fg)}
.creator a{color:inherit;font-weight:650}
.quoted{margin:28px 0 0;padding-left:16px;border-left:3px solid var(--stock)}
.quoted blockquote{margin:0;font-size:17px;line-height:1.45}
.quoted figcaption{margin-top:6px;font-size:13px;color:var(--muted)}
.quoted a{color:inherit}
${v.card ? CARD_CSS : ''}.made{display:inline-flex;align-items:center;gap:7px;color:var(--fg);font-weight:650}
.made::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--tally)}
</style></head><body><main>
<figure class="slate" style="margin:0">
<div class="clap" aria-hidden="true"></div>
<video src="${url}/${v.film}" poster="${url}/poster.jpg" controls playsinline preload="metadata" width="${w}" height="${h}"></video>
<figcaption class="fields"><div><span>${v.kind === 'hiring' ? 'Now hiring' : 'Made for'}</span><b>${esc(forWho)}</b></div><div><span>From</span><b>${esc(v.from)}</b></div><div><span>Runs</span><b>0:30</b></div></figcaption>
</figure>
<div class="row"><div><h1>${esc(v.ctaLine)}</h1><p>${v.kind === 'hiring' ? `${esc(v.company)} is hiring. Posted by ${esc(v.from)}.` : `${esc(v.firstName)} made this film for ${esc(v.recipient ? `you, about a role at ${v.company}` : v.company)}.`}</p></div>
<div class="do">${v.book ? `<a class="cta" data-track href="${esc(v.book)}" target="_blank" rel="noopener">${v.kind === 'hiring' ? 'See the role and apply' : 'Book 15 minutes'}</a><a class="cta alt" data-track href="${esc(contactHref(v.contact))}">Reply</a>` : `<a class="cta" data-track href="${esc(contactHref(v.contact))}">Reply to ${esc(v.firstName)}</a>`}</div></div>
${v.card ? `${senderCard(v, creatorLine)}\n` : ''}${v.fact ? `<figure class="quoted"><blockquote>${esc(v.fact.text)}</blockquote><figcaption>${v.fact.url ? `<a href="${esc(v.fact.url)}" target="_blank" rel="noopener">${esc(v.fact.caption)}</a>` : esc(v.fact.caption)}</figcaption></figure>` : ''}
${v.card ? '' : creatorLine}
${v.related ? `<aside class="related"><span>Something I built that’s close to what you do</span><a data-track href="${esc(v.related.url)}" target="_blank" rel="noopener"><b>${esc(v.related.name)}</b> ${esc(v.related.line)}</a></aside>` : ''}
<footer><a class="made" href="${esc(made.toString())}">Made with coldopen</a>. ${esc(other.line)}${privacy ? `<br>Views are counted without storing your IP address. <a href="${esc(privacy)}">Privacy</a>` : ''}</footer>
</main>${track ? trackingScript(track) : ''}</body></html>`
}
