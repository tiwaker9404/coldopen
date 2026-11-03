import type { Profile } from '../script/types.ts'
import { clipWords, deterministicDraft, parseResume } from './parse.ts'

/**
 * Pitch a role: a recruiter makes a film for one candidate. The film is the job-post film
 * turned around: their own company's brand, a requirement from their own post, and the
 * candidate's record (from the profile or résumé text the recruiter pastes) as the answer.
 * Every number on screen comes from the candidate's text; nothing is invented.
 */
export interface PitchInput {
  /** the candidate's profile or résumé, pasted as text */
  candidateText: string
  /** the candidate's name; read from the text when not given */
  candidateName?: string
  recruiter: {
    name: string
    company?: string
    /** where the candidate replies: an email address or a short line */
    contact: string
    /** a booking link for the share page's main button */
    book?: string
  }
  /** the role, when known before the job post is read */
  role?: string
}

export class PitchError extends Error {}

export function recruiterProfile(input: PitchInput): Profile {
  const resume = parseResume(input.candidateText)
  const draft = deterministicDraft(resume, input.role ? { role: input.role } : {})
  // the draft falls back to a placeholder when no bullet has a number: a film without real
  // proof would only be a cold message with music
  const proof = draft.proof.filter((p) => p.label !== 'résumé to turn into proof points')
  if (proof.length === 0)
    throw new PitchError(
      "couldn't find results with numbers in the candidate's text. Paste their full profile or résumé, with the bullets under each role",
    )
  const name = (input.candidateName?.trim() || resume.name || '').trim()
  if (!name || name === 'Your name')
    throw new PitchError("add the candidate's name, so the film can greet them")
  return {
    preset: 'recruiter',
    sender: {
      name: input.recruiter.name.trim(),
      ...(input.recruiter.company ? { company: input.recruiter.company.trim() } : {}),
      role: 'Recruiter',
    },
    recipient: { name: clipWords(name, 80), ...(input.role ? { role: input.role } : {}) },
    offer: clipWords(input.role ? `Our ${input.role} role` : 'A role on our team', 120),
    points: draft.points,
    proof,
    cta: {
      line: 'Could we talk for 15 minutes?',
      contact: input.recruiter.contact.trim(),
      ...(input.recruiter.book ? { book: input.recruiter.book } : {}),
    },
  }
}
