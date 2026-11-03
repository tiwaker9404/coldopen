# Security

## Reporting

Please report a vulnerability privately through GitHub: **Security → Report a vulnerability** on
this repository. I'll answer within a few days. Please don't open a public issue for it.

## What protects what

| Threat | Defense | Where |
|---|---|---|
| SSRF: making the server fetch internal addresses | The research browser checks navigation, redirects and every sub-request against private, loopback, link-local and mapped ranges; font downloads named by a site's CSS go through the same check with redirects refused | `src/brand/guard.ts`, `src/render/theme.ts` |
| Script injection into the render page | Only plain font weights, styles and base64 font data from a site's CSS reach the composition; text is escaped | `src/render/theme.ts`, `src/render/composition.ts` |
| XSS on served pages | CSP with a per-response nonce, `object-src 'none'`, `base-uri 'self'`; server-rendered text escaped; booking links must be https; dashboard links from outside data only http(s) or mailto | `src/api/security.ts`, `src/share/page.ts`, `dashboard/src/safe.ts` |
| Clickjacking | `frame-ancestors 'none'` and `X-Frame-Options: DENY` | `src/api/security.ts` |
| CSRF | Session cookies are `HttpOnly; SameSite=Lax`; state-changing requests on the cookie must come from the app's own origin | `src/api/accounts.ts`, `src/api/security.ts` |
| Reading someone else's films | Every film route loads the film by id *and* owner | `src/api/server.ts` (`ownFilm`) |
| Guessing share links | Share pages and files are served only for succeeded films, by random id; file names are allow-listed | `src/api/server.ts` |
| Brute force and abuse | Per-address rate limits (sign-in 30/min, view beacon 120/min, API 600/min); daily film limits per person, network and app | `src/api/security.ts`, `src/api/server.ts` |
| Stolen keys | API keys and access tokens stored as SHA-256 digests and compared in constant time; users' HubSpot and Hunter keys encrypted at rest (AES-256-GCM) and never sent back whole | `src/api/tokens.ts`, `src/api/keys.ts` |
| Leaky errors | 5xx responses say "internal error"; details go to the log only | `src/api/server.ts` |
| Supply chain | `pnpm audit` gate, Dependabot, CodeQL, gitleaks over the full history, read-only workflow tokens, frozen lockfile | `.github/` |

## Known and accepted

- **DNS rebinding.** A host can resolve to a public address for the guard and a private one for
  Chromium a moment later. A hosted instance for untrusted users should also run workers behind
  an egress firewall.
- **`glob` via `@fastify/static`** has two moderate advisories (ReDoS and an abort bypass). It
  only expands the app's own fixed patterns at startup, never user input; the CI gate is set
  to high.
- **`style-src 'unsafe-inline'`.** React and the share page set style attributes. Styles can't run
  script under this policy.
