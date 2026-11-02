import { describe, expect, it } from 'vitest'
import { fitOf } from '../../src/job/fit.ts'
import { detailsFromBoard, htmlToText, requirementsFromHtml } from '../../src/jobs/details.ts'
import { profile } from '../helpers/index.ts'

// shaped like the real boards: Ashby wraps list items in paragraphs, Greenhouse escapes its HTML
const ASHBY = `<p>We build agents for enterprises.</p><h2><strong>What you’ll do</strong></h2><ul><li><p>Ship production AI agents with customers, with evals that prove they work.</p></li><li><p>Turn messy customer data into pipelines the agents can use.</p></li><li><p>Explain technical trade-offs to executives and non-engineers.</p></li></ul><p><strong>What you bring</strong></p><ul><li><p>Experience with Kubernetes and Terraform at scale.</p></li><li><p>Comfort with APIs, webhooks &amp; integrations.</p></li></ul><p><strong>Benefits</strong></p><ul><li><p>Health, dental and vision insurance</p></li></ul>`
const GREENHOUSE =
  '&lt;h2&gt;About the role&lt;/h2&gt;&lt;p&gt;A long paragraph about why the team matters, which is the pitch, not a requirement.&lt;/p&gt;&lt;p&gt;&lt;strong&gt;You might be a good fit if you have&lt;/strong&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Hands-on experience building agents on LLM APIs&lt;/li&gt;&lt;li&gt;Experience working with external customers&lt;/li&gt;&lt;li&gt;Clear communication of technical concepts&amp;amp;trade-offs&lt;/li&gt;&lt;/ul&gt;'

describe('requirements from board descriptions', () => {
  it('reads list items whole, headings as headings, and skips benefits', () => {
    expect(htmlToText(ASHBY)).toContain('### What you’ll do\n• Ship production AI agents')
    const reqs = requirementsFromHtml(ASHBY)
    expect(reqs).toHaveLength(5)
    expect(reqs).toContain('Comfort with APIs, webhooks & integrations.')
    expect(reqs.some((r) => /insurance/.test(r))).toBe(false)
  })
  it('reads escaped HTML, keeping the lists and leaving the pitch out', () => {
    expect(requirementsFromHtml(GREENHOUSE)).toEqual([
      'Hands-on experience building agents on LLM APIs',
      'Experience working with external customers',
      'Clear communication of technical concepts&trade-offs',
    ])
  })
  it('takes every job of a Lever or Ashby listing, and nothing from Greenhouse', () => {
    const ashby = detailsFromBoard(
      { ats: 'ashby', token: 'acme', name: 'Acme' },
      { jobs: [{ id: 'j1', descriptionHtml: ASHBY }] },
    )
    expect(ashby.get('ashby:acme:j1')).toHaveLength(5)
    const lever = detailsFromBoard({ ats: 'lever', token: 'acme', name: 'Acme' }, [
      {
        id: 'l1',
        lists: [
          {
            text: 'What We Require',
            content:
              '<li>Python and SQL for analytics work</li><li>Customer-facing experience</li>',
          },
        ],
      },
    ])
    expect(lever.get('lever:acme:l1')).toEqual([
      'Python and SQL for analytics work',
      'Customer-facing experience',
    ])
    expect(
      detailsFromBoard({ ats: 'greenhouse', token: 'acme', name: 'Acme' }, { jobs: [{ id: 1 }] })
        .size,
    ).toBe(0)
  })
})

describe('fit', () => {
  const me = profile('candidate')
  it('counts what the record answers and names the best match', () => {
    const fit = fitOf(requirementsFromHtml(ASHBY), me)!
    expect(fit).toMatchObject({ level: 'strong', answered: 3, of: 5 })
    // a requirement word for word, answered by a line of the record that matches it
    expect(fit.best).toEqual({
      requirement: 'Turn messy customer data into pipelines the agents can use.',
      with: 'Turns messy customer data into working pipelines',
    })
  })
  it('calls a post it barely touches a stretch', () => {
    const fit = fitOf(
      [
        'Kubernetes and Terraform at scale',
        'Clinical trial design',
        'Ten years of iOS development',
        'Fluent Japanese',
      ],
      me,
    )!
    expect(fit.level).toBe('stretch')
    expect(fit.answered).toBe(0)
    expect(fit.best).toBeNull()
  })
  it('knows nothing about a post without requirements', () => {
    expect(fitOf([], me)).toBeNull()
  })
})
