/**
 * The film panel's messages, in the order you send them: the LinkedIn sequence (connection
 * note, the message once they accept, InMail when it's an option), then the email and the
 * follow-up. A hiring film opens on its LinkedIn post. Also the two quiet disclosures a draft
 * can carry: why it's the template version, and what code changed in it. Pure, so the order
 * and the wording are tested without a browser.
 */
import { MESSAGE_LIMITS, type MessageKind } from '../../src/outreach/checks.ts'
import type { Messages, Opener } from './api.ts'

export type MessageTab = 'post' | 'note' | 'afterAccept' | 'inmail' | 'email' | 'followUp'

type Drafts = Pick<Messages, 'post' | 'afterAccept' | 'inmail'>

/** The tabs this film has, in send order. */
export function messageTabs(m: Drafts): { id: MessageTab; label: string }[] {
  return [
    ...(m.post ? [{ id: 'post' as const, label: 'LinkedIn post' }] : []),
    { id: 'note', label: 'Connection note' },
    ...(m.afterAccept ? [{ id: 'afterAccept' as const, label: 'After they accept' }] : []),
    ...(m.inmail ? [{ id: 'inmail' as const, label: 'InMail' }] : []),
    { id: 'email', label: 'Email' },
    { id: 'followUp', label: 'Follow-up' },
  ]
}

/** Where the panel opens: the follow-up when one is due, else the first message you'd send. */
export function openingTab(m: Drafts, followUp: boolean): MessageTab {
  return followUp ? 'followUp' : messageTabs(m)[0]!.id
}

/** The line under the tabs that says what to do with this message. */
export const HINT: Record<MessageTab, string> = {
  post: 'Post it on LinkedIn with the film attached (Download MP4 above): a native video reaches more people than a link.',
  note: 'Connect, Add a note, paste. No link: the film goes in the message once they accept.',
  afterAccept: 'Send this once they accept your request.',
  inmail:
    'InMail is free only if they have an Open Profile or you’re in a group together. Otherwise, use the connection note.',
  email: 'Your first message, with the film’s link in it.',
  followUp:
    'One more note if you haven’t heard back, with something new: a week on, or 4 days for a sales film.',
}

/** What the film panel says about the way this film's email opens (the A/B in Today) */
export const OPENER_NOTE: Record<Opener, string> = {
  homework: 'This one leads with your homework.',
  question: 'This one leads with your question for them.',
  film: 'This one leads with the film.',
  proof: 'This one leads with your best number.',
}

/** "143 of 200 characters", the connection note's limit on a free LinkedIn account */
export const noteCount = (text: string) => `${text.length} of ${MESSAGE_LIMITS.note} characters`

/** Which draft a tab shows, as the API names it in writer, flags and notes (the post has none). */
export function draftOf(tab: MessageTab, last = false): MessageKind | null {
  if (tab === 'post') return null
  if (tab === 'followUp') return last ? 'lastNote' : 'followUp'
  return tab
}

export interface Disclosures {
  /** why the model's draft fell back to the template: each failed check, in plain words */
  why: string[]
  /** what code changed in the draft that was kept, in plain sentences */
  changed: string[]
}

/**
 * What a draft discloses. Most drafts have nothing to say, and then both lists are empty and
 * nothing shows: "why" only for a template that stands in for a failed model draft, "changed"
 * only when code adjusted it.
 */
export function disclosures(
  m: Pick<Messages, 'writer' | 'flags' | 'notes'>,
  draft: MessageKind | null,
): Disclosures {
  if (!draft) return { why: [], changed: [] }
  const failed = (m.flags?.[draft] ?? []).filter((c) => !c.ok && c.why?.trim())
  const why = m.writer?.[draft] === 'template' ? failed.map((c) => c.why!.trim()) : []
  const changed = (m.notes?.[draft] ?? []).map((s) => s.trim()).filter(Boolean)
  return { why: [...new Set(why)], changed }
}
