import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import type { HTTPRequest, Page } from 'puppeteer'

/**
 * SSRF guard for the research browser. A hosted coldopen visits URLs typed by users, so
 * without this anyone could point it at http://169.254.169.254 (cloud credentials), a
 * database admin port, or the office network. Every request the page makes (navigation,
 * redirects, scripts, images) is checked against private, loopback and link-local ranges.
 */
const PRIVATE = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(net, bits, 'ipv4')
}
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(net, bits, 'ipv6')
}

export function isPrivateAddress(ip: string): boolean {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1]
  if (mapped) return PRIVATE.check(mapped, 'ipv4')
  const v = isIP(ip)
  if (v === 4) return PRIVATE.check(ip, 'ipv4')
  if (v === 6) return PRIVATE.check(ip, 'ipv6')
  return true
}

const cache = new Map<string, Promise<boolean>>()

/** true if every address the host resolves to is public */
export async function isPublicHost(host: string): Promise<boolean> {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h.endsWith('.internal') ||
    h.endsWith('.local')
  )
    return false
  if (isIP(h)) return !isPrivateAddress(h)
  if (!cache.has(h)) {
    cache.set(
      h,
      lookup(h, { all: true })
        .then((addrs) => addrs.length > 0 && addrs.every((a) => !isPrivateAddress(a.address)))
        .catch(() => true), // unresolvable: let the browser fail naturally with a DNS error
    )
    setTimeout(() => cache.delete(h), 60_000).unref()
  }
  return cache.get(h)!
}

export class BlockedUrlError extends Error {}

export async function assertPublicUrl(url: string): Promise<void> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new BlockedUrlError(`not a valid URL: ${url}`)
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:')
    throw new BlockedUrlError('only http and https URLs can be researched')
  if (!(await isPublicHost(u.hostname))) {
    throw new BlockedUrlError(
      `${u.hostname} is a private or local address; only public websites can be researched`,
    )
  }
}

/** Abort any request from the page that targets a private network. */
export async function guardPage(page: Page): Promise<void> {
  await page.setRequestInterception(true)
  page.on('request', (req: HTTPRequest) => {
    if (req.isInterceptResolutionHandled()) return
    const url = req.url()
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      void req.continue()
      return
    }
    let host: string
    try {
      const u = new URL(url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        void req.abort('blockedbyclient')
        return
      }
      host = u.hostname
    } catch {
      void req.abort('blockedbyclient')
      return
    }
    isPublicHost(host).then(
      (ok) => (ok ? req.continue() : req.abort('blockedbyclient')),
      () => req.abort('blockedbyclient'),
    )
  })
}
