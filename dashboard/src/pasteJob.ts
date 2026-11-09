import { needsPastedText, needsSiteMessage, needsTextMessage, walledSite } from './api.ts'

/**
 * The composer when the link pasted is a job post coldopen can't read (LinkedIn, Indeed,
 * Glassdoor, or one that already failed behind a sign-in page): the post's text and the
 * company's website are asked for up front, so the film is never queued to fail. Pure, so the
 * rules are tested without a browser.
 */

export interface PasteState {
  /** what was pasted into the main field */
  link: string
  /** the job description, pasted */
  text: string
  /** the company's website */
  site: string
  /** asked for even though the link looked readable (a film made from it failed) */
  forced?: boolean
}

export const MIN_JOB_TEXT = 40

/** True when the main field holds a link that needs its description pasted. */
export function pasting(s: Pick<PasteState, 'link' | 'forced'>): boolean {
  const l = s.link.trim()
  return !!l && (needsPastedText(l) || !!s.forced)
}

const looksLikeSite = (u: string) => /^(https?:\/\/)?[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(u.trim())

/** The line under the field: what's missing, or what will happen. */
export function pasteNote(s: PasteState): string {
  const l = s.link.trim()
  const ask = needsPastedText(l)
    ? needsTextMessage(l)
    : 'That job page couldn’t be read, so paste the job description below.'
  if (s.text.trim().length < MIN_JOB_TEXT) return ask
  if (!looksLikeSite(s.site))
    return needsPastedText(l) ? needsSiteMessage(l) : 'Add the company’s website too.'
  return 'The film answers one requirement from the description you pasted, with your results.'
}

/** The request body for POST /v1/films, or null while something is still missing. */
export function pasteBody(
  s: PasteState,
): { url: string; job: { url: string; text: string } } | null {
  const text = s.text.trim()
  const site = s.site.trim()
  if (text.length < MIN_JOB_TEXT || !looksLikeSite(site)) return null
  const link = s.link.trim()
  return {
    url: /^https?:\/\//i.test(site) ? site : `https://${site}`,
    job: { url: /^https?:\/\//i.test(link) ? link : `https://${link}`, text },
  }
}

/** For a job link typed into the "Job post" box under Options: the box wants the text instead. */
export function jobBoxNote(job: string): string | null {
  const j = job.trim()
  if (!needsPastedText(j)) return null
  return `${walledSite(j)} job pages need a login, so paste the job description here instead of the link.`
}

/** Links in a list of several that can't be filmed without their text. */
export function walledInList(urls: string[]): string | null {
  const bad = urls.filter((u) => needsPastedText(u))
  if (!bad.length) return null
  const site = walledSite(bad[0]!)
  return `${site} job links need a login, so they can’t go in a list. ${bad.length === 1 ? 'Make that one on its own' : 'Make those one at a time'} and paste the description.`
}
