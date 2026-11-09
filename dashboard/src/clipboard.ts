/**
 * Puts HTML on the clipboard as rich text, with a plain-text twin for places that only take text.
 * Mail clients read the text/html part, so a pasted <a><img></a> shows as a picture, not as code.
 * Returns false where the browser has no ClipboardItem (older Firefox), so the caller can fall
 * back to the plain text.
 */
export async function copyRich(html: string, plain: string): Promise<boolean> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return false
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    }),
  ])
  return true
}
