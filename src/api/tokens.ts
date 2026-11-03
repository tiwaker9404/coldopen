import { createHash, randomBytes } from 'node:crypto'
import type { Sql } from '../db/index.ts'

/**
 * Personal access tokens: what an MCP client (Claude, Cursor) or a script sends to act as one
 * signed-in person. Shown once when made; only a hash is stored.
 */

export const TOKEN_PREFIX = 'co_'
const hash = (token: string) => createHash('sha256').update(token).digest('base64url')

export async function makeToken(
  sql: Sql,
  owner: string,
  name: string,
): Promise<{ id: string; token: string; name: string }> {
  const token = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`
  const id = randomBytes(6).toString('hex')
  await sql`insert into user_tokens (id, owner, digest, name) values (${id}, ${owner}, ${hash(token)}, ${name})`
  return { id, token, name }
}

/** The owner a token acts as, or null; notes when it was last used */
export async function tokenOwner(sql: Sql, token: string): Promise<string | null> {
  if (!token.startsWith(TOKEN_PREFIX) || token.length < 20) return null
  const [row] = await sql<{ owner: string }[]>`
    update user_tokens set last_used_at = now() where digest = ${hash(token)} returning owner`
  return row?.owner ?? null
}

export async function listTokens(sql: Sql, owner: string) {
  return sql<{ id: string; name: string; createdAt: Date; lastUsedAt: Date | null }[]>`
    select id, name, created_at, last_used_at from user_tokens where owner = ${owner} order by created_at desc`
}

export async function deleteToken(sql: Sql, owner: string, id: string): Promise<boolean> {
  const rows = await sql`delete from user_tokens where owner = ${owner} and id = ${id} returning id`
  return rows.length > 0
}
