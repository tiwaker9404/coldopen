import { describe, expect, it } from 'vitest'
import { fetchRepos } from '../../dashboard/src/github.ts'

const repo = (o: Record<string, unknown>) => ({
  name: 'x',
  html_url: 'https://github.com/me/x',
  homepage: null,
  description: null,
  fork: false,
  archived: false,
  stargazers_count: 0,
  pushed_at: '2026-10-01T00:00:00Z',
  ...o,
})

const reply = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('picking projects from GitHub', () => {
  it('keeps your own live repos, most starred first, with their own descriptions', async () => {
    const repos = await fetchRepos(
      'me',
      reply([
        repo({
          name: 'stmtflow',
          html_url: 'https://github.com/me/stmtflow',
          description: 'Bank statements to rows',
          stargazers_count: 2,
        }),
        repo({
          name: 'coldopen',
          html_url: 'https://github.com/me/coldopen',
          homepage: 'https://coldopen.example',
          description: 'A film for every company',
          stargazers_count: 40,
        }),
        repo({ name: 'a-fork', fork: true, stargazers_count: 99 }),
        repo({ name: 'old', archived: true }),
      ]),
    )
    expect(repos.map((r) => r.name)).toEqual(['coldopen', 'stmtflow'])
    expect(repos[0]!.url).toBe('https://coldopen.example')
    expect(repos[1]!.line).toBe('Bank statements to rows')
  })

  it('says plainly when the user does not exist or GitHub is limiting', async () => {
    await expect(fetchRepos('nobody', reply({}, 404))).rejects.toThrow(
      'No GitHub user called nobody',
    )
    await expect(fetchRepos('me', reply({}, 403))).rejects.toThrow(/rate limiting/)
  })
})
