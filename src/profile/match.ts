import type { BrandKit } from '../brand/types.ts'
import type { JobPost } from '../job/post.ts'
import type { Profile } from '../script/types.ts'

/**
 * Which of someone's profiles fits a company best. A person applying to different kinds of
 * roles keeps one profile per résumé (analyst, engineer, BDR...); this ranks them against what
 * the company's own site talks about, so the CLI can suggest one and the person can confirm.
 *
 * Deliberately simple and explainable: every point of score is a word on their site that the
 * person can see in the reasons.
 */

/** Role families, how to spot them in a profile, and the words that signal them on a site. */
const FAMILIES: { id: string; role: RegExp; signals: string[] }[] = [
  {
    id: 'engineering',
    role: /\b(software|backend|frontend|full[- ]?stack|developer|sde|swe)\b/i,
    signals: [
      'api',
      'apis',
      'sdk',
      'developers',
      'developer',
      'docs',
      'open source',
      'infrastructure',
      'deploy',
      'database',
      'code',
      'github',
      'latency',
      'scale',
      'cloud',
    ],
  },
  {
    id: 'ml',
    role: /\b(machine learning|ml|data scien\w*|ai engineer)\b/i,
    signals: [
      'model',
      'models',
      'machine learning',
      'training',
      'inference',
      'llm',
      'gpu',
      'ai',
      'agents',
      'evals',
      'data',
    ],
  },
  {
    id: 'deployed',
    role: /\b(forward deployed|solutions|implementation|customer engineer|sales engineer)\b/i,
    signals: [
      'enterprise',
      'integration',
      'integrations',
      'customers',
      'onboarding',
      'deploy',
      'platform',
      'agents',
      'ai',
      'api',
      'workflows',
    ],
  },
  {
    id: 'analyst',
    role: /\b(analyst|analytics|financ\w*|strategy|consult\w*)\b/i,
    signals: [
      'finance',
      'financial',
      'bank',
      'banking',
      'investment',
      'capital',
      'insights',
      'analytics',
      'research',
      'economic',
      'economy',
      'consulting',
      'strategy',
      'transactions',
      'risk',
      'markets',
      'advisory',
      'development',
      'policy',
      'data',
    ],
  },
  {
    id: 'product',
    role: /\b(product manager|product owner|pm|product lead)\b/i,
    signals: [
      'product',
      'users',
      'teams',
      'app',
      'workflow',
      'workflows',
      'design',
      'experience',
      'roadmap',
      'launch',
      'collaboration',
    ],
  },
  {
    id: 'sales',
    role: /\b(bdr|sdr|business development|account exec\w*|sales)\b/i,
    signals: [
      'sales',
      'revenue',
      'pipeline',
      'crm',
      'prospects',
      'outbound',
      'demo',
      'book a demo',
      'pricing',
      'growth',
      'leads',
      'deals',
    ],
  },
  {
    id: 'gtm',
    role: /\b(gtm|go-to-market|revops|revenue operations|growth engineer)\b/i,
    signals: [
      'revenue',
      'pipeline',
      'crm',
      'go-to-market',
      'gtm',
      'sales',
      'marketing',
      'growth',
      'automation',
      'integrations',
      'leads',
    ],
  },
]

// words every site and every profile use; they say nothing about fit
const COMMON = new Set(
  'about built build builds turns makes helps ships takes gives keeps works runs leads brings their there which where with without while teams people these those every other would could should first years using across into from through clear'.split(
    ' ',
  ),
)

export interface ProfileMatch {
  id: string
  profile: Profile
  score: number
  /** the words on their site that earned the score, strongest first */
  reasons: string[]
}

function siteText(kit: BrandKit): string {
  return [
    kit.name,
    kit.title,
    kit.description,
    kit.headline,
    ...kit.subheads,
    ...kit.nav,
    ...kit.facts.map((f) => f.text),
  ]
    .join(' \n ')
    .toLowerCase()
}

const count = (text: string, word: string) =>
  text.match(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'))?.length ?? 0

/**
 * @param job  when the film answers a job post, its title and requirements say far more about
 *             fit than the homepage does: they're counted with the site, and a profile whose
 *             role matches the job title gets a strong boost.
 */
export function rankProfiles(
  kit: BrandKit,
  profiles: { id: string; profile: Profile }[],
  job?: JobPost,
): ProfileMatch[] {
  const text = `${siteText(kit)}${job ? ` \n ${job.title} \n ${job.requirements.join(' \n ')}`.toLowerCase() : ''}`
  const titleWords = new Set(
    (job?.title.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter(
      (w) => !['senior', 'junior', 'staff', 'lead', 'principal', 'and', 'the'].includes(w),
    ),
  )
  return profiles
    .map(({ id, profile }) => {
      const roleText = `${profile.sender.role ?? ''} ${profile.offer} ${id}`
      const families = FAMILIES.filter((f) => f.role.test(roleText))
      const hits = new Map<string, number>()
      for (const f of families)
        for (const w of f.signals) {
          const n = count(text, w)
          if (n) hits.set(w, Math.max(hits.get(w) ?? 0, n))
        }
      // words the profile itself uses that the site also uses ("payroll", "logistics", "agents")
      for (const w of new Set(
        `${profile.offer} ${profile.points.join(' ')}`.toLowerCase().match(/[a-z]{7,}/g) ?? [],
      )) {
        const n = count(text, w)
        if (n && !hits.has(w) && !COMMON.has(w)) hits.set(w, Math.min(n, 2) * 0.5)
      }
      // the job title names the role: "Forward Deployed Engineer" vs a profile for exactly that
      const role = `${profile.sender.role ?? ''} ${id}`.toLowerCase().match(/[a-z]{3,}/g) ?? []
      const titled = [...new Set(role)].filter((w) => titleWords.has(w))
      for (const w of titled) hits.set(`role: ${w}`, 3)
      // diminishing returns: a site saying "data" 40 times shouldn't drown everything else
      const score = [...hits.values()].reduce((s, n) => s + Math.log2(1 + n), 0) + titled.length * 2
      const reasons = [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w)
      return { id, profile, score: Math.round(score * 10) / 10, reasons }
    })
    .sort((a, b) => b.score - a.score)
}
