import { describe, expect, it } from 'vitest'
import {
  endsWithThanks,
  homeworkLine,
  JOB_WORDS,
  jobWordsIn,
  THANKS,
  VOICE_RULES,
} from '../../src/outreach/voice.ts'

const built = { url: 'https://github.com/alex/rates', line: 'A carrier rate comparer on your API' }
const detail = 'the per-zone breakdown saved me a spreadsheet'
const post = {
  title: 'Route planning, now with live traffic',
  line: 'Route planning now reroutes trucks around live traffic before a delivery runs late',
}

describe('the homework line a message opens with', () => {
  it('picks what you built first, then your detail, then their latest post, else nothing', () => {
    const all = { detail, question: 'Q?', built }
    expect(homeworkLine('Parcelpine', all, post)).toEqual({
      kind: 'built',
      line: 'I built something small with Parcelpine: a carrier rate comparer on your API (https://github.com/alex/rates).',
    })
    expect(homeworkLine('Parcelpine', { ...all, built: null }, post)).toEqual({
      kind: 'detail',
      line: "I've been using Parcelpine, and the per-zone breakdown saved me a spreadsheet.",
    })
    expect(homeworkLine('Parcelpine', { detail: null, question: 'Q?', built: null }, post)).toEqual(
      {
        kind: 'post',
        line: 'I read that route planning now reroutes trucks around live traffic before a delivery runs late.',
      },
    )
    expect(homeworkLine('Parcelpine', null, null)).toBeNull()
    // a question alone isn't homework to open with: it's asked later
    expect(homeworkLine('Parcelpine', { detail: null, question: 'Q?', built: null })).toBeNull()
  })

  it('keeps a detail written in your own voice as it is', () => {
    const line = homeworkLine(
      'Parcelpine',
      { detail: 'I tried the rate API this weekend.', question: null, built: null },
      null,
    )
    expect(line?.line).toBe('I tried the rate API this weekend.')
  })

  it('never ends on a cut post\'s "…": the last whole clause, or no line', () => {
    const cut = { title: '', line: `${post.line}, and drivers see the new stop order on their…` }
    expect(homeworkLine('Parcelpine', null, cut)?.line).toBe(
      'I read your recent post, and route planning now reroutes trucks around live traffic before a delivery runs late.',
    )
    expect(homeworkLine('Parcelpine', null, { title: '', line: 'Reroutes trucks…' })).toBeNull()
  })
})

describe('job words', () => {
  it('finds each job word as a whole word, plural too, in any case', () => {
    expect(jobWordsIn('I saw the Role at Parcelpine')).toEqual(['role'])
    // "openings" is "opening" with its plural, and on the list itself
    expect(jobWordsIn('Are you hiring? Any openings?')).toEqual(['opening', 'openings', 'hiring'])
    expect(jobWordsIn('My résumé is attached')).toEqual(['résumé'])
    expect(jobWordsIn('two jobs, three roles and a candidate')).toEqual([
      'role',
      'candidate',
      'job',
    ])
    // inside other words, they don't count
    expect(jobWordsIn('a controlled rollout, an apple, and a resumed upload')).toEqual([])
    for (const w of JOB_WORDS) expect(jobWordsIn(`About the ${w} here`)).toContain(w)
  })

  it("doesn't count a job word inside quotation marks: their own words, quoted", () => {
    expect(jobWordsIn('Your post "Operations Analyst role, Denver" caught my eye')).toEqual([])
    expect(jobWordsIn('Your homepage says “Hiring made human”')).toEqual([])
    // outside the quotes, it still does
    expect(jobWordsIn('The "Analyst" role caught my eye')).toEqual(['role'])
  })
})

describe('ending with thanks', () => {
  it('passes every thanks phrase just before the signature', () => {
    for (const t of THANKS) {
      const phrase = t[0]!.toUpperCase() + t.slice(1)
      expect(
        endsWithThanks(`Hi Dana,\n\nOne question.\n\n${phrase},\nAlex Rivera\nalex@example.com`),
        t,
      ).toBe(true)
      expect(endsWithThanks(`Hi Dana, one question. ${phrase}. – Alex`), t).toBe(true)
    }
    expect(endsWithThanks('Hi,\n\nThanks for reading.\n\nAshwin')).toBe(true)
  })

  it('fails a message with no thanks, or more message after it', () => {
    expect(endsWithThanks('Hi Dana,\n\nCould we talk this week?\n\nBest,\nAlex')).toBe(false)
    // thanks for connecting opens the message; it isn't its ending
    expect(endsWithThanks('Hi Dana, thanks for connecting.\n\nHere is the film.\n\nAlex')).toBe(
      false,
    )
    expect(
      endsWithThanks(
        'Thank you for your time.\n\nAlso, are you free for a call next week?\n\nAlex',
      ),
    ).toBe(false)
    expect(endsWithThanks('Thank you for your time on the call last week, it helped. Alex')).toBe(
      false,
    )
  })
})

describe('the voice rules for the model', () => {
  it('says every rule, with the job words it checks', () => {
    for (const r of [
      'Their work first',
      'One real question',
      'Thanks for their time',
      'No job words',
    ])
      expect(VOICE_RULES).toContain(r)
    for (const w of ['role', 'position', 'hiring', 'apply', 'candidate', 'job'])
      expect(VOICE_RULES).toMatch(new RegExp(`\\b${w}\\b`))
    expect(VOICE_RULES).toContain('word for word')
  })
})
