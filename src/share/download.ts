/**
 * ?download=Linear - Ashwin.mp4 saves the file under that name instead of playing it. Browsers
 * ignore <a download> across origins, so the name has to come from the server.
 */
export function attachment(name: string | null, file: string): string | null {
  if (!name) return null
  const ext = file.slice(file.lastIndexOf('.'))
  const clean = name
    .normalize('NFKD')
    .replace(/[^\w .,()&'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
  if (!clean) return null
  const full = clean.toLowerCase().endsWith(ext) ? clean : `${clean}${ext}`
  return `attachment; filename="${full.replace(/"/g, '')}"`
}
