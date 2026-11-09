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
