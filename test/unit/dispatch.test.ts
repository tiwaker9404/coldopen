import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderDispatcher } from '../../src/api/dispatch.ts'
import type { Config } from '../../src/config.ts'
import { log } from '../helpers/index.ts'

afterEach(() => vi.unstubAllGlobals())

describe('starting the renderer on GitHub Actions', () => {
  it('sends one start signal for a burst of films', async () => {
    const calls: { url: string; body: string; auth: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({
        url,
        body: String(init.body),
        auth: (init.headers as Record<string, string>).authorization!,
      })
      return new Response(null, { status: 204 })
    })
    const kick = renderDispatcher(
      { RENDER_DISPATCH_TOKEN: 'github_pat_x', RENDER_DISPATCH_REPO: 'me/coldopen' } as Config,
      log,
    )
    kick()
    kick()
    kick()
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toEqual([
      {
        url: 'https://api.github.com/repos/me/coldopen/dispatches',
        body: '{"event_type":"render"}',
        auth: 'Bearer github_pat_x',
      },
    ])
  })

  it('does nothing when not configured', () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    renderDispatcher({} as Config, log)()
    expect(f).not.toHaveBeenCalled()
  })
})
