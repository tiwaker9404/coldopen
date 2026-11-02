# Roadmap

What's shipped, what's next, and why. Updated 2 November 2026 (evening). The reasoning behind each move is in
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
| 2 Nov    | **Public beta:** a clearer app (Today, Jobs, Films, Profile), a films board by stage, Sign in with Google                                                                               |
| 3 Nov    | **YC jobs (merging Tue):** 398 hiring YC startups in Jobs for you, a YC companies only filter, Sort by Hiring fastest, founder links for YC companies                                   |
| 2 Nov    | **Share page button:** Book 15 minutes (your booking link) or Reply, with presses counted next to plays                                                                                 |

## Next, in order

### Before launch (Tue 3 Nov; launch Wed 4 Nov, 9am Pacific)

1. Merge the YC batch and test it live.
2. Keep the app awake during launch hours: a free uptime ping every 10 minutes.
3. Load check: 470 boards on Render's 512 MB, and 50 films at once.
4. Model quota guard: per-visitor caps so launch traffic can't use up the day's free limits, with
   a friendly "busy, try again in 10 minutes".
5. Error alerts (Sentry's free plan).
6. If done by 3pm: **people you know** on each job row ("2 connections at Sierra") and a
   **posted within** filter (this week, this month). Otherwise they wait for after launch.

### Week of 4 Nov: sharper finding

7. **Sponsors visas:** a badge and filter from the Labor Department's free H-1B (LCA) data.
8. **Raised recently:** a badge and filter from SEC Form D filings.
9. **YC Work at a Startup links,** so YC companies without a public board still appear.
10. **Filters:** exclude companies, posted within (if it didn't make launch), pay range (from Ashby's salaries), team.
11. **People you know** on each job row, if it didn't make launch.
12. **Fit gaps:** the requirements your profile keeps missing, one click to add.

### 11 to 24 Nov: closing the loop

13. **Alerts:** new roles at companies you filmed and new matches, on Today and in a weekly email.
14. **Follow-ups that use views:** "watched to the end 2 days ago, no reply" brings the
    follow-up forward.
15. **They replied → interview brief:** the film's research as a one-page company brief and
    three questions to ask.
16. **Chrome extension:** a Make film button on any job post you're viewing.
17. The last follow-up can switch to LinkedIn; the dashboard's files served from Cloudflare.

### December onward

18. **Better films:** an optional clip of you, recorded once; voiceover; recent company news; two
    hooks per film to learn which wins.
19. A Pro plan (Stripe, test mode first), a career center pilot (Duke first), then the recruiting
    agency direction and the YC application.

## Keeping as is

The renderer (Puppeteer and ffmpeg), the durable Postgres job queue, Cloudflare share pages, the
API and the front-end stack: each is current, free, and works.

## Not doing

Auto-apply, résumé rewriting, sending email from coldopen, and reading people's Gmail for replies (Google's restricted-scope review costs money and weeks). The first three are crowded, paid everywhere, and work against quality over volume.
