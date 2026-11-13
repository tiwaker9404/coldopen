import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { EMBED_BATCH, type Embedder, semanticFit } from '../../src/job/semantic.ts'
import { eventLoopDelayP99, registry, watchEventLoop } from '../../src/metrics.ts'
import { closeServer, stopAll } from '../../src/shutdown.ts'
import { inSlices } from '../../src/slices.ts'

/**
 * The hosted app keeps answering on 0.1 CPU: long loops give the event loop a turn, a stuck
 * shutdown step can't keep a dead process alive, and a held loop is measured and logged.
 */

const quietLog = () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() })

describe('long loops on a slow CPU', () => {
  it('lets other work in once a slice has run its time, not before', async () => {
    let t = 0
    const seen: (number | string)[] = []
    setImmediate(() => seen.push('other work'))
    // a fake clock: every item "takes" 30 ms, so a 50 ms slice yields after every second item
    await inSlices(
      [1, 2, 3, 4],
      (x) => {
        seen.push(x)
        t += 30
      },
      50,
      () => t,
    )
    expect(seen).toEqual([1, 2, 'other work', 3, 4])
  })

  it('embeds a few texts per model call, giving the loop a turn between calls', async () => {
    const calls: number[] = []
    const embedder: Embedder = {
      model: 'fake',
      async embed(texts) {
        calls.push(texts.length)
        return texts.map(() => new Float32Array([1, 0]))
      },
    }
    const sem = semanticFit(embedder, 0.5)
    await sem.closeness(
      ['a'],
      Array.from({ length: 10 }, (_, i) => `text ${i}`),
    )
    expect(Math.max(...calls)).toBeLessThanOrEqual(EMBED_BATCH)
    expect(calls.reduce((a, b) => a + b, 0)).toBe(11)
  })
})

describe('shutting down', () => {
  it('stops each step in turn, then exits 0', async () => {
    const order: string[] = []
    const exit = vi.fn()
    await stopAll(
      [
        { name: 'http server', stop: async () => void order.push('http') },
        { name: 'database', stop: async () => void order.push('db') },
      ],
      { log: quietLog(), exit },
    )
    expect(order).toEqual(['http', 'db'])
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits 1 after the deadline when a step never settles, naming the step', async () => {
    const log = quietLog()
    const exit = vi.fn()
    const later = vi.fn()
    void stopAll(
      [
        { name: 'http server', stop: () => new Promise(() => {}) },
        { name: 'database', stop: async () => later() },
      ],
      { log, exit, deadlineMs: 50 },
    )
    await sleep(120)
    expect(exit).toHaveBeenCalledWith(1)
    expect(later).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith(
      { hung: 'http server' },
      'shutdown hung on "http server"; exiting anyway',
    )
  })

  it('keeps going when a step fails, and logs it', async () => {
    const log = quietLog()
    const exit = vi.fn()
    await stopAll(
      [
        { name: 'browser', stop: () => Promise.reject(new Error('gone')) },
        { name: 'database', stop: async () => {} },
      ],
      { log, exit },
    )
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'browser' }),
      'shutdown step failed',
    )
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('cuts open connections after the grace when closing the server waits on them', async () => {
    let release: () => void = () => {}
    const app = {
      close: () => new Promise<void>((r) => (release = r)),
      server: { closeAllConnections: vi.fn(() => release()) },
    }
    await closeServer(app, 20)
    expect(app.server.closeAllConnections).toHaveBeenCalledOnce()
  })
})

describe('a blocked event loop', () => {
  it('is logged with the routes in flight, and reported as a p99 in milliseconds', async () => {
    const log = quietLog()
    const stop = watchEventLoop({
      log,
      inFlight: () => ['GET /v1/targets'],
      warnMs: 100,
      windowMs: 400,
    })
    await sleep(300)
    const until = Date.now() + 350
    while (Date.now() < until) {} // hold the loop
    // the window the block fell in is reported when it closes
    let worst = 0
    for (let i = 0; i < 20; i++) {
      await sleep(50)
      worst = Math.max(worst, (await eventLoopDelayP99.get()).values[0]?.value ?? 0)
    }
    stop()
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ routes: ['GET /v1/targets'] }),
      'event loop was blocked',
    )
    const [warned] = log.warn.mock.calls[0] as [{ delayMs: number }]
    expect(warned.delayMs).toBeGreaterThan(100)
    expect(worst).toBeGreaterThan(100)
    expect(await registry.metrics()).toContain('coldopen_event_loop_delay_p99_ms')
  })
})
