import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderDispatcher } from '../../src/api/dispatch.ts'
import type { Config } from '../../src/config.ts'
import { log } from '../helpers/index.ts'

afterEach(() => vi.unstubAllGlobals())

describe('starting the renderer on GitHub Actions', () => {
  it('starts one lane for one film, and more lanes as films pile up, up to the limit', async () => {
    const calls: { url: string; body: string; auth: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({
        url,
        body: String(init.body),
        auth: (init.headers as Record<string, string>).authorization!,
      })
      return new Response(null, { status: 204 })
    })
    let pending = 1
    const kick = renderDispatcher(
      {
        RENDER_DISPATCH_TOKEN: 'github_pat_x',
        RENDER_DISPATCH_REPO: 'me/coldopen',
        RENDER_RUNNERS: 3,
      } as Config,
      log,
      async () => pending,
    )
    const settle = () => new Promise((r) => setTimeout(r, 10))
    kick()
    await settle()
    expect(calls).toEqual([
      {
        url: 'https://api.github.com/repos/me/coldopen/dispatches',
        body: '{"event_type":"render","client_payload":{"slot":0}}',
        auth: 'Bearer github_pat_x',
      },
    ])
    // lane 0 was just started; a second film opens lane 1
    pending = 2
    kick()
    await settle()
    // a burst: never more than the limit, and no lane twice within 20 seconds
    pending = 10
    kick()
    kick()
    await settle()
    expect(calls.map((c) => JSON.parse(c.body).client_payload.slot)).toEqual([0, 1, 2])
  })

  it('does nothing when not configured', () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    renderDispatcher({} as Config, log)()
    expect(f).not.toHaveBeenCalled()
  })
})
