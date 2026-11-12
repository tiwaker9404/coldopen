/**
 * The snippet "Copy GIF for email" puts on the clipboard as text/html: the film's looping GIF,
 * wrapped in a link to its share page. Mail clients only show an image they can fetch from the
 * open internet, and Gmail's image proxy won't load plain http, so a link that isn't https gets
 * no snippet at all rather than one that pastes as a broken picture.
 */

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** The share link as a clean https URL with no trailing slash, or null if it can't be emailed. */
export function emailLink(link: string): string | null {
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return url.href.replace(/\/$/, '')
}

/** `<a href="…/f/id"><img src="…/f/id/preview.gif" …></a>`, ready to paste into Gmail or Outlook. */
export function gifEmbed(link: string, company: string | null | undefined): string | null {
  const href = emailLink(link)
  if (!href) return null
  const alt = company?.trim()
    ? `A 30-second video made for ${company.trim()}. Click to watch.`
    : 'A 30-second video. Click to watch.'
  return (
    `<a href="${esc(href)}" target="_blank" style="text-decoration:none">` +
    `<img src="${esc(`${href}/preview.gif`)}" width="480" alt="${esc(alt)}" ` +
    'style="display:block;max-width:100%;border:0"></a>'
  )
}

/** What the LinkedIn drafts show where the film goes: the GIF is attached there by hand. */
export const ATTACH_SLOT = 'Attach the GIF here'

/** The share link as the LinkedIn drafts keep it, a backup for anyone the GIF doesn't play for. */
export const watchHere = (link: string) => `(or watch it here: ${link})`

/**
 * An after-accept or InMail draft, split where the film goes: the text before, the link, and the
 * text after. Null when the link isn't there exactly once, so the panel shows the draft as is.
 */
export function filmPlace(body: string, link: string): { before: string; after: string } | null {
  if (!link) return null
  const parts = body.split(link)
  if (parts.length !== 2) return null
  return { before: parts[0]!, after: parts[1]! }
}

/** What a LinkedIn draft's Copy puts on the clipboard: the link kept as "(or watch it here: …)". */
export function withBackupLink(body: string, link: string): string {
  const at = filmPlace(body, link)
  return at ? `${at.before}${watchHere(link)}${at.after}` : body
}

const PARA = 'style="margin:0 0 14px"'
const para = (text: string) =>
  `<p ${PARA}>${text
    .split('\n')
    .map((l) => esc(l))
    .join('<br>')}</p>`

/**
 * "Copy email with the film": the email as rich text, with the linked GIF exactly where the tease
 * points to the film and a plain "Watch it here" line under it, plus its text/plain twin, which is
 * the draft as written (the link where the film goes, no image markup). The subject isn't part of
 * it: it goes in the draft's subject line. Null when the link can't be emailed (not https) or the
 * body doesn't carry it exactly once, so the caller copies plain text instead.
 */
export function emailWithFilm(
  body: string,
  link: string,
  company: string | null | undefined,
): { html: string; plain: string } | null {
  const href = emailLink(link)
  const gif = gifEmbed(link, company)
  if (!href || !gif || !filmPlace(body, link)) return null
  const html = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const at = filmPlace(p, link)
      if (!at) return para(p)
      const before = at.before.trim()
      const after = at.after.trim()
      return [
        ...(before ? [para(before)] : []),
        `<p ${PARA}>${gif}</p>`,
        `<p ${PARA}>Watch it here: <a href="${esc(href)}" target="_blank">${esc(href)}</a></p>`,
        ...(after ? [para(after)] : []),
      ].join('')
    })
    .join('')
  return { html: `<div>${html}</div>`, plain: body }
}
