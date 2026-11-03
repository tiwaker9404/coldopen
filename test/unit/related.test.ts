import { describe, expect, it } from 'vitest'
import { relatedWork } from '../../src/profile/related.ts'
import { type ShareView, sharePage } from '../../src/share/page.ts'

const projects = [
  {
    name: 'integration-triage',
    url: 'https://github.com/me/integration-triage',
    line: 'Diagnoses failing API calls from logs and drafts the support reply',
  },
  {
    name: 'stmtflow',
    url: 'https://github.com/me/stmtflow',
    line: 'Extracts transactions from PDF bank statements and verifies the totals',
  },
]

const kit = (facts: string[], title?: string) => ({
  name: 'Merge',
  headline: 'One API for every integration',
  description: 'Unified API for HR, payroll and accounting integrations',
  facts: facts.map((text) => ({ text, kind: 'claim' })),
  ...(title ? { job: { title } } : {}),
})

describe('related work', () => {
  it('picks the project closest to the company and role', () => {
    const r = relatedWork(
      { projects },
      kit(
        ['Debug failing API calls across 200+ integrations', 'Support engineers own the logs'],
        'Technical Support Engineer',
      ),
    )
    expect(r?.name).toBe('integration-triage')
    expect(r?.shared.length).toBeGreaterThanOrEqual(2)
  })

  it('picks nothing when no project is close', () => {
    const mealKits = {
      ...kit(['Recipes for busy families', 'Meal kits delivered weekly']),
      name: 'Plated',
      headline: 'Dinner, sorted',
      description: 'Fresh ingredients and simple recipes, delivered',
    }
    expect(relatedWork({ projects }, mealKits)).toBeNull()
    expect(relatedWork({}, kit(['anything']))).toBeNull()
  })

  it('shows on the share page as one link', () => {
    const v: ShareView = {
      company: 'Merge',
      format: 'square',
      from: 'Ashwin Tiwari',
      firstName: 'Ashwin',
      ctaLine: 'Could we talk?',
      contact: 'a@example.com',
      film: 'film-square.mp4',
      related: projects[0]!,
    }
    const html = sharePage(v, 'https://f.example/f/1')
    expect(html).toContain('Something I built that’s close to what you do')
    expect(html).toContain('href="https://github.com/me/integration-triage"')
  })
})
