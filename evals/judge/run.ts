/**
 * Read it like a founder: a model scores a job seeker's messages, films and referral asks the way
 * the person receiving them would, and writes every draft out in full for Ashwin to read aloud.
 *
 *   node evals/judge/run.ts                         # builds every item; nothing scored without a model
 *   node evals/judge/run.ts --model openai/gpt-oss-120b \
 *     --base-url https://api.groq.com/openai/v1 --out-dir .
 *
 * The films are the messages eval's (evals/fixture-films.ts): 3 fixture sites, with and without
 * their latest post, and the sender's saved homework. Each is made twice, with two job seekers:
 * the fixture candidate (not coldopen's maker, so no creator line) and Ashwin's FDE profile (his
 * hand-checked proof, coldopen as what he built, and his own saved homework per site: ASHWIN in
 * fixture-films.ts, with none on the film that has their latest post). That's 12 films, 24 messages (the email and
 * the after-accept), 6 distinct films on screen, and 6 referral asks with their blurbs.
 *
 * The model writes the messages, as a real film would; the film's script comes from the built-in
 * writer (as in the messages eval), which keeps the run inside the free tier's day. Every call,
 * messages and judge alike, is paced for Groq's 8k tokens a minute.
 *
 * Advisory only: it writes judge-summary.md (the table, the targets, the weakest drafts) and
 * judge-review.md (everything, in full), and exits 0 whatever the scores, 1 only if the script
 * itself breaks. Nothing in CI depends on it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { serveFixtures } from '../../fixtures/serve.ts'
import { extractBrand } from '../../src/brand/extract.ts'
import { type Homework, pickResearch, withHomework } from '../../src/brand/homework.ts'
import type { BrandKit } from '../../src/brand/types.ts'
import { closeBrowser } from '../../src/browser.ts'
import { OpenAICompatibleProvider } from '../../src/llm/openai.ts'
import { ScriptedProvider } from '../../src/llm/scripted.ts'
import type { LlmProvider } from '../../src/llm/types.ts'
import {
  draftMessages,
  newestPublished,
  openerFor,
  type SenderHomework,
} from '../../src/outreach/messages.ts'
import { draftTouch } from '../../src/outreach/warm.ts'
import {
  briefFor,
  FILM,
  type FilmMessages,
  messagesSchemaFor,
  researchSource,
  scriptedMessages,
  writeMessages,
} from '../../src/outreach/writer.ts'
import { draftProfile } from '../../src/profile/draft.ts'
import { forSender } from '../../src/profile/maker.ts'
import { parseResume } from '../../src/profile/parse.ts'
import { LocalContext } from '../../src/runtime/local.ts'
import { buildStoryboard, type Storyboard } from '../../src/script/storyboard.ts'
import { type Profile, ProfileSchema } from '../../src/script/types.ts'
import { deterministicScript } from '../../src/script/writer.ts'
import {
  ASHWIN,
  CREATOR,
  homeworkFor,
  MESSAGES_NOW,
  publishedFor,
  SENDER,
} from '../fixture-films.ts'
import { asReceived, filmLines } from './items.ts'
import {
  FREE_TOKENS_A_MINUTE,
  type Item,
  isRateLimit,
  type Judged,
  judgeAll,
  PacedProvider,
  redact,
} from './judge.ts'
import { reviewFile, summaryFile } from './report.ts'

const { values } = parseArgs({
  options: {
    model: { type: 'string' },
    'base-url': {
      type: 'string',
      default: process.env.LLM_BASE_URL ?? 'http://localhost:11434/v1',
    },
    'api-key': { type: 'string', default: process.env.LLM_API_KEY ?? 'ollama' },
    /** where judge-summary.md and judge-review.md go */
    'out-dir': { type: 'string' },
    /** the free tier's budget, with some room under Groq's 8k so a burst doesn't trip it */
    'tokens-a-minute': { type: 'string', default: String(FREE_TOKENS_A_MINUTE * 0.9) },
  },
})

const ROOT = join(import.meta.dirname, '../..')
const OUT_DIR = values['out-dir'] ?? import.meta.dirname
const started = Date.now()

/* ------------------------------------------------------------ the two job seekers */

const fixtureSeeker = ProfileSchema.parse(
  JSON.parse(readFileSync(join(ROOT, 'profiles/candidate.example.json'), 'utf8')),
)

/**
 * Ashwin's FDE profile, as he'd send it: the built-in draft of his résumé, with the proof he
 * checked by hand (his best rows) and coldopen as what he built. He's coldopen's maker, so the
 * creator line stays.
 */
async function ashwinSeeker(): Promise<Profile> {
  const expected = JSON.parse(
    readFileSync(join(ROOT, 'fixtures/profiles/ashwin-fde-expected.json'), 'utf8'),
  ) as {
    role: string
    rows: { value: string; label: string; did?: string; where?: string; best?: boolean }[]
  }
  const resume = parseResume(readFileSync(join(ROOT, 'fixtures/resumes/ashwin-fde.md'), 'utf8'), [])
  const { profile } = await draftProfile({ resume, role: expected.role, llm: null })
  const proof = expected.rows
    .filter((r) => r.best)
    .map(({ value, label, did, where }) => ({
      value,
      label,
      ...(did ? { did } : {}),
      ...(where ? { where } : {}),
    }))
  return ProfileSchema.parse({ ...profile, proof, creator: CREATOR })
}

/* ------------------------------------------------------------ what each fixture's people said */

/**
 * For the referral asks: one thing the person said on the call, and the role that opened since,
 * per fixture site. Typed as the sender would type them into "One thing they said".
 */
const CONVERSATION: Record<string, { said: string; role: string }> = {
  parcelpine: {
    said: 'most of your customers outgrow the Shopify app once they ship from a second warehouse',
    role: 'Forward Deployed Engineer',
  },
  northwind: {
    said: 'dock appointments are where most shippers lose a day',
    role: 'Forward Deployed Engineer',
  },
  lumen: {
    said: 'clinics care more about intake errors than intake speed',
    role: 'Forward Deployed Engineer',
  },
}
const SHARE = (site: string) => `https://films.example.com/f/${site}-k3x9q2m7ab`

/* ------------------------------------------------------------ the model */

const tokensAMinute = Math.max(1000, Number(values['tokens-a-minute']) || FREE_TOKENS_A_MINUTE)
const paced: PacedProvider | null = values.model
  ? new PacedProvider(
      new OpenAICompatibleProvider({
        baseUrl: values['base-url']!,
        model: values.model,
        apiKey: values['api-key']!,
        timeoutMs: 180_000,
        // the provider waits out a 429 this long itself; the judge then backs off once more
        maxRateWaitMs: 90_000,
      }),
      tokensAMinute,
    )
  : null

/* ------------------------------------------------------------ the messages */

const show = (s: string) => s.replace(/\r/g, '')

interface FilmRun {
  id: string
  site: string
  seeker: string
  company: string
  research: boolean
  m: FilmMessages | null
  /** "model", or why the templates stood in */
  writtenBy: string
  email: { subject: string; body: string }
  afterAccept: string
}

async function messagesFor(
  kit: BrandKit,
  profile: Profile,
  board: Storyboard,
  script: ReturnType<typeof deterministicScript>,
  homework: Homework | null,
  sender: SenderHomework,
  id: string,
): Promise<Omit<FilmRun, 'id' | 'site' | 'seeker' | 'company' | 'research'>> {
  const insight = board.scenes.find((x) => x.kind === 'insight')
  const proof = board.scenes.find((x) => x.kind === 'proof')
  const film = {
    company: kit.name,
    script,
    highlights: {
      quote:
        insight?.kind === 'insight'
          ? { text: insight.text, source: insight.source }
          : { text: '', source: '' },
      proof: proof?.kind === 'proof' ? proof.stats : [],
    },
  }
  const opener = openerFor(id, profile.preset)
  const item = homework ? pickResearch(homework, { points: profile.points }, MESSAGES_NOW) : null
  const provider: LlmProvider =
    paced ??
    new ScriptedProvider(
      () => JSON.stringify(scriptedMessages(briefFor(film, profile, item, opener, sender))),
      [0, 1],
    )
  try {
    const ctx = new LocalContext({ runId: id, llm: provider })
    const m = await writeMessages({
      film,
      profile,
      homework,
      sender,
      opener,
      model: values.model ?? 'scripted-v1',
      now: MESSAGES_NOW,
      complete: (key, msgs) =>
        ctx.llm(key, { schema: messagesSchemaFor(profile.preset), messages: msgs }),
    })
    const fell = (['email', 'afterAccept'] as const).filter((d) => m.writer[d] === 'template')
    return {
      m,
      writtenBy: `${paced ? 'model' : 'built-in stand-in'}${fell.length ? ` (template for ${fell.join(', ')})` : ''}`,
      email: m.drafts.email,
      afterAccept: m.drafts.afterAccept,
    }
  } catch (e) {
    // the model stayed unavailable: the templates are what the app would send, so judge those
    if (!isRateLimit(e) && paced === null) throw e
    const source = item ? researchSource(item) : null
    const t = draftMessages(film, profile, FILM, {
      opener: briefFor(film, profile, item, opener, sender).opener,
      research: item && source ? { line: source, source, title: item.title } : null,
      homework: sender,
      published: newestPublished(homework, MESSAGES_NOW),
    })
    return {
      m: null,
      writtenBy: `templates (the model failed: ${String(e).slice(0, 100)})`,
      email: t.email,
      afterAccept: t.afterAccept!,
    }
  }
}

/* ------------------------------------------------------------ the run */

async function main() {
  const seekers: { key: string; profile: Profile }[] = [
    // the fixture candidate isn't coldopen's maker, so a film made for them carries no creator
    { key: 'fixture', profile: forSender(fixtureSeeker, false) },
    { key: 'ashwin', profile: await ashwinSeeker() },
  ]
  const { server, url } = await serveFixtures()
  const items: Item[] = []
  /** what each item looked like before the sender's name came out, for Ashwin to read */
  const original = new Map<string, string>()
  const runs: FilmRun[] = []
  const add = (item: Item, shown: string, names: string[]) => {
    original.set(item.id, shown)
    items.push({ ...item, text: redact(shown, names) })
  }
  try {
    for (const site of Object.keys(SITES())) {
      const home = await extractBrand(`${url}/${site}/`, {
        outDir: join(ROOT, '.scratch', 'evals', site),
        allowPrivateNetworks: true,
      })
      const kit = withHomework(home, publishedFor(site))
      const about = [kit.headline, kit.description]
        .map((s) => s.trim().replace(/[.!]+$/, ''))
        .filter(Boolean)
        .join('. ')
      for (const { key, profile } of seekers) {
        const names = [profile.sender.name]
        const script = deterministicScript(kit, profile)
        const board = buildStoryboard(kit, profile, script)
        const filmId = `${site}_${key}`
        add(
          {
            id: `${filmId}_film`,
            kind: 'film',
            film: filmId,
            label: 'the film, every line on screen',
            company: kit.name,
            about,
            text: '',
          },
          filmLines(board),
          names,
        )
        for (const homework of [null, homeworkFor(site)]) {
          const variant = homework ? 'research' : 'plain'
          // Ashwin's films carry his own saved homework; the fixture candidate's, the messages eval's
          const saved =
            key === 'ashwin' ? `${site}_ashwin_${variant}` : `${site}_candidate_${variant}`
          const given = (key === 'ashwin' ? ASHWIN : SENDER)[saved]
          if (!given) throw new Error(`no sender homework for ${saved}`)
          const id = `${filmId}_${variant}`
          process.stdout.write(`writing ${id}… `)
          const r = await messagesFor(
            kit,
            profile,
            board,
            script,
            homework,
            given.hw,
            `judge_${id}`,
          )
          process.stdout.write(`${r.writtenBy}\n`)
          runs.push({ id, site, seeker: key, company: kit.name, research: !!homework, ...r })
          const email = asReceived(`Subject: ${r.email.subject}\n\n${show(r.email.body)}`, 'email')
          add(
            {
              id: `${id}_email`,
              kind: 'message',
              film: id,
              label: 'email',
              company: kit.name,
              about,
              text: '',
            },
            email,
            names,
          )
          add(
            {
              id: `${id}_afterAccept`,
              kind: 'message',
              film: id,
              label: 'LinkedIn message after they accepted',
              company: kit.name,
              about,
              text: '',
            },
            asReceived(show(r.afterAccept), 'linkedin'),
            names,
          )
        }
        const talk = CONVERSATION[site]!
        const touch = draftTouch({
          kind: 'referralAsk',
          company: kit.name,
          profile,
          said: talk.said,
          role: {
            title: talk.role,
            url: `https://jobs.example.com/${site}/forward-deployed-engineer`,
          },
          share: SHARE(site),
        })
        add(
          {
            id: `${filmId}_referral`,
            kind: 'referral',
            film: filmId,
            label: 'referral ask, and the blurb to forward',
            company: kit.name,
            about,
            text: '',
          },
          `Subject: ${touch.subject}\n\n${asReceived(touch.body, 'email')}\n\n--- The blurb you could forward ---\n${touch.blurb ?? ''}`,
          names,
        )
      }
    }
  } finally {
    await closeBrowser()
    server.close()
  }

  console.log(`\njudging ${items.length} items${paced ? ` with ${values.model}` : ''}`)
  const judged: Judged[] = paced
    ? await judgeAll(items, (req) => paced.complete(req), { log: (s) => console.log(s) })
    : items.map((item) => ({
        item,
        scored: false as const,
        why: 'no model given (run with --model)',
        calls: 0,
      }))

  const meta = {
    model: values.model ?? null,
    seconds: Math.round((Date.now() - started) / 1000),
    calls: judged.reduce((n, j) => n + j.calls, 0),
    waitedSeconds: paced ? Math.round(paced.waited / 1000) : 0,
    films: runs.map((r) => ({ id: r.id, writtenBy: r.writtenBy })),
  }
  const summary = summaryFile(judged, original, meta)
  const review = reviewFile(judged, original, meta)
  writeFileSync(join(OUT_DIR, 'judge-summary.md'), summary)
  writeFileSync(join(OUT_DIR, 'judge-review.md'), review)
  console.log(`\n${summary}\nwrote judge-summary.md and judge-review.md to ${OUT_DIR}`)
}

/** The fixture sites, in the messages eval's order */
const SITES = () =>
  JSON.parse(readFileSync(join(ROOT, 'fixtures/expected.json'), 'utf8')) as Record<string, unknown>

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
