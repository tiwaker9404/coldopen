# Roadmap

What's shipped, what's next, and why. Updated 13 November 2026.

## Where we stand

The product is wide now: jobs, YC startups, fit, films, send, follow-ups, MCP and CRM sync. For
now the main user is its maker, and his daily loop is:

1. Find an opening.
2. Make the film.
3. Find the founder or recruiter.
4. Connect on LinkedIn, then message them (sometimes InMail), or send a warm email.

Every batch below makes that loop better, and each one is small enough to ship in a week or two.

## Shipped

| When     | What                                                                                                                                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oct 2026 | Film from a company URL or a job link; email and LinkedIn note; who to reach; LinkedIn connections; share links with view tracking; hosted app on free plans                                                                                                                                          |
| 2 Nov    | Jobs for you, batch films, Fit check, Follow up today, Gemini as a third model, Send, public beta with Google sign-in, YC jobs, pay, visas, people you know, fit gaps, call briefs, the Chrome extension, Startups, the MCP server, HubSpot sync, the Hiring Index, OpenTelemetry and semantic fit    |
| 3 Nov    | Launch batch (warm paths, opener A/B, why-now, interview prep), Raised recently, the film-slate redesign ([BRAND.md](BRAND.md)), Pitch a role and the hiring film, Homework, related work, the developers page                                                                                        |
| 4 Nov    | Public beta launch; tables locked against Supabase's public API                                                                                                                                                                                                                                       |
| 13 Nov   | **Batch 1, Solid ground:** errors that read like a person wrote them, never code or a blank page; LinkedIn, Indeed and Glassdoor job links ask for the description up front; one Save for the whole profile, clean pasting, no lost GitHub picks; the GIF pastes into Gmail as a picture; GitHub tidy |

## Next, in order

| Batch                                | When         | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **2. The message that gets a reply** | 16–20 Nov    | The LinkedIn sequence: a connection note (200 characters, no link and no ask), a message once they accept, and InMail (subject and body). A warm email in a set structure: the opening, the film, one research line from their blog or changelog matched to the role, why you fit, and a 15-minute ask. Written by the model from the film's facts and checked in code (grounded numbers, no begging or referral words, one ask, length), with today's templates as the fallback |
| **3. Trust first**                   | 23 Nov–4 Dec | A stranger should see who sent it before they click. A sender card on the share page (name, LinkedIn, why you got this); a GIF-first email with the whole draft copied as rich text; link previews that name the sender; Download GIF for LinkedIn messages                                                                                                                                                                                                                      |
| **4. The perfect reel**              | December     | Review before sending: scene by scene, weak lines flagged, swap the featured fact (including a recent blog post), two hooks to pick from, and re-render one scene instead of the whole film                                                                                                                                                                                                                                                                                      |
| **5. The right person**              | December     | Hiring manager and recruiter suggestions from the post, the team page and the careers page, each with a confidence score                                                                                                                                                                                                                                                                                                                                                         |
| **Later**                            |              | Alerts and a weekly email; an optional clip of you or a voiceover; drafts of build-in-public posts from the changelog                                                                                                                                                                                                                                                                                                                                                            |

## Parked while it's mostly one user

Scaling and load-hardening, a Pro plan, a career center pilot and the recruiting agency direction.

## Keeping as is

The renderer (Puppeteer and ffmpeg), the durable Postgres job queue, Cloudflare share pages, the
API and the front-end stack: each is current, free, and works.

## Not doing

Auto-apply, résumé rewriting, sending email or LinkedIn messages for you, and reading people's
Gmail for replies (Google's restricted-scope review costs money and weeks). The first three are
crowded, paid everywhere, and work against quality over volume.
