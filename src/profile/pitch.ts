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

/* ------------------------------------------------ a hiring film, for everyone */

/**
 * A hiring film: no candidate in mind, just the role, to post on LinkedIn. The profile starts
 * as a placeholder; `withRole` fills it at film time from the job post and the company's own
 * site, so the lines on screen are the post's words and the numbers are the site's.
 */
export function hiringProfile(input: {
  recruiter: { name: string; company?: string }
  role?: string
}): Profile {
  return {
    preset: 'hiring',
    sender: {
      name: input.recruiter.name.trim(),
      ...(input.recruiter.company ? { company: input.recruiter.company.trim() } : {}),
    },
    offer: clipWords(input.role ? `Our ${input.role} role` : 'An open role on our team', 120),
    points: ['What you would do, from the job post', 'Filled in when the post is read'],
    proof: [{ value: '1', label: 'open role on the team' }],
    cta: { line: 'See the role and apply', contact: 'the job post' },
  }
}

/** a line of the post, short enough for one line of the film (max 10 words), cut where it reads whole */
function roleLine(text: string, max = 10): string | null {
  const t = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;:]$/, '')
  const n = (s: string) => s.split(' ').filter(Boolean).length
  if (n(t) <= max) return n(t) >= 3 ? t : null
  // only cut where the head is a whole thought on its own
  for (const b of [', ', '; ', ' and ']) {
    const at = t.lastIndexOf(b, t.split(' ').slice(0, max).join(' ').length)
    if (at > 0) {
      const head = t.slice(0, at).trim()
      if (n(head) >= 4 && n(head) <= max) return head
    }
  }
  return null
}

/** "Deploy our agents in warehouses" is a duty; "3+ years of Python" or "Experience with…" is a requirement */
export function isDuty(line: string): boolean {
  const w = line.trim().split(/\s+/)[0] ?? ''
  return (
    /^[A-Z][a-z]+$/.test(w) &&
    !/^(Experience|Experienced|Strong|Excellent|Proficiency|Proficient|Familiarity|Familiar|Knowledge|Bachelor|Master|Degree|Ability|Comfort|Comfortable|Fluency|Fluent|Background|Exposure|Track|Demonstrated|Proven|Deep|Solid|Bonus|Nice|Preferred|You|Your|An?|The)$/.test(
      w,
    )
  )
}

/** "38% fewer late deliveries" -> { value: "38%", label: "fewer late deliveries" }, when it fits a stat tile */
function statOf(text: string): { value: string; label: string } | null {
  const m = text
    .replace(/\s+/g, ' ')
    .trim()
    .match(
      /^([$€£]?\d[\d,.]*(?:%|\+|x|k|m|b)?\+?(?:\s(?:min|mins|minutes|hours|hrs|days|weeks|million|billion))?)\s+(.{6,})$/i,
    )
  if (!m || m[1]!.length > 12) return null
  const label = clipWords(m[2]!.replace(/\.$/, ''), 60)
  return label.length >= 3 ? { value: m[1]!, label } : null
}

/**
 * Fills a hiring profile from what research read: the role's lines (requirements and duties,
 * as written) as the points, the company's own numbers as the proof, and the post as the
 * place to apply.
 */
export function withRole(
  profile: Profile,
  kit: {
    name: string
    host: string
    facts: { text: string; kind: string }[]
    job?: { title: string; url?: string }
  },
  applyUrl: string,
): Profile {
  if (profile.preset !== 'hiring') return profile
  // what you would do reads better than what they require: lines that start with a verb
  // ("Deploy our agents…") come first, then the rest ("3+ years…")
  const all = kit.facts
    .filter((f) => f.kind === 'requirement')
    .map((f) => roleLine(f.text))
    .filter((l, i, list): l is string => !!l && list.indexOf(l) === i)
  const duties = all.filter(isDuty)
  const lines = (duties.length >= 2 ? duties : all).slice(0, 3)
  const stats = kit.facts
    .filter((f) => f.kind === 'stat')
    .map((f) => statOf(f.text))
    .filter((s): s is { value: string; label: string } => !!s)
    .filter((s, i, all) => all.findIndex((x) => x.value === s.value) === i)
    .slice(0, 4)
  const apply = applyUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')
  return {
    ...profile,
    offer: kit.job ? `Our ${kit.job.title} role` : profile.offer,
    points: lines.length >= 2 ? lines : profile.points,
    proof: stats.length ? stats.map((s) => ({ ...s, where: kit.name })) : [],
    cta: {
      line: 'See the role and apply',
      contact: apply.length <= 80 ? apply : kit.host,
      book: applyUrl.startsWith('https://') ? applyUrl : `https://${apply}`,
    },
  }
}
