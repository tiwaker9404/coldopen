import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { Sql } from '../db/index.ts'

/**
 * Keys people give coldopen for their own accounts on other services (today: Hunter), kept
 * encrypted at rest (AES-256-GCM, keyed from the server's secret) and never sent back whole:
 * the app only ever shows the last four characters.
 */

const keyFrom = (secret: string) => createHash('sha256').update(`coldopen:keys:${secret}`).digest()

export function seal(secret: string, plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.')
}

export function open(secret: string, sealed: string): string | null {
  try {
    const [iv, tag, body] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'))
    const d = createDecipheriv('aes-256-gcm', keyFrom(secret), iv!)
    d.setAuthTag(tag!)
    return Buffer.concat([d.update(body!), d.final()]).toString('utf8')
  } catch {
    // the server's secret changed: the key has to be entered again
    return null
  }
}

export type KeyName = 'hunter'

export async function saveKey(sql: Sql, secret: string, owner: string, name: KeyName, key: string) {
  await sql`
    insert into owner_keys (owner, name, value, last4) values (${owner}, ${name}, ${seal(secret, key)}, ${key.slice(-4)})
    on conflict (owner, name) do update set value = excluded.value, last4 = excluded.last4, updated_at = now()`
}

export async function readKey(sql: Sql, secret: string, owner: string, name: KeyName) {
  const [r] = await sql<{ value: string }[]>`
    select value from owner_keys where owner = ${owner} and name = ${name}`
  return r ? open(secret, r.value) : null
}

export async function listKeys(sql: Sql, owner: string) {
  const rows = await sql<{ name: KeyName; last4: string; updatedAt: Date }[]>`
    select name, last4, updated_at from owner_keys where owner = ${owner}`
  return Object.fromEntries(rows.map((r) => [r.name, { last4: r.last4, updatedAt: r.updatedAt }]))
}

export async function deleteKey(sql: Sql, owner: string, name: KeyName) {
  const rows =
    await sql`delete from owner_keys where owner = ${owner} and name = ${name} returning name`
  return rows.length > 0
}
