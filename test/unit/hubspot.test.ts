import { describe, expect, it } from 'vitest'
import { HubSpotError, noteFor, stepsOf, syncFilm } from '../../src/outreach/hubspot.ts'

/** A pretend HubSpot: records each call, and answers like the real API */
function fakeHubSpot(existing: { contact?: string; company?: string } = {}) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  let next = 100
  const f = async (url: string, init: RequestInit) => {
    const path = url.replace('https://api.hubapi.com', '')
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method: String(init.method), path, ...(body ? { body } : {}) })
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer pat-1')
    if (path.endsWith('/contacts/search'))
      return Response.json({ results: existing.contact ? [{ id: existing.contact }] : [] })
    if (path.endsWith('/companies/search'))
      return Response.json({ results: existing.company ? [{ id: existing.company }] : [] })
    if (init.method === 'PUT') return new Response(null, { status: 204 })
    return Response.json({ id: String(next++) })
  }
  return { f, calls }
}

const film = {
  company: 'Acme',
  domain: 'acme.com',
  share: 'https://films.example/f/1',
  role: 'Solutions Engineer',
  recipient: { name: 'Priya Shah', email: 'priya@acme.com' },
  status: 'replied',
  watched: true,
}

describe('HubSpot sync', () => {
  it('makes the company and contact, ties them, and notes each step once', async () => {
    const { f, calls } = fakeHubSpot()
    const s = await syncFilm('pat-1', film, null, f)
    expect(s).toMatchObject({
      companyId: '100',
      contactId: '101',
      noted: ['sent', 'watched', 'replied'],
    })
    const contact = calls.find((c) => c.path === '/crm/v3/objects/contacts' && c.method === 'POST')
    expect(contact?.body).toMatchObject({
      properties: {
        email: 'priya@acme.com',
        firstname: 'Priya',
        lastname: 'Shah',
        company: 'Acme',
      },
    })
    expect(
      calls.some((c) => c.path === '/crm/v4/objects/contact/101/associations/default/company/100'),
    ).toBe(true)
    const notes = calls.filter((c) => c.path === '/crm/v3/objects/notes')
    expect(notes).toHaveLength(3)
    expect(JSON.stringify(notes[0]!.body)).toContain(
      'Sent a 30-second coldopen film for the Solutions Engineer role',
    )
    // a second sync with nothing new adds nothing
    const again = fakeHubSpot()
    await syncFilm('pat-1', film, s, again.f)
    expect(again.calls).toHaveLength(0)
  })

  it('reuses what HubSpot already has, and names the problem when it refuses', async () => {
    const { f, calls } = fakeHubSpot({ contact: '7', company: '8' })
    const s = await syncFilm('pat-1', { ...film, status: 'sent', watched: false }, null, f)
    expect(s).toMatchObject({ contactId: '7', companyId: '8', noted: ['sent'] })
    expect(calls.some((c) => c.method === 'PATCH' && c.path === '/crm/v3/objects/contacts/7')).toBe(
      true,
    )
    const refused = async () => new Response('{}', { status: 403 })
    await expect(syncFilm('pat-1', film, null, refused)).rejects.toThrow(HubSpotError)
    await expect(syncFilm('pat-1', film, null, refused)).rejects.toThrow(/scope/)
  })

  it('reads the steps a film reached', () => {
    expect(stepsOf({ ...film, status: 'interview', watched: false })).toEqual([
      'sent',
      'replied',
      'interview',
    ])
    expect(stepsOf({ ...film, status: null })).toEqual([])
    expect(noteFor('no_reply', film)).toContain('No reply')
  })
})
