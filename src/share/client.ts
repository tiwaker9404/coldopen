import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Storyboard } from '../script/storyboard.ts'
import { type ShareView, viewFromStoryboard } from './page.ts'
import type { ViewRow, ViewSummary } from './views.ts'

/**
 * Talks to a share worker (share/worker.ts on Cloudflare) from the CLI: uploads finished film
 * folders, and reads back who watched them.
 */
export interface ShareConfig {
  /** the worker's URL, e.g. https://coldopen-share.you.workers.dev */
  url: string
  token: string
}

export function shareConfig(env: NodeJS.ProcessEnv = process.env): ShareConfig {
  const url = env.SHARE_URL?.replace(/\/$/, '')
  const token = env.SHARE_TOKEN
  if (!url || !token)
    throw new Error(
      'set SHARE_URL and SHARE_TOKEN first. Run `pnpm share:setup` once to create your free share links on Cloudflare; see docs/SHARING.md',
    )
  return { url, token }
}

/** What a shared folder remembers, so sharing it again updates the same link. */
export interface ShareRecord {
  id: string
  link: string
  company: string
  sharedAt: string
}

const SHARE_FILE = 'share.json'

/** A film folder made by the CLI has a storyboard and an encoded film. */
export function isFilmFolder(dir: string): boolean {
  return (
    existsSync(join(dir, 'storyboard.json')) &&
    readdirSync(dir).some((f) => /^film-(square|landscape|portrait)\.mp4$/.test(f))
  )
}

/** One film folder, or every film folder inside a folder (e.g. ./films). */
export function findFilmFolders(path: string): string[] {
  if (!existsSync(path) || !statSync(path).isDirectory()) return []
  if (isFilmFolder(path)) return [path]
  return readdirSync(path)
    .filter((f) => !f.startsWith('.'))
    .map((f) => join(path, f))
    .filter((d) => statSync(d).isDirectory() && isFilmFolder(d))
    .sort()
}

export async function readShareRecord(dir: string): Promise<ShareRecord | null> {
  try {
    return JSON.parse(await readFile(join(dir, SHARE_FILE), 'utf8')) as ShareRecord
  } catch {
    return null
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'film'

/** Readable but unguessable: "deel-7q2k9xgm". Links can't be found by trying company names. */
export function newShareId(company: string): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const tail = [...randomBytes(8)].map((b) => alphabet[b % alphabet.length]).join('')
  return `${slug(company)}-${tail}`
}

async function call<T>(
  cfg: ShareConfig,
  method: string,
  path: string,
  body?: BodyInit,
  type?: string,
) {
  const res = await fetch(`${cfg.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      ...(type ? { 'content-type': type } : {}),
    },
    ...(body !== undefined ? { body } : {}),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? text
    } catch {}
    throw new Error(`share worker ${method} ${path}: ${res.status} ${msg}`.trim())
  }
  return (text ? JSON.parse(text) : {}) as T
}

/** Uploads a film folder and returns its link. Sharing a folder again keeps its link. */
export async function shareFolder(dir: string, cfg: ShareConfig): Promise<ShareRecord> {
  const board = JSON.parse(await readFile(join(dir, 'storyboard.json'), 'utf8')) as {
    board: Storyboard
  }
  const film = readdirSync(dir).find((f) => /^film-(square|landscape|portrait)\.mp4$/.test(f))!
  const view: ShareView = viewFromStoryboard(board.board, film)
  const prev = await readShareRecord(dir)
  const id = prev?.id ?? newShareId(view.company)

  await call(cfg, 'PUT', `/api/films/${id}`, JSON.stringify(view), 'application/json')
  for (const [name, type] of [
    [film, 'video/mp4'],
    ['poster.jpg', 'image/jpeg'],
    ['preview.gif', 'image/gif'],
  ] as const) {
    const file = join(dir, name)
    if (!existsSync(file)) continue
    await call(cfg, 'PUT', `/api/films/${id}/${name}`, new Uint8Array(await readFile(file)), type)
  }
  const rec: ShareRecord = {
    id,
    link: `${cfg.url}/f/${id}`,
    company: view.company,
    sharedAt: new Date().toISOString(),
  }
  await writeFile(join(dir, SHARE_FILE), `${JSON.stringify(rec, null, 2)}\n`)
  return rec
}

export async function allViews(cfg: ShareConfig) {
  return call<{ films: { id: string; link: string; views: ViewSummary }[] }>(
    cfg,
    'GET',
    '/api/views',
  )
}

export async function oneFilmViews(cfg: ShareConfig, id: string) {
  return call<{ summary: ViewSummary; sessions: ViewRow[] }>(cfg, 'GET', `/api/films/${id}/views`)
}

export async function unshare(cfg: ShareConfig, id: string) {
  return call(cfg, 'DELETE', `/api/films/${id}`)
}
