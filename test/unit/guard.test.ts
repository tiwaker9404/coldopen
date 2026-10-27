import { describe, expect, it } from 'vitest'
import { extractBrand } from '../../src/brand/extract.ts'
import { assertPublicUrl, isPrivateAddress } from '../../src/brand/guard.ts'
import { tmp } from '../helpers/index.ts'

describe('SSRF guard', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.2.3.4', true],
    ['172.20.0.1', true],
    ['192.168.1.10', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['::1', true],
    ['fd12::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['8.8.8.8', false],
    ['151.101.1.69', false],
    ['2606:4700::1111', false],
  ])('%s private=%s', (ip, priv) => {
    expect(isPrivateAddress(ip)).toBe(priv)
  })

  it.each([
    'http://127.0.0.1:8080/',
    'http://localhost/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://db.internal/',
    'file:///etc/passwd',
    'javascript:alert(1)',
  ])('refuses %s', async (url) => {
    await expect(assertPublicUrl(url)).rejects.toThrow()
  })

  it('accepts a public IP without DNS', async () => {
    await expect(assertPublicUrl('https://8.8.8.8/')).resolves.toBeUndefined()
  })

  it('extraction refuses private targets unless explicitly allowed', async () => {
    await expect(extractBrand('http://127.0.0.1:9/', { outDir: tmp() })).rejects.toThrow(
      /private or local address/,
    )
  })
})
