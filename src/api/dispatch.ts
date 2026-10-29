import type { Config } from '../config.ts'
import type { Logger } from '../logger.ts'

/**
 * Starts a renderer on demand. The hosted app's web server is small (no Chromium), so each
 * new film asks GitHub Actions to run `node src/main.ts drain`, which renders everything
 * queued and exits. Several films in a row share one run: requests within 20 seconds of the
 * last one are dropped, and the job itself drains the whole queue.
 */
export function renderDispatcher(cfg: Config, log: Logger) {
  const token = cfg.RENDER_DISPATCH_TOKEN
  const repo = cfg.RENDER_DISPATCH_REPO
  if (!token || !repo) return () => {}
  let last = 0
  return () => {
    if (Date.now() - last < 20_000) return
    last = Date.now()
    fetch(`https://api.github.com/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'coldopen',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ event_type: 'render' }),
      signal: AbortSignal.timeout(10_000),
    })
      .then(async (r) => {
        if (!r.ok) {
          last = 0
          log.warn(
            { status: r.status, body: (await r.text()).slice(0, 200) },
            'render dispatch refused',
          )
        }
      })
      .catch((err) => {
        last = 0
        log.warn({ err }, 'render dispatch failed')
      })
  }
}
