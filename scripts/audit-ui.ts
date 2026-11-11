/**
 * UI audit: every page coldopen serves, in a real browser, at desktop and phone widths.
 * Checks accessibility (axe-core, WCAG 2.2 AA), console errors, horizontal overflow on a
 * phone, and missing security headers. Exits non-zero on anything serious.
 *
 *   node scripts/audit-ui.ts http://localhost:8080 [site-dir]     (CHROME_PATH to use another Chrome)
 *   DEMO_DIR=dashboard/dist-demo node scripts/audit-ui.ts ... site  also checks the demo build, tour open
 */
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { extname, resolve, sep } from 'node:path'
import puppeteer, { type Page } from 'puppeteer'
import { flatSearches, parseConnections, peopleSearches } from '../src/outreach/people.ts'

// a file inside dir, never outside it: a ../ in a request path would otherwise reach the rest of the disk
const inside = (dir: string, rest: string) => {
  const root = resolve(dir)
  const file = resolve(root, `.${sep}${rest}`)
  if (!file.startsWith(root + sep)) throw new Error('outside the served folder')
  return file
}

// a resource that failed to load, or a request the network refused, rather than a page bug
const isNetworkNoise = (text: string) =>
  /^Failed to load resource/.test(text) || /ERR_(TUNNEL|NAME|INTERNET|CONNECTION|PROXY)/.test(text)

const base = process.argv[2] ?? 'http://localhost:8080'
const siteDir = process.argv[3]
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')

const pages: { name: string; url: string }[] = [
  { name: 'Today', url: `${base}/#today` },
  { name: 'Jobs', url: `${base}/#jobs` },
  { name: 'Startups', url: `${base}/#startups` },
  { name: 'Films', url: `${base}/#films` },
  { name: 'Profile', url: `${base}/#profile` },
  { name: 'Privacy', url: `${base}/privacy` },
]

// the landing site and the Hiring Index, served as GitHub Pages serves them
let close = () => {}
if (siteDir) {
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.mp4': 'video/mp4',
  }
  const srv = createServer((req, res) => {
    try {
      let p = decodeURIComponent((req.url ?? '/').split('?')[0]!)
      if (p.endsWith('/')) p += 'index.html'
      const body = readFileSync(inside(siteDir, p))
      res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((r) => srv.listen(8099, '127.0.0.1', r))
  close = () => srv.close()
  pages.push(
    { name: 'Landing', url: 'http://127.0.0.1:8099/' },
    { name: 'Hiring Index', url: 'http://127.0.0.1:8099/hiring-index/' },
    { name: 'Developers', url: 'http://127.0.0.1:8099/developers/' },
  )
}

// the demo build, served as GitHub Pages serves it: /coldopen/demo/ beside the landing site
if (process.env.DEMO_DIR) {
  const demoDir = process.env.DEMO_DIR
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.woff2': 'font/woff2',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
  }
  const srv = createServer((req, res) => {
    try {
      let p = decodeURIComponent((req.url ?? '/').split('?')[0]!)
      if (p.endsWith('/')) p += 'index.html'
      const file = p.startsWith('/coldopen/demo/')
        ? inside(demoDir, p.slice('/coldopen/demo/'.length))
        : p.startsWith('/coldopen/') && siteDir
          ? inside(siteDir, p.slice('/coldopen/'.length))
          : null
      if (!file) throw new Error('not found')
      const body = readFileSync(file)
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((r) => srv.listen(8098, '127.0.0.1', r))
  const before = close
  close = () => {
    before()
    srv.close()
  }
  pages.push(
    { name: 'Demo: Today', url: 'http://127.0.0.1:8098/coldopen/demo/#today' },
    { name: 'Demo: Jobs', url: 'http://127.0.0.1:8098/coldopen/demo/#jobs' },
    { name: 'Demo: Films', url: 'http://127.0.0.1:8098/coldopen/demo/#films' },
  )
}

interface Finding {
  page: string
  width: number
  kind: string
  detail: string
  serious: boolean
}
const findings: Finding[] = []

/** Sideways scrolling on a phone, and axe-core's WCAG 2.2 AA rules, on the page as it is now. */
async function inspect(page: Page, name: string, width: number) {
  // the page, and any open drawer: a drawer scrolls on its own, so the page can't see it overflow
  const overflow = await page.evaluate(() =>
    Math.max(
      ...[document.documentElement, ...document.querySelectorAll('[role=dialog]')].map(
        (e) => e.scrollWidth - e.clientWidth,
      ),
    ),
  )
  if (width === 375 && overflow > 1)
    findings.push({
      page: name,
      width,
      kind: 'overflow',
      detail: `scrolls sideways by ${overflow}px on a phone`,
      serious: true,
    })
  await page.addScriptTag({ content: axe })
  const result = (await page.evaluate(async () => {
    const a = (window as unknown as { axe: { run: (o: unknown) => Promise<unknown> } }).axe
    return a.run({ runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] })
  })) as {
    violations: {
      id: string
      impact: string
      help: string
      nodes: { target: string[]; any?: { message: string }[] }[]
    }[]
  }
  for (const v of result.violations)
    findings.push({
      page: name,
      width,
      kind: `a11y:${v.id}`,
      detail: `${v.help} (${v.nodes.length}×: ${v.nodes
        .slice(0, 3)
        .map(
          (n) =>
            `${n.target.join(' ')}${n.any?.[0]?.message ? ` [${n.any[0].message.slice(0, 140)}]` : ''}`,
        )
        .join(', ')})`,
      serious: v.impact === 'serious' || v.impact === 'critical',
    })
}

const browser = await puppeteer.launch({
  args: ['--no-sandbox'],
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
})
// desktop, phone, and desktop in dark mode (its own colors, its own contrast)
for (const [width, dark] of [
  [1280, false],
  [375, false],
  [1280, true],
] as const) {
  for (const p of pages) {
    const page = await browser.newPage()
    await page.setViewport({ width, height: 900 })
    // the page's CSP would (rightly) refuse the injected axe script
    await page.setBypassCSP(true)
    if (dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
    const errors: string[] = []
    page.on('console', (m) => {
      // a resource that failed to load (offline CI, a test film with no files) is a network
      // matter, not a page bug; a script error is
      if (m.type() === 'error' && !isNetworkNoise(m.text())) errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(e.message))
    const res = await page.goto(p.url, { waitUntil: 'networkidle0' }).catch(() => null)
    await new Promise((r) => setTimeout(r, 800))
    if (width === 1280 && !dark && res && p.url.startsWith(base)) {
      const h = res.headers()
      for (const want of [
        'content-security-policy',
        'x-content-type-options',
        'referrer-policy',
        'x-frame-options',
      ])
        if (!h[want])
          findings.push({
            page: p.name,
            width,
            kind: 'header',
            detail: `no ${want}`,
            serious: true,
          })
    }
    for (const e of errors.slice(0, 5))
      findings.push({
        page: p.name,
        width,
        kind: 'console',
        detail: e.slice(0, 200),
        serious: true,
      })
    await inspect(page, dark ? `${p.name} (dark)` : p.name, width)
    await page.close()
  }
}

/* ------------------------------------------------------------------ states */

/*
 * States a page reaches only after someone acts: a LinkedIn job link in the composer, the
 * account menu's delete step, a film's messages with both disclosures, and the two error
 * boundaries. The API answers are stubbed where a fresh database has nothing to show (a signed-in
 * hosted account, a finished film), so these run the same in CI as on a laptop.
 */
const FILM = 'run_01AUDIT0000000000000000000'
const now = new Date().toISOString()
const share = `${base}/f/audit`
const film = {
  id: FILM,
  status: 'succeeded',
  url: 'https://parcelpine.example',
  format: 'landscape',
  batch: null,
  sender: 'me',
  pitch: null,
  progress: null,
  attempts: 1,
  error: null,
  errorCode: null,
  createdAt: now,
  completedAt: now,
  company: 'Parcelpine',
  host: 'parcelpine.example',
  durationSec: 30,
  files: null,
  share,
  job: { title: 'Operations Analyst', url: null },
  views: null,
  outreach: null,
  editOf: null,
  recipient: null,
  detail: null,
  question: null,
  built: null,
}
const filmDetail = {
  ...film,
  script: null,
  scriptMeta: null,
  highlights: null,
  qa: null,
  homework: null,
  render: null,
  steps: [],
  timeline: [],
  embed: null,
}
const messages = {
  email: {
    subject: "A 30-second film for Parcelpine's Operations Analyst team",
    body: `Hi [First name],\n\nI made Parcelpine a 30-second film about your Operations Analyst role: ${share}\n\nWorth a 15-minute call this week?\n\nAlex`,
  },
  linkedin:
    'Hi [First name], I made Parcelpine a short film about your Operations Analyst role and would like to connect. – Alex',
  afterAccept: `Hi [First name], thanks for connecting. Here's the 30-second film: ${share} Worth a 15-minute call? – Alex`,
  inmail: {
    subject: 'A film for your Operations Analyst role',
    body: `Hi [First name], I made Parcelpine a 30-second film about the Operations Analyst role: ${share} Worth a 15-minute call? – Alex`,
  },
  followUp: `Hi [First name],\n\nFollowing up on the film: ${share}\n\nAlex`,
  lastNote: `Hi [First name], one last note on the film: ${share}\n\nAlex`,
  linkedinFollowUp: `Hi [First name], following up on the film I made you: ${share} – Alex`,
  intro: 'Hi [First name], could you pass this on?',
  checks: { words: 40, short: true, aboutThem: true, detail: false, oneAsk: true },
  writer: { note: 'model', afterAccept: 'model', inmail: 'model', email: 'template' },
  flags: {
    email: [
      {
        rule: 'grounded',
        ok: false,
        why: 'It says 60% faster, and 60% isn’t in your profile or on their site.',
      },
    ],
  },
  notes: { inmail: ['The funding line was left out: their round is over a year old.'] },
}
const candidate = JSON.parse(
  readFileSync(new URL('../profiles/candidate.example.json', import.meta.url), 'utf8'),
)
const profiles = { data: [{ id: 'me', name: 'Me', data: candidate, updatedAt: now }] }
const hostedMe = {
  hosted: true,
  signIn: false,
  providers: [],
  user: { login: 'audit', name: 'Audit', avatar: null },
  films: { used: 1, limit: 5 },
  keepsDays: 30,
  stats: false,
}

type Stubs = Record<string, unknown>
const withFilm: Stubs = {
  '/v1/profiles': profiles,
  '/v1/films': { data: [film] },
  [`/v1/films/${FILM}`]: filmDetail,
  [`/v1/films/${FILM}/messages`]: messages,
}

/** Answer these API paths with these bodies; everything else goes to the real server. */
async function stub(page: Page, stubs: Stubs) {
  await page.setRequestInterception(true)
  page.on('request', (r) => {
    const u = new URL(r.url())
    const body =
      u.origin === new URL(base).origin && r.method() === 'GET' ? stubs[u.pathname] : null
    if (body)
      void r.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    else void r.continue()
  })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Click the first element matching `selector` whose text is `text`. */
async function click(page: Page, selector: string, text: string) {
  const ok = await page.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll<HTMLElement>(sel)].find(
        (e) => e.textContent?.trim() === t,
      )
      el?.click()
      return !!el
    },
    selector,
    text,
  )
  if (!ok) throw new Error(`no ${selector} saying “${text}”`)
  await wait(400)
}

const texts = (page: Page, selector: string) =>
  page.$$eval(selector, (els) => els.map((e) => e.textContent?.trim() ?? ''))

interface State {
  name: string
  url: string
  stubs?: Stubs
  /** sets the flag that lets ?break= work in a production build */
  testing?: boolean
  /** a boundary catching an error logs it on purpose */
  errorsExpected?: boolean
  /** reach the state and say what's wrong with it, if anything */
  run: (page: Page) => Promise<string[]>
}

const states: State[] = [
  {
    name: 'Composer with a LinkedIn job link',
    url: `${base}/#today`,
    stubs: { '/v1/profiles': profiles },
    async run(page) {
      await page.type(
        'input[aria-label="Company website or job link"]',
        'https://www.linkedin.com/jobs/view/4012345678',
      )
      await wait(400)
      const s = await page.evaluate(() => {
        const box = document.querySelector('.paste-job')
        const labels = [...(box?.querySelectorAll('label > span') ?? [])].map((e) => e.textContent)
        return {
          labels,
          focused: document.activeElement === box?.querySelector('textarea'),
          disabled: !!document.querySelector<HTMLButtonElement>('.ask button[type=submit]')
            ?.disabled,
        }
      })
      const out: string[] = []
      if (s.labels.join('|') !== 'Job description|Company website')
        out.push(`asks for “${s.labels.join(', ')}”, not the job description and website`)
      if (!s.focused) out.push('focus did not move to the job description box')
      if (!s.disabled) out.push('Make film is not disabled before the description is pasted')
      return out
    },
  },
  {
    name: 'Account menu, delete step',
    url: `${base}/#today`,
    stubs: { '/v1/profiles': profiles, '/v1/me': hostedMe },
    async run(page) {
      await page.click('button.me')
      await wait(300)
      await click(page, '.menu button', 'Delete my data')
      const danger = await texts(page, '.menu button.danger')
      return danger[0] === 'Delete everything' ? [] : ['the delete confirm step did not show']
    },
  },
  {
    name: 'Film panel messages',
    url: `${base}/#films`,
    stubs: withFilm,
    async run(page) {
      await page.click('button.card')
      await page.waitForSelector('.drawer [aria-label="Which message"]', { timeout: 5000 })
      const out: string[] = []
      const tabs = await texts(page, '[aria-label="Which message"] button')
      const want = ['Connection note', 'After they accept', 'InMail', 'Email', 'Follow-up']
      if (tabs.join('|') !== want.join('|')) out.push(`tabs read “${tabs.join(', ')}”`)
      const counted = (await texts(page, '.drawer p.small')).some((t) =>
        /\d+ of 200 characters/.test(t),
      )
      if (!counted) out.push('the connection note has no “N of 200 characters” counter')
      if ((await texts(page, '.draft-note summary')).length)
        out.push('a model draft with no notes shows a disclosure')
      await click(page, '[aria-label="Which message"] button', 'InMail')
      if ((await texts(page, '.draft-note summary')).join('|') !== 'What was changed')
        out.push('the adjusted InMail does not show only “What was changed”')
      await click(page, '[aria-label="Which message"] button', 'Email')
      if (
        (await texts(page, '.draft-note summary')).join('|') !== 'Why this is the template version'
      )
        out.push('the fallen-back email does not show only “Why this is the template version”')
      await page.evaluate(() => {
        for (const d of document.querySelectorAll('.draft-note')) d.setAttribute('open', '')
      })
      return out
    },
  },
  {
    name: 'Film panel homework',
    url: `${base}/#films`,
    stubs: {
      ...withFilm,
      [`/v1/films/${FILM}`]: {
        ...filmDetail,
        detail: 'the rate table took a minute to load on every page',
        built: { url: 'https://github.com/me/rates-sync', line: 'Syncs their rates into checkout' },
      },
    },
    async run(page) {
      await page.click('button.card')
      await page.waitForSelector('.drawer [aria-label="Which message"]', { timeout: 5000 })
      await click(page, '[aria-label="Which message"] button', 'Email')
      const box = await page.evaluate(() => {
        const el = document.querySelector('.your-homework')
        return {
          labels: [...(el?.querySelectorAll('label') ?? [])].map((l) => l.textContent?.trim()),
          inputs: el?.querySelectorAll('input').length ?? 0,
          buttons: [...(el?.querySelectorAll('button') ?? [])].map((b) => b.textContent?.trim()),
          text: el?.textContent ?? '',
          question: el?.querySelector<HTMLInputElement>('input[id^=question]')?.placeholder,
        }
      })
      const out: string[] = []
      if (box.labels.join('|') !== 'Something you noticed using it|Your question for them')
        out.push(`the homework box labels read “${box.labels.join(', ')}”`)
      if (!box.text.includes('Something you built with it'))
        out.push('the homework box has no “Something you built with it”')
      if (box.inputs !== 4) out.push(`the homework box has ${box.inputs} inputs, not 4`)
      if (box.buttons.join('|') !== 'Save your homework')
        out.push(`the homework box buttons read “${box.buttons.join(', ')}”`)
      if (!box.text.includes('The email opens with this.'))
        out.push('the homework box has no hint that the email opens with it')
      if (box.question !== 'Are most customers calling the API directly, or using the Shopify app?')
        out.push('the question has the wrong placeholder')
      return out
    },
  },
  {
    name: 'Profile editor, something you built',
    url: `${base}/#profile`,
    stubs: {
      '/v1/profiles': {
        data: [
          {
            ...profiles.data[0],
            data: {
              ...candidate,
              creator: {
                name: 'coldopen',
                url: 'https://github.com/me/coldopen',
                line: 'I built the tool that made this film',
              },
            },
          },
        ],
      },
    },
    async run(page) {
      await click(page, 'button', 'Edit profile')
      await wait(400)
      const s = await page.evaluate(() => {
        const set = [...document.querySelectorAll('fieldset')].find(
          (f) => f.querySelector('legend')?.textContent === 'Something you built',
        )
        return {
          found: !!set,
          hint: set?.querySelector('.hint')?.textContent?.replace(/\s+/g, ' ').trim(),
          values: [...(set?.querySelectorAll('input') ?? [])].map((i) => i.value),
        }
      })
      const out: string[] = []
      if (!s.found) return ['the profile editor has no “Something you built” section']
      if (
        s.hint !==
        'If you built the tool that made this film, say so. Messages and the end card can mention it.'
      )
        out.push(`the creator hint reads “${s.hint}”`)
      if (s.values[0] !== 'coldopen') out.push('the saved creator did not fill the section')
      return out
    },
  },
  {
    name: 'Film panel people tabs',
    url: `${base}/#films`,
    stubs: (() => {
      // a 6-person YC startup, with someone you know there: founders first, then warm paths
      const known = parseConnections(
        readFileSync(new URL('../fixtures/connections.csv', import.meta.url), 'utf8'),
      )
        .slice(0, 1)
        .map((c) => ({ ...c, company: 'Parcelpine' }))
      const groups = peopleSearches('Parcelpine', {
        jobTitle: 'Forward Deployed Engineer',
        profile: { ...candidate, schools: ['Duke University'] },
        yc: { batch: 'W25', slug: 'parcelpine' },
        team: 6,
        known,
      })
      return {
        ...withFilm,
        [`/v1/films/${FILM}/people`]: {
          company: 'Parcelpine',
          team: 6,
          groups,
          searches: flatSearches(groups),
          known,
          connections: 1,
        },
      }
    })(),
    async run(page) {
      await page.click('button.card')
      await page.waitForSelector('.drawer [aria-label="Who to reach"]', { timeout: 5000 })
      const out: string[] = []
      const tabs = await texts(page, '[aria-label="Who to reach"] button')
      const want = ['Founders', 'Warm paths', 'People doing the job', 'Recruiting']
      if (tabs.join('|') !== want.join('|')) out.push(`people tabs read “${tabs.join(', ')}”`)
      const open = await texts(page, '[aria-label="Who to reach"] button[aria-checked="true"]')
      if (open[0] !== 'Founders') out.push(`the people tabs open on “${open[0]}”, not Founders`)
      const shows = async (tab: string, want: RegExp) => {
        await click(page, '[aria-label="Who to reach"] button', tab)
        const body = (await texts(page, '.people-group')).join(' ')
        if (!want.test(body)) out.push(`the ${tab} tab doesn’t show ${want}`)
      }
      await shows('Founders', /Ask: What they’re building next.*Open YC page/)
      await shows(
        'Warm paths',
        /Ask: How they found it there.*Ask for an intro.*Duke University alumni/,
      )
      await shows('People doing the job', /Ask: What their first 90 days.*New grads/)
      await shows('Recruiting', /Ask: A short note.*Talent acquisition.*Head of people/)
      if ((await texts(page, '.people-group .who-list b')).includes('Recruiters') === false)
        out.push('the Recruiting tab has no Recruiters search')
      return out
    },
  },
  {
    name: 'Break the app',
    url: `${base}/?break=app#today`,
    testing: true,
    errorsExpected: true,
    async run(page) {
      const h = await texts(page, '.broke h1')
      const reload = await texts(page, '.broke button')
      return h[0]?.startsWith('Something on this page broke') && reload.includes('Reload')
        ? []
        : ['the app fallback did not show “Something on this page broke” with Reload']
    },
  },
  {
    name: 'Break a drawer',
    url: `${base}/?break=drawer#films`,
    stubs: withFilm,
    testing: true,
    errorsExpected: true,
    async run(page) {
      await page.click('button.card')
      await wait(600)
      const out: string[] = []
      if (await page.$('[role=dialog]')) out.push('the broken drawer stayed open')
      if (await page.$('.broke')) out.push('a broken drawer took the whole page down')
      if (!(await texts(page, '.toasts p')).some((t) => t.startsWith('That panel hit a problem')))
        out.push('no toast said the panel closed')
      if (!(await page.$('button.card'))) out.push('the page behind the drawer is gone')
      return out
    },
  },
  {
    name: 'A break link without the flag',
    url: `${base}/?break=app#today`,
    async run(page) {
      return (await page.$('.broke')) ? ['?break= works in a production build'] : []
    },
  },
]

for (const [width, dark] of [
  [1280, false],
  [375, false],
  [1280, true],
] as const) {
  for (const s of states) {
    const name = dark ? `${s.name} (dark)` : s.name
    const page = await browser.newPage()
    await page.setViewport({ width, height: 900 })
    await page.setBypassCSP(true)
    if (dark) await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
    if (s.testing)
      await page.evaluateOnNewDocument(() => {
        ;(window as unknown as { __coldopenAudit: boolean }).__coldopenAudit = true
      })
    if (s.stubs) await stub(page, s.stubs)
    const errors: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error' && !isNetworkNoise(m.text())) errors.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(s.url, { waitUntil: 'networkidle0' }).catch(() => null)
    await wait(600)
    const wrong = await s.run(page).catch((e: Error) => [e.message])
    for (const w of wrong)
      findings.push({ page: name, width, kind: 'state', detail: w, serious: true })
    if (!s.errorsExpected)
      for (const e of errors.slice(0, 5))
        findings.push({
          page: name,
          width,
          kind: 'console',
          detail: e.slice(0, 200),
          serious: true,
        })
    await inspect(page, name, width)
    await page.close()
  }
}
await browser.close()
close()

// one line per finding; a finding seen at both widths is listed once
const seen = new Set<string>()
for (const f of findings) {
  const k = `${f.page}|${f.kind}|${f.detail}`
  if (seen.has(k)) continue
  seen.add(k)
  console.log(`${f.serious ? 'SERIOUS' : 'minor  '} ${f.page} @${f.width}: ${f.kind} — ${f.detail}`)
}
const serious = findings.filter((f) => f.serious).length
console.log(
  `\n${pages.length} pages and ${states.length} states × desktop, phone and dark: ${serious} serious, ${findings.length - serious} minor`,
)
process.exit(serious ? 1 : 0)
