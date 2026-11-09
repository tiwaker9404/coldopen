import { describe, expect, it } from 'vitest'
import { emailLink, gifEmbed } from '../../src/share/embed.ts'

const link = 'https://films.example.com/f/run_01JTESTTESTTESTTESTTESTTEST'

describe('gifEmbed', () => {
  it('wraps the GIF in a link to the share page', () => {
    const html = gifEmbed(link, 'Acme')!
    expect(html.startsWith(`<a href="${link}"`)).toBe(true)
    expect(html).toContain(`<img src="${link}/preview.gif"`)
    expect(html.endsWith('></a>')).toBe(true)
  })

  it('sizes the GIF for email and drops the default link border', () => {
    const html = gifEmbed(link, 'Acme')!
    expect(html).toContain('width="480"')
    expect(html).toContain('style="display:block;max-width:100%;border:0"')
  })

  it('escapes the company in the alt text, so a name cannot break out of the tag', () => {
    const html = gifEmbed(link, `Tom & Jerry's "<b>Shop</b>"`)!
    expect(html).toContain(
      'alt="A 30-second video made for Tom &amp; Jerry&#39;s &quot;&lt;b&gt;Shop&lt;/b&gt;&quot;. Click to watch."',
    )
    expect(html).not.toContain('<b>')
  })

  it('still says what the GIF is when the company is unknown', () => {
    expect(gifEmbed(link, null)).toContain('alt="A 30-second video. Click to watch."')
    expect(gifEmbed(link, '  ')).toContain('alt="A 30-second video. Click to watch."')
  })

  it('trims a trailing slash so the GIF path has one slash', () => {
    expect(gifEmbed(`${link}/`, 'Acme')).toContain(`src="${link}/preview.gif"`)
  })

  it('only makes a snippet for https links', () => {
    expect(gifEmbed('http://films.example.com/f/run_1', 'Acme')).toBeNull()
    expect(gifEmbed('javascript:alert(1)', 'Acme')).toBeNull()
    expect(gifEmbed('/f/run_1', 'Acme')).toBeNull()
    expect(gifEmbed('https://user:pw@films.example.com/f/run_1', 'Acme')).toBeNull()
  })
})

describe('emailLink', () => {
  it('escapes nothing itself but normalises the URL', () => {
    expect(emailLink('https://films.example.com/f/a"b')).toBe('https://films.example.com/f/a%22b')
    expect(emailLink('not a url')).toBeNull()
  })
})
