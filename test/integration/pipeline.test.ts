import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { closeBrowser } from '../../src/browser.ts'
import { createFilmAgent, type FilmResult } from '../../src/film.ts'
import { ScriptedProvider } from '../../src/llm/scripted.ts'
import { FILM, type ModelMessages } from '../../src/outreach/writer.ts'
import { LocalContext } from '../../src/runtime/local.ts'
import { deterministicScript } from '../../src/script/writer.ts'
import { fixtureServer, kitFor, profile, tmp } from '../helpers/index.ts'

afterAll(async () => {
  await closeBrowser()
  ;(await fixtureServer()).close()
})

describe('film pipeline (no database)', () => {
  it('makes a complete film, then resumes from the journal without redoing work', async () => {
    const { url } = await fixtureServer()
    const filmsDir = tmp('films-')
    const agent = createFilmAgent({ filmsDir, llmModel: null, allowPrivateNetworks: true })
    const input = {
      url: `${url}/parcelpine/`,
      profile: profile('candidate'),
      format: 'portrait' as const,
    }
    const journalFile = join(filmsDir, 'run_test', '.journal.json')

    const progress: string[] = []
    const first = new LocalContext({
      runId: 'run_test',
      journalFile,
      onProgress: (p) => progress.push(String(p.stage)),
    })
    const t0 = Date.now()
    const r: FilmResult = await agent.run(first, input)
    const firstMs = Date.now() - t0

    expect(r.company).toBe('Parcelpine')
    expect(r.qa.issues).toEqual([])
    // no model: no messages stored, so the API uses the templates
    expect(r.messages).toBeUndefined()
    for (const f of Object.values(r.files).flat())
      expect(existsSync(join(filmsDir, f)), f).toBe(true)
    // one still per scene, for the review's filmstrip
    expect(r.files.scenes).toHaveLength(6)
    expect(new Set(progress)).toEqual(new Set(['research', 'script', 'design', 'render', 'encode']))

    const probe = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'stream=width,height:format=duration',
          '-of',
          'json',
          join(filmsDir, r.files.film),
        ],
        { encoding: 'utf8' },
      ),
    )
    expect(probe.streams[0]).toMatchObject({ width: 1080, height: 1920 })
    expect(Number(probe.format.duration)).toBeCloseTo(r.durationSec, 0)
    expect(statSync(join(filmsDir, r.files.gif)).size).toBeLessThan(3_000_000)

    // same id again: everything replays from the journal, nothing is re-rendered
    const second = new LocalContext({ runId: 'run_test', journalFile })
    expect(await second.load()).toBeGreaterThanOrEqual(10)
    const t1 = Date.now()
    const again = await agent.run(second, input)
    expect(Date.now() - t1).toBeLessThan(firstMs / 5)
    expect(second.replayed).toEqual(
      expect.arrayContaining(['research', 'script', 'compose', 'render:0', 'render:5', 'encode']),
    )
    expect(again.files).toEqual(r.files)
  })

  it('stops with a clear, non-retryable error when a site cannot be read', async () => {
    const { url } = await fixtureServer()
    const agent = createFilmAgent({
      filmsDir: tmp('films-'),
      llmModel: null,
      allowPrivateNetworks: true,
    })
    const ctx = new LocalContext({ runId: 'run_missing' })
    await expect(
      agent.run(ctx, {
        url: `${url}/does-not-exist/`,
        profile: profile('sales'),
        format: 'square',
      }),
    ).rejects.toThrow(/could not read .* HTTP 404/)
  })

  it('renders a script the person edited, but not one with a number nobody gave it', async () => {
    const { url } = await fixtureServer()
    const filmsDir = tmp('films-')
    const agent = createFilmAgent({ filmsDir, llmModel: null, allowPrivateNetworks: true })
    const base = { url: `${url}/lumen/`, profile: profile('candidate'), format: 'square' as const }
    const first = await agent.run(new LocalContext({ runId: 'run_first' }), base)

    const edited = {
      ...first.script,
      hook: 'Hello Lumen Health team',
      insight: { ...first.script.insight, factId: 'gone' },
    }
    const r = await agent.run(new LocalContext({ runId: 'run_edit' }), { ...base, script: edited })
    expect(r.script.hook).toBe('Hello Lumen Health team')
    expect(r.scriptMeta.model).toBe('edited')
    // the featured fact disappeared from the site: the built-in writer's pick stands in
    expect(r.script.insight.factId).toBe(first.script.insight.factId)

    await expect(
      agent.run(new LocalContext({ runId: 'run_bad' }), {
        ...base,
        script: { ...first.script, hook: 'Lumen grew 97% with me' },
      }),
    ).rejects.toThrow(/edited script can't be used: hook mentions "97%"/)
  }, 360_000)

  it('stores the messages the model wrote with the film, and replays them without a second call', async () => {
    const { url } = await fixtureServer()
    const { kit } = await kitFor('parcelpine')
    const p = profile('candidate')
    // a job seeker's reply, in the voice: no job words, no numbers, a question about their work
    const reply: ModelMessages = {
      note: "I've been reading about what Parcelpine is building. Curious how often returns become store credit.",
      afterAccept: `Thanks for connecting. I put what I'd try next with Parcelpine into a 30-second film: ${FILM} How often do returns become store credit today?`,
      inmail: {
        subject: 'A question about Parcelpine',
        body: `I put what I'd try next with Parcelpine into a 30-second film: ${FILM} How often do returns become store credit today?`,
      },
      email: {
        subject: 'A question about Parcelpine',
        opening: "I've been reading about what Parcelpine is building.",
        tease: `I put what I'd try next with Parcelpine into a 30-second film: ${FILM}`,
        creator: null,
        // a specific thing of theirs, never a category ("what Parcelpine is building")
        question: 'How often do returns become store credit today?',
        offer: "Happy to trade notes on that for 15 minutes if it's useful.",
      },
    }
    let messageCalls = 0
    // the built-in stand-in model: the deterministic script, and these messages
    const llm = new ScriptedProvider(
      (req) => {
        if (req.messages[0]!.content.startsWith('You write the short messages')) {
          messageCalls++
          return JSON.stringify(reply)
        }
        return JSON.stringify(deterministicScript(kit, p))
      },
      [0, 1],
    )
    const filmsDir = tmp('films-')
    const agent = createFilmAgent({ filmsDir, llmModel: 'scripted-v1', allowPrivateNetworks: true })
    const input = { url: `${url}/parcelpine/`, profile: p, format: 'square' as const }
    const journalFile = join(filmsDir, 'run_msgs', '.journal.json')

    const r = await agent.run(new LocalContext({ runId: 'run_msgs', llm, journalFile }), input)
    expect(r.messages?.writer).toEqual({
      note: 'model',
      afterAccept: 'model',
      inmail: 'model',
      email: 'model',
    })
    expect(r.messages?.model).toBe('scripted-v1')
    expect(r.messages?.drafts.note).toBe(`Hi [First name], ${reply.note} – Alex`)
    expect(r.messages?.drafts.email.body).toContain(`\n${FILM}\n`)
    expect(messageCalls).toBe(1)

    const second = new LocalContext({ runId: 'run_msgs', llm, journalFile })
    await second.load()
    const again = await agent.run(second, input)
    expect(second.replayed).toEqual(expect.arrayContaining(['messages-1', 'messages']))
    expect(again.messages).toEqual(r.messages)
    expect(messageCalls).toBe(1)
  }, 360_000)
})
