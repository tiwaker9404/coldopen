import { describe, expect, it } from 'vitest'
import {
  ATTACH_SLOT,
  emailLink,
  emailWithFilm,
  filmPlace,
  gifEmbed,
  watchHere,
  withBackupLink,
} from '../../src/share/embed.ts'

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

describe('the email with the film in it', () => {
  const body = [
    'Hi [First name],',
    '',
    "I tried Acme's rate API this weekend, and the per-zone view saved me a spreadsheet.",
    '',
    "I put what I'd try next with Acme into a 30-second film:",
    link,
    '',
    'Thanks for reading,',
    'Alex Rivera',
    'alex@example.com',
  ].join('\n')
  const count = (s: string, part: string) => s.split(part).length - 1

  it("the email copies with the GIF at the film's place and a backup link", () => {
    const { html, plain } = emailWithFilm(body, link, 'Acme')!
    // the GIF exactly once, linked to the share page
    expect(count(html, '<img ')).toBe(1)
    expect(html).toContain(gifEmbed(link, 'Acme')!)
    // and the plain link once, under it
    expect(count(html, `>${link}</a>`)).toBe(1)
    expect(html).toContain(`Watch it here: <a href="${link}"`)
    // where the tease points to it: right after the tease line, before the thanks
    const tease = html.indexOf('into a 30-second film:')
    const gif = html.indexOf('<img ')
    const watch = html.indexOf('Watch it here')
    expect(tease).toBeGreaterThan(-1)
    expect(tease).toBeLessThan(gif)
    expect(gif).toBeLessThan(watch)
    expect(watch).toBeLessThan(html.indexOf('Thanks for reading,'))
    // paragraphs as the draft has them, the signature's lines kept together
    expect(html).toContain('<p style="margin:0 0 14px">Hi [First name],</p>')
    expect(html).toContain('Thanks for reading,<br>Alex Rivera<br>alex@example.com</p>')
    // the plain twin is the draft as written: the link once, no image markup
    expect(plain).toBe(body)
    expect(count(plain, link)).toBe(1)
    expect(plain).not.toMatch(/<img|<a |preview\.gif/)
  })

  it('keeps the subject out, and escapes what the draft says', () => {
    const { html } = emailWithFilm(
      body.replace('Hi [First name],', 'Hi <Dana> & team,'),
      link,
      'Acme',
    )!
    expect(html).toContain('Hi &lt;Dana&gt; &amp; team,')
    expect(html).not.toContain('Subject')
  })

  it('puts the GIF mid-line when the link is inside a sentence', () => {
    const inline = `Hi [First name],\n\nHere's what I'd try: ${link} Curious what you think.\n\nAlex`
    const { html } = emailWithFilm(inline, link, 'Acme')!
    expect(html).toContain(`<p style="margin:0 0 14px">Here&#39;s what I&#39;d try:</p><p`)
    expect(html).toContain('<p style="margin:0 0 14px">Curious what you think.</p>')
    expect(count(html, '<img ')).toBe(1)
  })

  it("copies plain text instead when the link can't be emailed or isn't there once", () => {
    expect(
      emailWithFilm(body.replace(link, 'http://x.example/f/1'), 'http://x.example/f/1', 'Acme'),
    ).toBeNull()
    expect(emailWithFilm(body.replace(link, ''), link, 'Acme')).toBeNull()
    expect(emailWithFilm(`${body}\n${link}`, link, 'Acme')).toBeNull()
  })
})

describe('the LinkedIn messages, with a place to attach the GIF', () => {
  const msg = `Hi [First name], thanks for connecting.\n\nI put what I'd try next with Acme into a 30-second film: ${link}\n\nThank you for your time,\nAlex`

  it('splits the draft where the film goes', () => {
    const at = filmPlace(msg, link)!
    expect(at.before.endsWith('30-second film: ')).toBe(true)
    expect(at.after.startsWith('\n\nThank you')).toBe(true)
    expect(filmPlace(msg.replace(link, ''), link)).toBeNull()
    expect(filmPlace(msg, '')).toBeNull()
  })

  it('copies with the link kept as a backup', () => {
    const copied = withBackupLink(msg, link)
    expect(copied).toContain(`30-second film: ${watchHere(link)}\n\n`)
    expect(watchHere(link)).toBe(`(or watch it here: ${link})`)
    expect(copied.split(link).length - 1).toBe(1)
    expect(ATTACH_SLOT).toBe('Attach the GIF here')
  })
})
