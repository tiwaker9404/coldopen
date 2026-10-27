import type { FilmInput, FilmResult } from '../film.ts'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * The page a prospect lands on from the GIF in an email: the film, one clear action, and
 * nothing else. Open Graph tags make the link unfurl with the poster in Slack and LinkedIn.
 */
export function sharePage(input: FilmInput, out: FilmResult, url: string): string {
  const p = input.profile
  const from = p.sender.company ? `${p.sender.name} at ${p.sender.company}` : p.sender.name
  const title = `A 30-second film for ${out.company}`
  const film = out.files.film.split('/').pop()!
  const contact = p.cta.contact
  const href =
    contact.includes('@') && !contact.startsWith('http')
      ? `mailto:${contact}`
      : contact.startsWith('http')
        ? contact
        : `https://${contact}`
  const [w, h] =
    out.format === 'landscape'
      ? [1920, 1080]
      : out.format === 'portrait'
        ? [1080, 1920]
        : [1080, 1080]
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(`${from} made this for ${out.company}.`)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(`From ${from}`)}">
<meta property="og:image" content="${url}/poster.jpg">
<meta property="og:video" content="${url}/${film}">
<meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="${w}"><meta property="og:video:height" content="${h}">
<meta name="twitter:card" content="summary_large_image">
<meta name="robots" content="noindex">
<style>
:root{color-scheme:light dark;--bg:#f4f5f7;--fg:#15171c;--muted:#5d6370;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#121418;--fg:#eef0f3;--muted:#9aa1ad;--card:#1b1e24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px}
main{width:min(100%,${out.format === 'landscape' ? 960 : out.format === 'portrait' ? 420 : 640}px)}
video{width:100%;height:auto;display:block;border-radius:14px;background:#000;box-shadow:0 20px 50px rgba(0,0,0,.18)}
h1{font-size:20px;font-weight:650;margin:20px 0 2px}p{margin:0;color:var(--muted)}
.row{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-top:4px}
a.cta{display:inline-block;background:var(--fg);color:var(--bg);text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px}
a.cta:focus-visible{outline:3px solid #3f6fd8;outline-offset:3px}
</style></head><body><main>
<video src="${url}/${film}" poster="${url}/poster.jpg" controls playsinline preload="metadata" width="${w}" height="${h}"></video>
<div class="row"><div><h1>${esc(p.cta.line)}</h1><p>From ${esc(from)}, made for ${esc(out.company)}</p></div>
<a class="cta" href="${esc(href)}">Reply to ${esc(p.sender.name.split(' ')[0]!)}</a></div>
</main></body></html>`
}
