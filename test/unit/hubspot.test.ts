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

/** A pretend Customs beside the pretend HubSpot: answers inspect with `decision`, records reports */
function withCustoms(decision: 'clear' | 'hold' | 'down', hub = fakeHubSpot()) {
  const reports: unknown[] = []
  const inspected: unknown[] = []
  const f = async (url: string, init: RequestInit) => {
    if (new URL(url).hostname !== 'customs.test') return hub.f(url, init)
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer cus_test')
    if (decision === 'down') throw new TypeError('fetch failed')
    const body = JSON.parse(String(init.body))
    if (url.endsWith('/v1/inspect')) {
      inspected.push(body)
      return Response.json(
        decision === 'clear'
          ? { decision: 'clear', findings: [] }
          : {
              decision: 'hold',
              findings: [
                { decision: 'hold', reason: 'this would create a duplicate: p.shah@acme.com' },
              ],
            },
      )
    }
    reports.push(body)
    return Response.json({ ok: true })
  }
  return { f, calls: hub.calls, reports, inspected }
}

const cx = { url: 'https://customs.test', key: 'cus_test', agent: 'coldopen' }

describe('HubSpot sync behind Customs', () => {
  it('writes the contact once Customs clears it, then reports the write', async () => {
    const { f, calls, reports, inspected } = withCustoms('clear')
    const s = await syncFilm('pat-1', film, null, f, cx)
    expect(s.contactId).toBe('101')
    expect(s.error).toBeUndefined()
    expect(inspected[0]).toMatchObject({
      tool: 'crm_upsert',
      agent_id: 'coldopen',
      recipient: { email: 'priya@acme.com', company_domain: 'acme.com' },
    })
    expect(reports[0]).toMatchObject({ ok: true, executed: { recipient_email: 'priya@acme.com' } })
    expect(calls.some((c) => c.path === '/crm/v3/objects/contacts')).toBe(true)
  })

  it("doesn't write a contact Customs holds, says why, and still syncs the company", async () => {
    const { f, calls, reports } = withCustoms('hold')
    const s = await syncFilm('pat-1', film, null, f, cx)
    expect(s.contactId).toBeUndefined()
    expect(s.companyId).toBe('100')
    expect(s.error).toContain('Customs held the contact')
    expect(s.error).toContain('duplicate')
    expect(calls.some((c) => c.path.startsWith('/crm/v3/objects/contacts'))).toBe(false)
    expect(reports).toEqual([])
  })

  it("doesn't write the contact when Customs can't be reached, and doesn't throw", async () => {
    const { f, calls } = withCustoms('down')
    const s = await syncFilm('pat-1', film, null, f, cx)
    expect(s.contactId).toBeUndefined()
    expect(s.error).toContain('try again on the next change')
    expect(calls.some((c) => c.path.startsWith('/crm/v3/objects/contacts'))).toBe(false)
  })

  it('is off without a key', async () => {
    const { customsFrom } = await import('../../src/outreach/customs.ts')
    expect(customsFrom({})).toBeNull()
    expect(customsFrom({ CUSTOMS_API_KEY: 'cus_x' })).toMatchObject({ agent: 'coldopen' })
  })
})
