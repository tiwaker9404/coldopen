/**
 * Sync to HubSpot (the free CRM): who each film went to becomes a contact, the company a company,
 * the two associated, and every step a note on both timelines: the film was sent (with its link),
 * watched, replied to, an interview. With the person's own private app token (scopes:
 * crm.objects.contacts.write, crm.objects.companies.write and their read scopes); nothing is
 * synced without it.
 */

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>

const API = 'https://api.hubapi.com'

export class HubSpotError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function hs<T>(
  token: string,
  f: FetchFn,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await f(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  })
  if (res.ok) return (res.status === 204 ? {} : await res.json()) as T
  const why =
    res.status === 401
      ? "HubSpot didn't accept that token"
      : res.status === 403
        ? 'The HubSpot token is missing a scope: it needs contacts and companies, read and write'
        : res.status === 429
          ? 'HubSpot is rate-limiting; it will sync on the next change'
          : `HubSpot answered HTTP ${res.status}`
  throw new HubSpotError(res.status, why)
}

/** Checks a token can read contacts; returns the HubSpot account (portal) id when it says */
export async function checkHubSpot(
  token: string,
  f: FetchFn = fetch,
): Promise<{ portal: number | null }> {
  await hs(token, f, 'GET', '/crm/v3/objects/contacts?limit=1')
  try {
    const a = await hs<{ portalId?: number }>(token, f, 'GET', '/account-info/v3/details')
    return { portal: a.portalId ?? null }
  } catch {
    return { portal: null }
  }
}

interface Found {
  results?: { id: string }[]
}

const split = (name: string) => {
  const parts = name.trim().split(/\s+/)
  return { firstname: parts[0] ?? '', lastname: parts.slice(1).join(' ') }
}

/** The contact with this email, made or updated */
export async function upsertContact(
  token: string,
  p: {
    email: string
    name?: string | undefined
    company?: string | undefined
    title?: string | undefined
  },
  f: FetchFn = fetch,
): Promise<string> {
  const properties = {
    email: p.email,
    ...(p.name ? split(p.name) : {}),
    ...(p.company ? { company: p.company } : {}),
    ...(p.title ? { jobtitle: p.title } : {}),
  }
  const found = await hs<Found>(token, f, 'POST', '/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: p.email }] }],
    limit: 1,
  })
  const id = found.results?.[0]?.id
  if (id) {
    await hs(token, f, 'PATCH', `/crm/v3/objects/contacts/${id}`, { properties })
    return id
  }
  return (await hs<{ id: string }>(token, f, 'POST', '/crm/v3/objects/contacts', { properties })).id
}

/** The company with this domain, found or made */
export async function upsertCompany(
  token: string,
  c: { domain: string; name: string },
  f: FetchFn = fetch,
): Promise<string> {
  const found = await hs<Found>(token, f, 'POST', '/crm/v3/objects/companies/search', {
    filterGroups: [{ filters: [{ propertyName: 'domain', operator: 'EQ', value: c.domain }] }],
    limit: 1,
  })
  const id = found.results?.[0]?.id
  if (id) return id
  return (
    await hs<{ id: string }>(token, f, 'POST', '/crm/v3/objects/companies', {
      properties: { domain: c.domain, name: c.name },
    })
  ).id
}

/** Ties the contact to the company (HubSpot's default association) */
export async function associate(
  token: string,
  contactId: string,
  companyId: string,
  f: FetchFn = fetch,
): Promise<void> {
  await hs(
    token,
    f,
    'PUT',
    `/crm/v4/objects/contact/${contactId}/associations/default/company/${companyId}`,
  )
}

/** HubSpot's own association types for a note: on a contact (202), on a company (190) */
const NOTE_TO = { contact: 202, company: 190 } as const

/** A note on the contact's and the company's timelines */
export async function addNote(
  token: string,
  body: string,
  on: { contactId?: string | null; companyId?: string | null },
  f: FetchFn = fetch,
  at = new Date(),
): Promise<string> {
  const associations = [
    ...(on.contactId ? [{ id: on.contactId, type: NOTE_TO.contact }] : []),
    ...(on.companyId ? [{ id: on.companyId, type: NOTE_TO.company }] : []),
  ].map((a) => ({
    to: { id: a.id },
    types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: a.type }],
  }))
  return (
    await hs<{ id: string }>(token, f, 'POST', '/crm/v3/objects/notes', {
      properties: { hs_timestamp: at.toISOString(), hs_note_body: body },
      associations,
    })
  ).id
}

export interface CrmState {
  contactId?: string
  companyId?: string
  /** the steps already noted, so a step is noted once: "sent", "replied", "interview", "watched" */
  noted: string[]
  syncedAt: string
  error?: string
}

export interface FilmForCrm {
  company: string
  domain: string | null
  share: string
  role?: string | null
  recipient?: { name: string; email?: string } | null
  status?: string | null
  watched?: boolean
}

/** One line per step, as it reads on a HubSpot timeline */
export function noteFor(step: string, f: FilmForCrm): string {
  const role = f.role ? ` for the ${f.role} role` : ''
  switch (step) {
    case 'sent':
      return `Sent a 30-second coldopen film${role}: ${f.share}`
    case 'watched':
      return `Watched the coldopen film${role}: ${f.share}`
    case 'replied':
      return `Replied to the coldopen film${role}.`
    case 'interview':
      return `Interview from the coldopen film${role}.`
    case 'no_reply':
      return `No reply to the coldopen film${role}, after two follow-ups.`
    default:
      return `coldopen: ${step}`
  }
}

/** The steps a film has reached, in order */
export function stepsOf(f: FilmForCrm): string[] {
  const s = f.status
  if (!s) return []
  const out = ['sent']
  if (f.watched) out.push('watched')
  if (s === 'replied' || s === 'interview') out.push('replied')
  if (s === 'interview') out.push('interview')
  if (s === 'no_reply') out.push('no_reply')
  return out
}

/**
 * Brings HubSpot up to date for one film: the company (and the contact, once there's an email),
 * associated, and a note for each step not noted yet. Returns the new state to keep.
 */
export async function syncFilm(
  token: string,
  film: FilmForCrm,
  prev: CrmState | null,
  f: FetchFn = fetch,
): Promise<CrmState> {
  const noted = new Set(prev?.noted ?? [])
  let companyId = prev?.companyId
  let contactId = prev?.contactId
  if (!companyId && film.domain)
    companyId = await upsertCompany(token, { domain: film.domain, name: film.company }, f)
  if (!contactId && film.recipient?.email) {
    contactId = await upsertContact(
      token,
      { email: film.recipient.email, name: film.recipient.name, company: film.company },
      f,
    )
    if (companyId) await associate(token, contactId, companyId, f)
  }
  for (const step of stepsOf(film)) {
    if (noted.has(step) || (!contactId && !companyId)) continue
    await addNote(
      token,
      noteFor(step, film),
      { contactId: contactId ?? null, companyId: companyId ?? null },
      f,
    )
    noted.add(step)
  }
  return {
    ...(contactId ? { contactId } : {}),
    ...(companyId ? { companyId } : {}),
    noted: [...noted],
    syncedAt: new Date().toISOString(),
  }
}
