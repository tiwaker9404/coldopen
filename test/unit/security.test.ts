import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { crossSite, csp, registerSecurity, withNonce } from '../../src/api/security.ts'
import { isPrivateAddress } from '../../src/brand/guard.ts'
import { DATA_FONT } from '../../src/render/theme.ts'

const site = 'https://coldopen.example'

async function app(perMinute = 600) {
  const a = Fastify()
  await registerSecurity(a, { publicUrl: site, perMinute })
  a.get('/', async (_r, reply) => reply.type('text/html').send('<p>hi</p><script>go()</script>'))
  a.post('/v1/things', async () => ({ ok: true }))
  a.get('/auth/github', async () => 'ok')
  return a
}

describe('security headers', () => {
  it('sends a CSP with a fresh nonce on pages, and marks their inline scripts with it', async () => {
    const a = await app()
    const r = await a.inject({ url: '/' })
    const policy = String(r.headers['content-security-policy'])
    const nonce = policy.match(/'nonce-([^']+)'/)![1]!
    expect(r.body).toContain(`<script nonce="${nonce}">`)
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("object-src 'none'")
    expect(r.headers['x-frame-options']).toBe('DENY')
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['strict-transport-security']).toContain('max-age=')
    const again = await a.inject({ url: '/' })
    expect(again.headers['content-security-policy']).not.toBe(policy)
  })

  it('leaves external scripts and already-marked ones alone', () => {
    expect(withNonce('<script src="/a.js"></script><script nonce="x">1</script>', 'n')).toBe(
      '<script src="/a.js"></script><script nonce="x">1</script>',
    )
    expect(csp('n')).not.toContain('unsafe-eval')
  })
})

describe('cross-site requests', () => {
  const req = (method: string, headers: Record<string, string>, url = '/v1/things') => ({
    method,
    url,
    headers,
  })
  it('refuses a cookie-authenticated change from another site', async () => {
    expect(crossSite(req('POST', { cookie: 's=1', origin: 'https://evil.example' }), site)).toBe(
      true,
    )
    expect(crossSite(req('POST', { cookie: 's=1', origin: 'null' }), site)).toBe(true)
    const a = await app()
    const r = await a.inject({
      method: 'POST',
      url: '/v1/things',
      headers: { cookie: 's=1', origin: 'https://evil.example' },
    })
    expect(r.statusCode).toBe(403)
  })
  it('allows its own pages, API clients, reads, and the share page beacon', () => {
    expect(crossSite(req('POST', { cookie: 's=1', origin: site }), site)).toBe(false)
    expect(
      crossSite(req('POST', { authorization: 'Bearer co_x', origin: 'https://x.y' }), site),
    ).toBe(false)
    expect(crossSite(req('GET', { cookie: 's=1', origin: 'https://evil.example' }), site)).toBe(
      false,
    )
    expect(
      crossSite(req('POST', { cookie: 's=1', origin: 'https://x.y' }, '/f/run_1/v'), site),
    ).toBe(false)
    expect(crossSite(req('POST', { origin: 'https://x.y' }), site)).toBe(false)
  })
})

describe('rate limits', () => {
  it('limits sign-in harder than the API', async () => {
    const a = await app()
    let last = 0
    for (let i = 0; i < 31; i++) last = (await a.inject({ url: '/auth/github' })).statusCode
    expect(last).toBe(429)
    expect((await a.inject({ url: '/' })).statusCode).toBe(200)
  })
})

describe('SSRF and injection guards', () => {
  it('treats private, loopback, link-local and mapped addresses as private', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '169.254.169.254',
      '192.168.0.1',
      '::1',
      '::ffff:10.0.0.1',
      'fd00::1',
    ])
      expect(isPrivateAddress(ip)).toBe(true)
    expect(isPrivateAddress('93.184.216.34')).toBe(false)
  })
  it('only takes an inlined font that is plainly a font', () => {
    expect(DATA_FONT.test('data:font/woff2;base64,d09GMgABAAAA')).toBe(true)
    expect(DATA_FONT.test('data:font/woff2;base64,AAAA);}</style><script>x()</script>')).toBe(false)
  })
})
