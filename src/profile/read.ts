import { extname } from 'node:path'

/**
 * Turn an uploaded résumé into plain text: PDF, Word (.docx), Markdown or text.
 * Extraction libraries load lazily, so the CLI and API only pay for what's used.
 */
export async function resumeText(data: Uint8Array, filename: string): Promise<string> {
  const ext = extname(filename).toLowerCase()
  let text: string
  if (ext === '.pdf' || isPdf(data)) {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(data)
    text = (await extractText(pdf, { mergePages: true })).text
  } else if (ext === '.docx') {
    const mammoth = await import('mammoth')
    text = (await mammoth.extractRawText({ buffer: Buffer.from(data) })).value
  } else if (['.txt', '.md', '.markdown', ''].includes(ext)) {
    text = new TextDecoder().decode(data)
  } else {
    throw new Error(`can't read ${ext} files; use a PDF, .docx, .md or .txt résumé`)
  }
  text = text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
  if (text.length < 200)
    throw new Error(
      'found almost no text in that résumé. If it is a scanned image, export it as a text PDF first',
    )
  return text
}

function isPdf(data: Uint8Array): boolean {
  return data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46 // %PDF
}
