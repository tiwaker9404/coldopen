import { randomBytes } from 'node:crypto'
import rateLimit from '@fastify/rate-limit'
import type { FastifyInstance, FastifyRequest } from 'fastify'

/**
 * The web-facing defenses every response gets, in one place:
 *
 * - security headers: a Content-Security-Policy (scripts only from this origin, or inline ones
 *   carrying this response's nonce), no framing, no MIME sniffing, a strict referrer policy,
 *   HSTS on https, and no camera, microphone or location
 * - a cross-site check: a request that changes something (POST, PUT, PATCH, DELETE) riding on
 *   the session cookie must come from this site's own pages. SameSite=Lax cookies already stop
 *   most of it; this closes the rest
 * - rate limits per address: generous for the API, tight for sign-in and the share page's
 *   view beacon, which anyone on the internet can call
 */

export interface SecurityOptions {
  publicUrl: string
  /** the API docs page (Swagger UI) needs inline scripts of its own */
  docsPrefix?: string
  /** requests a minute from one address; 0 turns limits off (tests) */
  perMinute?: number
}

const NONCE = Symbol('nonce')
type WithNonce = FastifyRequest & { [NONCE]?: string }

export function csp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    // React and the share page set style attributes; no style can run script
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    // the profile editor lists your public GitHub repositories straight from GitHub
    "connect-src 'self' https://api.github.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self' https://github.com https://accounts.google.com",
  ].join('; ')
}

/** Adds this response's nonce to every inline <script> in a page */
export function withNonce(html: string, nonce: string): string {
  return html.replace(/<script(?![^>]*\bsrc=)(?![^>]*\bnonce=)/g, `<script nonce="${nonce}"`)
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Should this request be refused as cross-site? Only cookie-authenticated, state-changing
 * requests whose Origin (or Referer) names another site. API clients send a bearer token and
 * no cookie, and Slack's webhook signs its requests, so neither is affected.
 */
export function crossSite(
  req: { method: string; url: string; headers: Record<string, string | string[] | undefined> },
  publicUrl: string,
): boolean {
  if (!UNSAFE.has(req.method)) return false
  if (req.url.startsWith('/slack/') || req.url.startsWith('/mcp')) return false
  if (/^\/f\/[^/]+\/v$/.test(req.url.split('?')[0]!)) return false
  const h = req.headers
  if (String(h.authorization ?? '').startsWith('Bearer ')) return false
  if (!h.cookie) return false
  const from = String(h.origin ?? h.referer ?? '')
  if (!from || from === 'null') return !!h.origin
  try {
    const host = new URL(from).host
    // its own address (PUBLIC_URL), or the host the request was sent to, behind any proxy
    const self = String(h['x-forwarded-host'] ?? h.host ?? '')
      .split(',')[0]!
      .trim()
    return host !== new URL(publicUrl).host && host !== self
  } catch {
    return true
  }
}

export async function registerSecurity(app: FastifyInstance, o: SecurityOptions): Promise<void> {
  const https = o.publicUrl.startsWith('https://')
  const docs = o.docsPrefix ?? '/docs'

  if ((o.perMinute ?? 600) > 0)
    await app.register(rateLimit, {
      global: true,
      // at the default 600 a minute: sign-in 30, the view beacon 120
      max: (req) => {
        const all = o.perMinute ?? 600
        if (req.url.startsWith('/auth/')) return Math.ceil(all / 20)
        if (/^\/f\/[^/]+\/v/.test(req.url)) return Math.ceil(all / 5)
        return all
      },
      timeWindow: '1 minute',
      allowList: (req) => req.url.startsWith('/healthz'),
      // thrown as an error, so the app's error handler words it like every other error
      errorResponseBuilder: (_req, ctx) =>
        Object.assign(new Error(`Too many requests; try again in ${Math.ceil(ctx.ttl / 1000)}s`), {
          statusCode: 429,
        }),
    })

  app.addHook('onRequest', async (req, reply) => {
    ;(req as WithNonce)[NONCE] = randomBytes(16).toString('base64')
    if (crossSite(req, o.publicUrl))
      return reply.status(403).send({
        error: { code: 'cross_site', message: 'that request came from another site' },
      })
  })

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff')
    reply.header('referrer-policy', 'strict-origin-when-cross-origin')
    reply.header('x-frame-options', 'DENY')
    reply.header(
      'permissions-policy',
      'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    )
    reply.header('cross-origin-opener-policy', 'same-origin')
    if (https) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains')
    const type = String(reply.getHeader('content-type') ?? '')
    // a 304 refreshes the cached page's headers, so it carries the policy too
    const page = type.includes('text/html') || reply.statusCode === 304
    if (!page || req.url.startsWith(docs)) return payload
    const nonce = (req as WithNonce)[NONCE] ?? randomBytes(16).toString('base64')
    reply.header('content-security-policy', csp(nonce))
    return typeof payload === 'string' ? withNonce(payload, nonce) : payload
  })
}
