/**
 * Customs (https://github.com/tiwaker9404/customs): an optional checkpoint in front of the one write coldopen
 * makes with someone's personal data, the contact it adds to the sender's HubSpot. Before the write,
 * Customs checks it (the address belongs to the company, the fields are valid, it isn't a second record for
 * the same person, the person hasn't asked not to be contacted); the contact is written only if it clears,
 * and Customs is told afterwards, so it can check what was written is what cleared.
 *
 * Off unless CUSTOMS_API_KEY is set. When it's on and Customs can't be reached, the contact isn't written
 * (the sync tries again on the next change), as with any checkpoint that fails closed.
 */

import type { FetchFn } from './hubspot.ts'

export interface Customs {
  url: string
  key: string
  /** the name this install is registered under in the Customs workspace's rules */
  agent: string
}

export interface ContactWrite {
  email: string
  name?: string | undefined
  company: string
  domain: string | null
  title?: string | undefined
}

export type Ruling =
  | { cleared: true; actionId: string }
  | { cleared: false; decision: 'amend' | 'hold' | 'deny' | 'unreachable'; reason: string }

/** Customs from the environment, or null when it's off */
export function customsFrom(env: {
  CUSTOMS_API_KEY?: string | undefined
  CUSTOMS_URL?: string | undefined
  CUSTOMS_AGENT?: string | undefined
}): Customs | null {
  if (!env.CUSTOMS_API_KEY) return null
  return {
    key: env.CUSTOMS_API_KEY,
    url: (env.CUSTOMS_URL ?? 'https://customs-api-wuy4.onrender.com').replace(/\/$/, ''),
    agent: env.CUSTOMS_AGENT ?? 'coldopen',
  }
}

const recipientOf = (c: ContactWrite) => ({
  email: c.email,
  ...(c.name ? { name: c.name } : {}),
  company: c.company,
  ...(c.domain ? { company_domain: c.domain } : {}),
})

const fieldsOf = (c: ContactWrite) => ({
  ...(c.name ? { name: c.name } : {}),
  ...(c.title ? { title: c.title } : {}),
})

async function post(cx: Customs, path: string, body: unknown, f: FetchFn): Promise<Response> {
  return f(`${cx.url}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${cx.key}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
}

/** Asks Customs whether this contact may be written to HubSpot */
export async function checkContactWrite(
  cx: Customs,
  c: ContactWrite,
  f: FetchFn = fetch,
): Promise<Ruling> {
  const actionId = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  let res: Response
  try {
    res = await post(
      cx,
      '/v1/inspect',
      {
        id: actionId,
        tool: 'crm_upsert',
        agent_id: cx.agent,
        purpose: 'job_outreach',
        recipient: recipientOf(c),
        args: { fields: fieldsOf(c) },
        // the sender typed who the film goes to
        provenance: { to: 'user' },
      },
      f,
    )
  } catch {
    return { cleared: false, decision: 'unreachable', reason: "Customs couldn't be reached" }
  }
  if (!res.ok)
    return {
      cleared: false,
      decision: 'unreachable',
      reason: `Customs answered HTTP ${res.status}`,
    }
  const v = (await res.json()) as {
    decision: 'clear' | 'amend' | 'hold' | 'deny'
    findings?: { decision: string; reason: string }[]
  }
  if (v.decision === 'clear') return { cleared: true, actionId }
  const reason =
    (v.findings ?? [])
      .filter((x) => x.decision !== 'clear')
      .map((x) => x.reason)
      .join('; ') || v.decision
  return { cleared: false, decision: v.decision, reason }
}

/** Tells Customs the contact was written (or that the write failed). Never throws. */
export async function reportContactWrite(
  cx: Customs,
  actionId: string,
  c: ContactWrite,
  ok: boolean,
  f: FetchFn = fetch,
): Promise<void> {
  try {
    await post(
      cx,
      `/v1/actions/${actionId}/done`,
      {
        ok,
        executed: { recipient_email: c.email },
        recipient: recipientOf(c),
        args: { fields: fieldsOf(c) },
      },
      f,
    )
  } catch {
    // the write happened either way; Customs flags a cleared action that was never reported
  }
}
