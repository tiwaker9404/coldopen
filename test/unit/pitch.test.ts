import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { BrandKit } from '../../src/brand/types.ts'
import { withJob } from '../../src/job/kit.ts'
import { jobFromText } from '../../src/job/post.ts'
import { draftMessages } from '../../src/outreach/messages.ts'
import { hiringProfile, PitchError, recruiterProfile, withRole } from '../../src/profile/pitch.ts'
import { checkScript } from '../../src/script/checks.ts'
import { buildStoryboard } from '../../src/script/storyboard.ts'
import { deterministicScript } from '../../src/script/writer.ts'
import { type ShareView, sharePage } from '../../src/share/page.ts'

const RESUME = readFileSync(
  join(import.meta.dirname, '../../fixtures/resumes/priya-analyst.md'),
  'utf8',
)

const POSTED = `Senior Data Analyst
Northwind Freight is hiring.

What we're looking for:
• Build demand forecasting models in Python for our largest shippers
• Write SQL pipelines in Snowflake that consolidate regional data
• Turn dashboards into decisions with operations leaders
`

const base: BrandKit = {
  url: 'https://northwindfreight.example/',
  host: 'northwindfreight.example',
  name: 'Northwind Freight',
  title: 'Northwind Freight',
  description: 'Freight for retailers',
  headline: 'Freight that shows up',
  subheads: [],
  nav: [],
  facts: [
    { id: 'f1', text: 'Freight that shows up', kind: 'headline' },
    { id: 'f2', text: '2.4 million pallets moved a year', kind: 'stat' },
  ],
  colors: {
    background: '#ffffff',
    text: '#111111',
    primary: '#c6f432',
    accent: '#c6f432',
    dark: '#111111',
    swatches: [],
  },
  fonts: {
    display: { family: 'Inter', category: 'sans', weight: 700, faces: [] },
    body: { family: 'Inter', category: 'sans', weight: 400, faces: [] },
  },
  logo: null,
  screenshot: { file: 'site.jpg', width: 1440, height: 900, headlineBox: null },
  extractedAt: '2026-11-03T00:00:00Z',
}

const recruiter = {
  name: 'Sam Lee',
  company: 'Northwind Freight',
  contact: 'sam@northwind.example',
}

describe('Pitch a role', () => {
  const profile = recruiterProfile({ candidateText: RESUME, recruiter })
  const kit = withJob(base, jobFromText(POSTED))

  it("drafts the recruiter's profile from the candidate's own numbers", () => {
    expect(profile.preset).toBe('recruiter')
    expect(profile.recipient?.name).toBe('Priya Shah')
    expect(profile.sender).toMatchObject({ name: 'Sam Lee', company: 'Northwind Freight' })
    // every proof number is in the résumé
    for (const p of profile.proof) expect(RESUME).toContain(p.value.replace(/\s.*/, ''))
  })

  it('refuses text with no results to show, and a profile with no name', () => {
    expect(() =>
      recruiterProfile({ candidateText: 'Great communicator. '.repeat(10), recruiter }),
    ).toThrow(PitchError)
    expect(() =>
      recruiterProfile({ candidateText: `• Cut costs by 18% at Acme\n`.repeat(5), recruiter }),
    ).toThrow(/name/)
  })

  it('writes a clean script that speaks to the candidate', () => {
    const script = deterministicScript(kit, profile)
    expect(checkScript(script, kit, profile)).toEqual([])
    expect(script.hook).toBe('Hi Priya, from Northwind Freight')
    expect(script.insight.why).toMatch(/^You (did this|have done this)|^Your closest match/)
    expect(script.pitch.headline).toBe('Why you fit our Senior Data Analyst role')
  })

  it('names the candidate on the film and signs it from the recruiter', () => {
    const board = buildStoryboard(kit, profile, deterministicScript(kit, profile))
    expect(board.recipient).toBe('Priya Shah')
    const hook = board.scenes[0]!
    expect(hook.kind === 'hook' && hook.sub).toBe('About our Senior Data Analyst role')
    const proof = board.scenes.find((s) => s.kind === 'proof')
    expect(proof?.kind === 'proof' && proof.heading).toBe('What caught our eye')
    const cta = board.scenes.at(-1)!
    expect(cta.kind === 'cta' && cta.signoff).toBe(
      'Made for Priya Shah by Sam Lee at Northwind Freight',
    )
  })

  it("writes the recruiter's messages, addressed to the candidate, with a short InMail", () => {
    const script = deterministicScript(kit, profile)
    const m = draftMessages(
      {
        company: kit.name,
        job: { title: 'Senior Data Analyst' },
        script,
        highlights: {
          quote: { text: 'x', source: 'post' },
          proof: script.proof.map((i) => profile.proof[i]!),
        },
      },
      profile,
      'https://films.example/f/abc',
    )
    expect(m.email.body).toMatch(/^Hi Priya,/)
    expect(m.email.body).toContain("I'm Sam, a recruiter at Northwind Freight")
    expect(m.linkedin.length).toBeLessThanOrEqual(400)
    expect(m.linkedin).toContain('https://films.example/f/abc')
    expect(m.forward).toBeUndefined()
  })
})

describe('share pages speak to the other side', () => {
  const view: ShareView = {
    company: 'Northwind Freight',
    format: 'square',
    from: 'Ashwin Tiwari',
    firstName: 'Ashwin',
    ctaLine: 'Could we talk?',
    contact: 'a@example.com',
    film: 'film-square.mp4',
  }
  const app = 'https://coldopen.example'

  it("a job seeker's film invites the recruiter watching it", () => {
    const html = sharePage({ ...view, kind: 'candidate' }, 'https://f.example/f/1', undefined, app)
    expect(html).toContain('Hiring? Pitch your roles to candidates the same way.')
    expect(html).toContain('ref=share-recruiter#pitch')
  })

  it("a recruiter's film invites the candidate watching it, and names them", () => {
    const html = sharePage(
      { ...view, kind: 'recruiter', recipient: 'Priya Shah', from: 'Sam Lee at Northwind Freight' },
      'https://f.example/f/2',
      undefined,
      app,
    )
    expect(html).toContain('Job hunting?')
    expect(html).toContain('<b>Priya Shah</b>')
    expect(html).toContain('made this film for you, about a role at Northwind Freight')
  })
})

describe('referral kit', () => {
  it('puts a ready-to-forward note inside the intro, about the sender in the third person', () => {
    const candidate = recruiterProfile({ candidateText: RESUME, recruiter })
    const me = {
      ...candidate,
      preset: 'candidate' as const,
      sender: { name: 'Priya Shah' },
      recipient: undefined,
      cta: { line: 'Could we talk?', contact: 'priya@example.com' },
    }
    const m = draftMessages(
      {
        company: 'Northwind Freight',
        job: { title: 'Senior Data Analyst' },
        script: null as never,
        highlights: { quote: { text: 'x', source: 'post' }, proof: me.proof.slice(0, 2) },
      },
      me,
      'https://films.example/f/xyz',
    )
    expect(m.forward).toContain('Priya Shah is interested in our Senior Data Analyst role')
    expect(m.forward).toContain('Reach Priya at priya@example.com')
    expect(m.intro).toContain(m.forward!)
    expect(m.intro).not.toContain('[forward]')
  })
})

describe('a hiring film, for everyone', () => {
  const kit = withJob(
    {
      ...base,
      facts: [
        ...base.facts,
        { id: 'f3', text: '38% fewer late deliveries for our shippers', kind: 'stat' },
      ],
    },
    jobFromText(POSTED),
  )
  const profile = withRole(
    hiringProfile({ recruiter: { name: 'Sam Lee', company: 'Northwind Freight' } }),
    kit,
    'https://jobs.ashbyhq.com/northwind/123',
  )

  it("takes the post's own lines and the site's own numbers", () => {
    expect(profile.points.every((p) => POSTED.includes(p))).toBe(true)
    expect(profile.proof.map((p) => p.value)).toEqual(['2.4 million', '38%'])
    expect(profile.cta.book).toBe('https://jobs.ashbyhq.com/northwind/123')
  })

  it('writes a clean script that announces the role', () => {
    const script = deterministicScript(kit, profile)
    expect(checkScript(script, kit, profile)).toEqual([])
    expect(script.hook).toBe('Northwind Freight is hiring')
    const board = buildStoryboard(kit, profile, script)
    const hook = board.scenes[0]!
    expect(hook.kind === 'hook' && hook.sub).toBe('Now hiring: Senior Data Analyst')
    expect(
      board.scenes.at(-1)!.kind === 'cta' && (board.scenes.at(-1) as { signoff: string }).signoff,
    ).toBe('Posted by Sam Lee at Northwind Freight')
  })

  it('comes with a LinkedIn post to paste', () => {
    const script = deterministicScript(kit, profile)
    const m = draftMessages(
      {
        company: kit.name,
        job: { title: 'Senior Data Analyst' },
        script,
        highlights: {
          quote: { text: '38% fewer late deliveries for our shippers', source: kit.host },
          proof: [],
        },
      },
      profile,
      'https://films.example/f/h1',
    )
    expect(m.post).toContain("We're hiring: Senior Data Analyst at Northwind Freight.")
    expect(m.post).toContain('Apply: https://jobs.ashbyhq.com/northwind/123')
    expect(m.post).toContain('https://films.example/f/h1')
  })
})
