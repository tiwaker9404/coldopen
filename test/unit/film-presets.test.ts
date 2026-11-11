import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { BrandKit } from '../../src/brand/types.ts'
import { hiringProfile, recruiterProfile, withRole } from '../../src/profile/pitch.ts'
import { buildStoryboard } from '../../src/script/storyboard.ts'
import type { Profile } from '../../src/script/types.ts'
import { buildMessages, deterministicScript } from '../../src/script/writer.ts'
import { fixtureServer, kitFor, profile } from '../helpers/index.ts'

/**
 * A job seeker's film changed voice in step 9 of "The warm message". Sellers, recruiters and
 * hiring films didn't: their built-in scripts, storyboards and model prompts are snapshotted
 * from before that change, and must stay identical, creator line set or not.
 */

afterAll(async () => {
  ;(await fixtureServer()).close()
})

const root = join(import.meta.dirname, '../..')
const JOBS: Record<string, { title: string; reqs: string[] }> = {
  northwind: {
    title: 'Forward Deployed Engineer - Platform',
    reqs: [
      'Deploy our routing agents inside customer warehouses, from first call to production',
      '3+ years shipping production software in Python or TypeScript',
    ],
  },
  lumen: {
    title: 'Senior Data Analyst, Growth',
    reqs: ['Build dashboards in SQL and Looker that teams use every week'],
  },
  parcelpine: {
    title: 'Operations Analyst',
    reqs: ['Experience building dashboards that operations teams use every day'],
  },
}

const CREATOR = {
  name: 'coldopen',
  url: 'https://tiwaker9404.github.io/coldopen/',
  line: 'Paste a company website, get a 30-second film made for them',
}

const withJob = (kit: BrandKit, site: string): BrandKit => {
  const job = JOBS[site]!
  return {
    ...kit,
    job: { title: job.title, url: `https://jobs.example/${kit.host}` },
    facts: [
      ...kit.facts,
      ...job.reqs.map((text, i) => ({ id: `j${i + 1}`, text, kind: 'requirement' as const })),
    ],
  }
}

describe('films for sellers, recruiters and hiring', () => {
  it('sales, recruiter and hiring films are unchanged', async () => {
    const all: Record<string, unknown> = {}
    for (const site of ['northwind', 'lumen', 'parcelpine'] as const) {
      const { kit: home } = await kitFor(site)
      for (const kit of [home, withJob(home, site)]) {
        const recruiter = recruiterProfile({
          candidateText: readFileSync(join(root, 'fixtures/resumes/priya-analyst.md'), 'utf8'),
          recruiter: { name: 'Hannah Brooks', company: kit.name, contact: 'hannah@example.com' },
          ...(kit.job ? { role: kit.job.title } : {}),
        })
        const hiring = withRole(
          hiringProfile({
            recruiter: { name: 'Hannah Brooks', company: kit.name },
            ...(kit.job ? { role: kit.job.title } : {}),
          }),
          kit,
          'https://jobs.example/apply',
        )
        const presets: [string, Profile][] = [
          ['sales', profile('sales')],
          ['sales, creator set', { ...profile('sales'), creator: CREATOR }],
          ['recruiter', { ...recruiter, creator: CREATOR }],
          ['hiring', { ...hiring, creator: CREATOR }],
        ]
        for (const [who, p] of presets) {
          const script = deterministicScript(kit, p)
          all[`${site} | ${kit.job ? 'job' : '-'} | ${who}`] = {
            script,
            scenes: buildStoryboard(kit, p, script).scenes,
            prompt: buildMessages(kit, p).map((m) => m.content),
          }
        }
      }
    }
    await expect(`${JSON.stringify(all, null, 2)}\n`).toMatchFileSnapshot(
      '__snapshots__/sales-recruiter-hiring-films.json',
    )
  }, 120_000)
})
