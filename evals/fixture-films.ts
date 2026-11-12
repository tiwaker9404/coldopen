/**
 * The fixture films the evals share: each fixture site's own feeds (read directly, as if read on a
 * pinned day), the sender's saved homework for each of the 12 message films, and the creator line.
 * The messages eval (evals/run.ts) and the judged eval (evals/judge/run.ts) read the same films, so
 * a score in one can be compared with a check in the other.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decode, type Homework, parseFeed } from '../src/brand/homework.ts'
import type { SenderHomework } from '../src/outreach/messages.ts'

const ROOT = join(import.meta.dirname, '..')

/**
 * Homework for the messages eval: each fixture site's own feed, read directly and picked on a
 * pinned day, because their dates are fixed (none is linked from its fixture site, on purpose).
 * Each site gets its own posts, so a research line is always about the company it's sent to.
 */
export const FEEDS: Record<string, { file: string; kind: 'changelog' | 'blog' }> = {
  parcelpine: { file: 'parcelpine/changelog.xml', kind: 'changelog' },
  northwind: { file: 'northwind/changelog.xml', kind: 'changelog' },
  lumen: { file: 'lumen/blog.xml', kind: 'blog' },
}
export const homeworkFor = (site: string): Homework => {
  const feed = FEEDS[site]
  if (!feed) throw new Error(`no fixture feed for ${site}; add one to FEEDS`)
  return {
    items: parseFeed(
      readFileSync(join(ROOT, 'fixtures/sites', feed.file), 'utf8'),
      'http://127.0.0.1/',
    ).map((i) => ({ kind: feed.kind, ...i })),
    pages: [],
  }
}
export const MESSAGES_NOW = Date.parse('2026-11-03T12:00:00Z')

/**
 * Everything each fixture site published beyond its homepage, for the fact scene: its feeds, read
 * directly, as if read on the pinned day (not linked from the fixture sites, so the films don't
 * change as the calendar moves). Parcelpine also has a podcast, quoted from its episode notes.
 */
export const PUBLISHED: Record<string, { file: string; kind: 'changelog' | 'blog' | 'podcast' }[]> =
  {
    parcelpine: [
      { file: 'parcelpine/changelog.xml', kind: 'changelog' },
      { file: 'parcelpine/podcast.xml', kind: 'podcast' },
    ],
    northwind: [{ file: 'northwind/changelog.xml', kind: 'changelog' }],
    lumen: [{ file: 'lumen/blog.xml', kind: 'blog' }],
  }
export const feedText = (site: string) =>
  (PUBLISHED[site] ?? [])
    .map((f) => decode(readFileSync(join(ROOT, 'fixtures/sites', f.file), 'utf8')))
    .join(' ')
export const publishedFor = (site: string): Homework => ({
  items: (PUBLISHED[site] ?? []).flatMap((f) =>
    parseFeed(
      readFileSync(join(ROOT, 'fixtures/sites', f.file), 'utf8'),
      'https://fixtures.example/',
    ).map((i) => ({ kind: f.kind, ...i })),
  ),
  pages: [],
  readAt: new Date(MESSAGES_NOW).toISOString(),
})

/**
 * The sender's own homework for each of the 12 message films (site, preset, with or without
 * their latest post), as if saved after the film: a detail from using the product on 6, something
 * small built with it on 3, a question of their own on 6, and the creator line on half. Only a job
 * seeker's drafts use it; a seller's prompt is the same as before. Written in plain words with no
 * numbers, as a person would save them.
 */
export const SENDER: Record<string, { hw: SenderHomework; creator: boolean }> = (() => {
  const d = {
    parcelpine: 'the per-zone breakdown in the rate view saved me a spreadsheet',
    northwind: 'I moved a dock appointment from the shipment page without calling anyone',
    lumen: 'the intake form filled in the insurance details from a photo of the card',
  }
  const q = {
    parcelpine:
      'Are most of your customers calling the rates API directly, or going through the Shopify app?',
    northwind: 'Do most shippers connect their ERP first, or start from the dock schedule?',
    lumen:
      'Do clinics switch on the translated intake forms themselves, or does your team set them up?',
  }
  const b = {
    parcelpine: {
      url: 'https://github.com/alex/rate-compare',
      line: 'A small script that compares two carriers on your rates API',
    },
    northwind: {
      url: 'https://github.com/alex/dock-board',
      line: 'A dock board that reads your shipment feed',
    },
    lumen: {
      url: 'https://github.com/alex/intake-check',
      line: 'A checker that reads an intake form back to the patient',
    },
  }
  type Site = keyof typeof d
  const of = (site: Site, x: { detail?: boolean; question?: boolean; built?: boolean }) => ({
    detail: x.detail ? d[site] : null,
    question: x.question ? q[site] : null,
    built: x.built ? b[site] : null,
  })
  return {
    parcelpine_candidate_plain: {
      hw: of('parcelpine', { detail: true, question: true }),
      creator: true,
    },
    parcelpine_candidate_research: { hw: of('parcelpine', { built: true }), creator: true },
    northwind_candidate_plain: { hw: of('northwind', { question: true }), creator: false },
    northwind_candidate_research: { hw: of('northwind', { detail: true }), creator: true },
    lumen_candidate_plain: { hw: of('lumen', {}), creator: false },
    lumen_candidate_research: {
      hw: of('lumen', { detail: true, question: true, built: true }),
      creator: false,
    },
    parcelpine_sales_plain: {
      hw: of('parcelpine', { detail: true, question: true }),
      creator: true,
    },
    parcelpine_sales_research: { hw: of('parcelpine', { detail: true }), creator: false },
    northwind_sales_plain: { hw: of('northwind', { built: true, question: true }), creator: true },
    northwind_sales_research: { hw: of('northwind', {}), creator: false },
    lumen_sales_plain: { hw: of('lumen', { detail: true }), creator: true },
    lumen_sales_research: { hw: of('lumen', { question: true }), creator: false },
  }
})()
/** What the sender built that made the film, on the films the table above gives it to */
export const CREATOR = {
  name: 'coldopen',
  url: 'https://tiwaker9404.github.io/coldopen/',
  line: 'An open-source agent that turns a company site into an on-brand pitch',
}
