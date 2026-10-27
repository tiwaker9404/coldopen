import { createHmac, timingSafeEqual } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename } from 'node:path'

/**
 * Slack: mention the app with a URL in any channel, and the finished film is posted back
 * into that thread. Requests from Slack are verified with the signing secret.
 */

export function verifySlackSignature(opts: {
  signingSecret: string
  timestamp: string | undefined
  signature: string | undefined
  rawBody: string
  now?: number
}): boolean {
  const { timestamp, signature } = opts
  if (!timestamp || !signature) return false
  const ts = Number(timestamp)
  const now = Math.floor((opts.now ?? Date.now()) / 1000)
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 60 * 5) return false // replay protection
  const expected = `v0=${createHmac('sha256', opts.signingSecret).update(`v0:${timestamp}:${opts.rawBody}`).digest('hex')}`
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Slack formats links as <https://acme.com|acme.com>; plain text is accepted too. */
export function urlFromMention(text: string): string | null {
  const link = text.match(/<(https?:\/\/[^|>\s]+)(?:\|[^>]*)?>/)
  if (link) return link[1]!
  const bare = text.match(/\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/i)
  if (!bare) return null
  return /^https?:\/\//.test(bare[1]!) ? bare[1]! : `https://${bare[1]}`
}

export class SlackError extends Error {}

export class SlackClient {
  readonly #token: string
  readonly #base: string
  constructor(token: string, baseUrl = process.env.SLACK_API_URL ?? 'https://slack.com/api') {
    this.#token = token
    this.#base = baseUrl.replace(/\/$/, '')
  }

  async #call<T>(method: string, body: Record<string, unknown>, form = false): Promise<T> {
    const res = await fetch(`${this.#base}/${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#token}`,
        'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json; charset=utf-8',
      },
      body: form
        ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)]))
        : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    const data = (await res.json()) as { ok: boolean; error?: string } & T
    if (!data.ok) throw new SlackError(`slack ${method}: ${data.error ?? res.status}`)
    return data
  }

  postMessage(channel: string, text: string, threadTs?: string) {
    return this.#call<{ ts: string }>('chat.postMessage', {
      channel,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
      unfurl_links: false,
    })
  }

  /** files.uploadV2 flow: reserve an upload URL, send the bytes, then share into the thread. */
  async uploadFile(opts: { channel: string; threadTs?: string; file: string; title: string; comment?: string }) {
    const size = (await stat(opts.file)).size
    const filename = basename(opts.file)
    const reserved = await this.#call<{ upload_url: string; file_id: string }>(
      'files.getUploadURLExternal',
      { filename, length: size },
      true,
    )
    const put = await fetch(reserved.upload_url, {
      method: 'POST',
      body: await readFile(opts.file),
      signal: AbortSignal.timeout(120_000),
    })
    if (!put.ok) throw new SlackError(`slack upload failed: HTTP ${put.status}`)
    await this.#call('files.completeUploadExternal', {
      files: [{ id: reserved.file_id, title: opts.title }],
      channel_id: opts.channel,
      ...(opts.threadTs ? { thread_ts: opts.threadTs } : {}),
      ...(opts.comment ? { initial_comment: opts.comment } : {}),
    })
    return { fileId: reserved.file_id }
  }
}
