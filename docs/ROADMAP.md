# Roadmap

What's shipped, what's next, and why. Updated 10 November 2026.

## Where we stand

The product is wide now: jobs, YC startups, fit, films, send, follow-ups, MCP and CRM sync. For
now the main user is its maker, and his daily loop is:

1. Find an opening.
2. Make the film.
3. Find the founder or recruiter.
4. Connect on LinkedIn, then message them (sometimes InMail), or send a warm email.

Every batch below made that loop better. After batch 3, coldopen is in maintenance: the data
refreshes, the hosted app and the demo keep running, bugs get fixed, and the batches under
"Next" are parked until there's a reason to pick them up.

## Shipped

| When     | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oct 2026 | Film from a company URL or a job link; email and LinkedIn note; who to reach; LinkedIn connections; share links with view tracking; hosted app on free plans                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2 Nov    | Jobs for you, batch films, Fit check, Follow up today, Gemini as a third model, Send, public beta with Google sign-in, YC jobs, pay, visas, people you know, fit gaps, call briefs, the Chrome extension, Startups, the MCP server, HubSpot sync, the Hiring Index, OpenTelemetry and semantic fit                                                                                                                                                                                                                                                                                                                                                 |
| 3 Nov    | Launch batch (warm paths, opener A/B, why-now, interview prep), Raised recently, the film-slate redesign ([BRAND.md](BRAND.md)), Pitch a role and the hiring film, Homework, related work, the developers page                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4 Nov    | Public beta launch; tables locked against Supabase's public API                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 9 Nov    | **Batch 1, Solid ground:** errors that read like a person wrote them, never code or a blank page; LinkedIn, Indeed and Glassdoor job links ask for the description up front; one Save for the whole profile, clean pasting, no lost GitHub picks; the GIF pastes into Gmail as a picture; GitHub tidy                                                                                                                                                                                                                                                                                                                                              |
| 9 Nov    | **Batch 2, The message that gets a reply:** the LinkedIn sequence (a 200-character connection note with no link and no ask, a message once they accept, and an honestly labeled InMail); a five-part warm email with one research line from their own blog or changelog; written by the model from the film's facts and checked in code (length, grounded numbers, no begging, one ask, the company named, links, research, the film once), with templates that pass the same checks as the fallback; follow-ups that no longer beg; the film panel in send order with why a draft fell back; a real-model eval (every kind falls back at most 8%) |
| 10 Nov   | **Batch 3, The showcase:** a [demo](https://tiwaker9404.github.io/coldopen/demo/) of the real app on a recorded account with a 90-second tour, no sign-in and no cold start; films that no longer read as a template (each company gets its own greeting, pivot and headline, the homepage framed in square, wide and tall, the tall GIF under 1.4 MB); four 30-second role reels made by the engine; a hand-run eval of brand extraction on 20 live homepages; [docs/GTM.md](GTM.md) and a front door for hiring managers in the README                                                                                                           |

## Next, in order (parked)

| Batch                   | When | What                                                                                                                                                                                                                                                        |
| ----------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **4. Trust first**      |      | A stranger should see who sent it before they click. A sender card on the share page (name, LinkedIn, why you got this); a GIF-first email with the whole draft copied as rich text; link previews that name the sender; Download GIF for LinkedIn messages |
| **5. The perfect reel** |      | Review before sending: scene by scene, weak lines flagged, swap the featured fact (including a recent blog post), two hooks to pick from, and re-render one scene instead of the whole film                                                                 |
| **6. The right person** |      | Hiring manager and recruiter suggestions from the post, the team page and the careers page, each with a confidence score                                                                                                                                    |
| **Later**               |      | Alerts and a weekly email; an optional clip of you or a voiceover; drafts of build-in-public posts from the changelog                                                                                                                                       |

## Parked while it's mostly one user

Scaling and load-hardening, a Pro plan, a career center pilot and the recruiting agency direction.

## Keeping as is

The renderer (Puppeteer and ffmpeg), the durable Postgres job queue, Cloudflare share pages, the
API and the front-end stack: each is current, free, and works.

## Not doing

Auto-apply, résumé rewriting, sending email or LinkedIn messages for you, and reading people's
Gmail for replies (Google's restricted-scope review costs money and weeks). The first three are
crowded, paid everywhere, and work against quality over volume.
