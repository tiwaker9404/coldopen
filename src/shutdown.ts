/**
 * Stopping the process on SIGTERM: each step in turn, with a hard deadline over all of them.
 *
 * On 13 Nov the hosted app logged "shutting down" and then kept running for 14 hours, serving
 * nothing: one step never settled (closing the server, which waits for every open request),
 * so the process never reached exit. The deadline is unref'd, so it never keeps a finished
 * process alive, and it names the step that hung.
 */

export interface StopStep {
  name: string
  stop: () => Promise<unknown>
}

interface Log {
  info(obj: object, msg: string): void
  error(obj: object, msg: string): void
}

export const SHUTDOWN_DEADLINE_MS = 10_000

export async function stopAll(
  steps: StopStep[],
  opts: { log: Log; exit: (code: number) => void; deadlineMs?: number },
): Promise<void> {
  let current = 'starting'
  const deadline = setTimeout(() => {
    opts.log.error({ hung: current }, `shutdown hung on "${current}"; exiting anyway`)
    opts.exit(1)
  }, opts.deadlineMs ?? SHUTDOWN_DEADLINE_MS)
  deadline.unref()
  for (const step of steps) {
    current = step.name
    await step
      .stop()
      .catch((err) => opts.log.error({ err, step: step.name }, 'shutdown step failed'))
  }
  clearTimeout(deadline)
  opts.exit(0)
}

/** how long open requests get to finish once the server stops taking new ones */
export const CLOSE_GRACE_MS = 3_000

/**
 * Closes an HTTP server (Fastify's close waits for every open request), cutting whatever is
 * still open after a short grace: a request stuck on a slow service mustn't hold the process.
 */
export async function closeServer(
  app: { close(): Promise<unknown>; server: { closeAllConnections(): void } },
  graceMs = CLOSE_GRACE_MS,
): Promise<void> {
  const cut = setTimeout(() => app.server.closeAllConnections(), graceMs)
  cut.unref()
  try {
    await app.close()
  } finally {
    clearTimeout(cut)
  }
}
