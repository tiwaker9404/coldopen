import { KEEP_DAYS } from './accounts.ts'

/**
 * The hosted app's privacy and terms page, in plain words. Every line describes what the code
 * does; change the page when the code changes.
 */
export function privacyPage(opts: {
  contact?: string
  repo: string
  updated: string
  /** the web app's Archivo file, so the page matches the app */
  font?: string
}): string {
  const { contact, repo, updated, font } = opts
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Privacy and terms · coldopen</title>
<meta name="description" content="What coldopen keeps, for how long, and who else sees it.">
<style>
${font ? `@font-face{font-family:'Archivo Variable';font-style:normal;font-display:swap;font-weight:100 900;font-stretch:62% 125%;src:url(${font}) format('woff2-variations')}` : ''}
:root{--bg:#eceee9;--surface:#fff;--ink:#17201c;--muted:#5b6661;--rule:#d4d9d3;--rec:#d6362a;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121614;--surface:#1a1f1d;--ink:#e9ede9;--muted:#a0aaa5;--rule:#2b322f;--rec:#f0574a;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 'Archivo Variable','Archivo',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:680px;margin:0 auto;padding:28px 20px 72px}
a{color:inherit;text-underline-offset:3px}
.home{display:inline-flex;align-items:center;gap:9px;font-weight:780;font-stretch:78%;font-size:22px;text-decoration:none}
.home i{width:9px;height:9px;border-radius:50%;background:var(--rec)}
h1{font-size:clamp(34px,6vw,48px);line-height:1.02;font-stretch:70%;font-weight:700;margin:44px 0 10px;letter-spacing:-.01em}
h2{font-size:21px;font-stretch:74%;font-weight:680;margin:36px 0 8px}
p,li{color:var(--ink)}
.lede{color:var(--muted);font-size:17px}
.updated{color:var(--muted);font-size:14px}
ul{padding-left:20px}
li{margin:6px 0}
table{width:100%;border-collapse:collapse;font-size:15px;margin:8px 0;background:var(--surface);border-radius:10px;overflow:hidden}
th,td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-weight:600;width:34%}
tr:last-child th,tr:last-child td{border-bottom:0}
</style></head><body><main>
<a class="home" href="/"><i aria-hidden="true"></i>coldopen</a>
<h1>Privacy and terms</h1>
<p class="lede">What coldopen keeps, for how long, and who else sees it. Written to match what the code does; the code is <a href="${repo}">open source</a> if you want to check.</p>
<p class="updated">Last updated ${updated}</p>

<h2>Your résumé</h2>
<p>When you upload a résumé, coldopen reads its text once to draft your profile, then discards the file and the text. To pick and word your results, the text is sent to <a href="https://groq.com/privacy-policy/">Groq</a>, the AI service that writes the drafts and scripts. Only the profile you save is kept, and you can edit or delete every line of it.</p>

<h2>What's kept, and for how long</h2>
<table>
<tr><th>Your profile</th><td>Your name, the role you want, your results and your contact line. Kept ${KEEP_DAYS.visitor} days after your last edit, or ${KEEP_DAYS.account} days if you sign in.</td></tr>
<tr><th>Your films</th><td>The video, its script, and the company it was made for. Kept ${KEEP_DAYS.visitor} days, or ${KEEP_DAYS.account} days if you sign in. The share link stops working at the same time.</td></tr>
<tr><th>Who watched</th><td>For each film's share page: when it was opened, played and watched to the end, on a phone or a computer, from which site (like linkedin.com), and the country. No IP address is stored: viewers are told apart by a one-way scrambled code that changes daily.</td></tr>
<tr><th>LinkedIn connections</th><td>Only if you upload them: names, profile links, companies and job titles, used to show who you know at a company. Email addresses in the file are dropped. Kept as long as your films are.</td></tr>
<tr><th>GitHub sign-in</th><td>Your GitHub username, name and profile picture, so your films follow you. Nothing else from GitHub, and coldopen can't see your repositories.</td></tr>
<tr><th>Daily counts</th><td>How many films you made today, to apply the free limits, and a count of visits for the app's own totals. Kept 90 days.</td></tr>
</table>
<p><b>Delete everything now:</b> open the account menu (top right) and choose Delete my data. Your profiles, films, share links and uploaded connections are deleted straight away.</p>

<h2>Cookies</h2>
<p>Only what the app needs to work: one remembers your films if you haven't signed in, one keeps you signed in, and a short-lived one protects the GitHub sign-in step. No advertising or tracking cookies, and no analytics service.</p>

<h2>Who else handles your data</h2>
<ul>
<li><b>Groq</b> writes profile drafts and film scripts from your résumé text, your profile and the company's website.</li>
<li><b>Supabase</b> stores profiles, films' details and counts (the database).</li>
<li><b>Cloudflare</b> serves share links, the videos and view counts.</li>
<li><b>Render</b> runs the website.</li>
<li><b>GitHub</b> handles sign-in, and its machines render the films. The machine is wiped after each run, and its public log records only how long a film took, not who or what it was for.</li>
</ul>
<p>Nothing is sold, and nothing is used for advertising.</p>

<h2>Company websites</h2>
<p>To make a film, coldopen visits the company's public homepage (and the job post, if you give one) like a browser would, and uses what's there: their colors, logo, a screenshot and a line or number from the page. It doesn't log in anywhere or read anything that isn't public.</p>

<h2>Using coldopen</h2>
<ul>
<li>It's free, with daily limits so it stays free. Features and limits may change.</li>
<li>You're responsible for what you send. Check every line of your film and message first.</li>
<li>Don't use it to pretend to be someone else, to claim results that aren't yours, or to send the same film to large lists of people who didn't ask for it.</li>
<li>It's provided as is. Sites that block automated browsers can't be filmed, and a film can fail.</li>
<li>The software is open source under the MIT license; you can <a href="${repo}">run your own copy</a>.</li>
</ul>

<h2>Questions</h2>
<p>${contact ? `Email <a href="mailto:${contact}">${contact}</a>, or open` : 'Open'} an issue on <a href="${repo}/issues">GitHub</a>.</p>
</main></body></html>`
}
