import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Serves the fixture company websites used by tests, evals and demos:
 *   /northwind/   /lumen/   /parcelpine/   /fonts/<family>/...
 * They are fictional companies with real-world structure (web fonts, nav, CTAs, stats).
 */
const SITES = join(import.meta.dirname, 'sites')
const MODULES = join(import.meta.dirname, '..', 'node_modules', '@fontsource-variable')
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
}

export function serveFixtures(port = 0): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
    let file: string
    if (path.startsWith('/fonts/')) file = normalize(join(MODULES, path.slice(7)))
    else file = normalize(join(SITES, path.endsWith('/') ? `${path}index.html` : path))
    if (!(file.startsWith(SITES) || file.startsWith(MODULES)) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'access-control-allow-origin': '*' })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolve) =>
    server.listen(port, '127.0.0.1', () => {
      const a = server.address()
      resolve({ server, url: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : port}` })
    }),
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { url } = await serveFixtures(Number(process.env.PORT ?? 4100))
  console.log(`fixture sites:\n  ${url}/northwind/\n  ${url}/lumen/\n  ${url}/parcelpine/`)
}
