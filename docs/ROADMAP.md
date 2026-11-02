# Roadmap

What's shipped, what's next, and why. Updated 2 November 2026. The reasoning behind each move is in
the unit-by-unit review against the leaders in each category (Jobright, Teal, Sendspark, Apollo,
Huntr and others).

## Shipped

| When     | What                                                                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Oct 2026 | Film from a company URL or a job link; email and LinkedIn note; who to reach; LinkedIn connections; share links with view tracking; hosted app on free plans                            |
| 2 Nov    | **Jobs for you:** open roles from 70 companies' public job boards, ranked by role, place and recency                                                                                    |
| 2 Nov    | **Make several films at once** from Jobs for you                                                                                                                                        |
| 2 Nov    | **Fit check:** strong, good or stretch per job, with the requirement you answer best                                                                                                    |
| 2 Nov    | **Follow up today:** a nudge at day 4, a last note at day 11, then mark no reply                                                                                                        |
| 2 Nov    | **Gemini as a third model**, after both Groq models                                                                                                                                     |
| 2 Nov    | **Send:** who each film is for (drafts greet them, follow-ups open addressed); find their email with your own Hunter key or the usual patterns; intro requests to people you know there |
| 2 Nov    | **Share page button:** Book 15 minutes (your booking link) or Reply, with presses counted next to plays                                                                                 |

## Next, in order

1. **Fit: close the gaps.** The requirement words your profile keeps missing across suggestions,
   one click to add; ignore a requirement that doesn't apply.
2. **Find: filters and people you know.** Posted within, team, exclude companies, sponsorship;
   "2 connections at Sierra" on the row; alerts for new matching roles.
3. **Follow up:** the last note can switch to LinkedIn; reply rate with and without follow-ups.
4. **UI/UX redesign,** after studying best-in-class products: clearer profiles and search
   options, stronger contrast, a board of films by stage.
5. **Platform:** Sign in with Google; serve the dashboard's files from Cloudflare (Render's free
   plan includes 5 GB of bandwidth a month).
6. **Later:** an optional clip of you, recorded once, as the film's opener or closer; a Pro plan;
   a career center pilot.

## Keeping as is

The renderer (Puppeteer and ffmpeg), the durable Postgres job queue, Cloudflare share pages, the
API and the front-end stack: each is current, free, and works.

## Not doing

Auto-apply, résumé rewriting and sending email from coldopen. They're crowded, paid everywhere,
and work against quality over volume.
