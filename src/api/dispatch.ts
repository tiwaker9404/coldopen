import type { Config } from '../config.ts'
import type { Logger } from '../logger.ts'

/**
 * Starts renderers on demand. The hosted app's web server is small (no Chromium), so films are
 * rendered by GitHub Actions jobs running `node src/main.ts drain`, which render whatever is
 * queued and exit.
 *
 * Each job runs in a lane (client_payload.slot), and the workflow keeps one job per lane. On
 * each new film the app counts what's waiting and starts up to RENDER_RUNNERS lanes, one per
 * film, so a burst of films renders side by side instead of in a line. The queue already makes
 * sure two jobs never take the same film. A lane asked again within 20 seconds is skipped.
 */
export function renderDispatcher(
  cfg: Config,
  log: Logger,
  /** films queued or rendering right now */
  pending: () => Promise<number> = async () => 1,
) {
  const token = cfg.RENDER_DISPATCH_TOKEN
  const repo = cfg.RENDER_DISPATCH_REPO
  if (!token || !repo) return () => {}
  const last = new Map<number, number>()

  const start = (slot: number) => {
    last.set(slot, Date.now())
    fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'coldopen',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ event_type: 'render', client_payload: { slot } }),
      signal: AbortSignal.timeout(10_000),
    })
      .then(async (r) => {
        if (!r.ok) {
          last.delete(slot)
          log.warn(
            { status: r.status, body: (await r.text()).slice(0, 200) },
            'render dispatch refused',
          )
        }
      })
      .catch((err) => {
        last.delete(slot)
        log.warn({ err }, 'render dispatch failed')
      })
  }

  return () => {
    void pending()
      .catch(() => 1)
      .then((n) => {
        const lanes = Math.max(1, Math.min(cfg.RENDER_RUNNERS, n))
        for (let slot = 0; slot < lanes; slot++)
          if (Date.now() - (last.get(slot) ?? 0) >= 20_000) start(slot)
      })
  }
}
