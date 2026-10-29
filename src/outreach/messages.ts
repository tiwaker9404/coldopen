import type { FilmResult } from '../film.ts'
import type { Profile } from '../script/types.ts'

/**
 * The messages that carry a film: an email, a LinkedIn note (300 characters, LinkedIn's limit
 * for a connection request) and a follow-up. Written from what the film already says, so they
 * can't claim anything the film doesn't, and with a [First name] placeholder for the person
 * they go to.
 */
export interface Messages {
  email: { subject: string; body: string }
  linkedin: string
  followUp: string
}

const LINKEDIN_LIMIT = 300

const clean = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]$/, '')

export function draftMessages(
  out: Pick<FilmResult, 'company' | 'job' | 'highlights' | 'script'>,
  profile: Profile,
  link: string,
): Messages {
  const company = out.company
  const role = out.job?.title
  const me = profile.sender.name
  const first = me.split(' ')[0]!
  const candidate = profile.preset === 'candidate'
  const quote = out.highlights?.quote.text ? clean(out.highlights.quote.text) : ''
  const fromPost = /post$/.test(out.highlights?.quote.source ?? '')
  const proof = (out.highlights?.proof ?? [])
    .slice(0, 2)
    .map((p) => clean(`${p.value} ${p.label}${p.where ? ` at ${p.where}` : ''}`))
  const ask = clean(profile.cta.line).replace(/\?*$/, '?')
  const forWhat = role ? ` for your ${role} role` : ''

  const opener = quote
    ? fromPost
      ? `It answers one line from the post, "${quote}",`
      : `It starts from your own site ("${quote}")`
    : `It's in your brand and starts from your homepage`
  const evidence = proof.length
    ? ` with what I've done: ${proof.join('; ')}.`
    : candidate
      ? ', and everything about me in it comes from my résumé.'
      : '.'
  const pitch = out.script?.pitch.headline ? `${clean(out.script.pitch.headline)}.` : ''

  const email = {
    subject: `A 30-second film I made for ${company}${role ? ` (${role})` : ''}`,
    body: [
      'Hi [First name],',
      '',
      `I made a 30-second film for ${company}${forWhat}:`,
      link,
      '',
      `${opener}${evidence}`,
      ...(pitch ? ['', pitch] : []),
      '',
      ask,
      '',
      me,
      profile.cta.contact,
    ].join('\n'),
  }

  const long = `Hi [First name], I made a 30-second film for ${company}${forWhat}: ${link} ${ask} – ${first}`
  const short = `Hi [First name], I made a short film for ${company}: ${link} ${ask} – ${first}`
  const linkedin = long.length <= LINKEDIN_LIMIT ? long : short.slice(0, LINKEDIN_LIMIT)

  const followUp = [
    'Hi [First name],',
    '',
    `Bumping this in case it got buried: the film I made for ${company}${forWhat} is here, ${link}`,
    '',
    `Happy to walk you through how it was made. ${ask}`,
    '',
    first,
  ].join('\n')

  return { email, linkedin, followUp }
}
