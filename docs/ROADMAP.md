# Roadmap

What's shipped, what's next, and why. Updated 3 November 2026. The reasoning behind each move is in
the unit-by-unit review against the leaders in each category (Jobright, Teal, Sendspark, Apollo,
Huntr and others).

## Shipped

| When     | What                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Oct 2026 | Film from a company URL or a job link; email and LinkedIn note; who to reach; LinkedIn connections; share links with view tracking; hosted app on free plans                                                                                                                         |
| 2 Nov    | **Jobs for you:** open roles from 70 companies' public job boards, ranked by role, place and recency                                                                                                                                                                                 |
| 2 Nov    | **Make several films at once** from Jobs for you                                                                                                                                                                                                                                     |
| 2 Nov    | **Fit check:** strong, good or stretch per job, with the requirement you answer best                                                                                                                                                                                                 |
| 2 Nov    | **Follow up today:** a nudge at day 4, a last note at day 11, then mark no reply                                                                                                                                                                                                     |
| 2 Nov    | **Gemini as a third model**, after both Groq models                                                                                                                                                                                                                                  |
| 2 Nov    | **Send:** who each film is for (drafts greet them, follow-ups open addressed); find their email with your own Hunter key or the usual patterns; intro requests to people you know there                                                                                              |
| 2 Nov    | **Public beta:** a clearer app (Today, Jobs, Films, Profile), a films board by stage, Sign in with Google                                                                                                                                                                            |
| 3 Nov    | **YC jobs (merging Tue):** 398 hiring YC startups in Jobs for you, a YC companies only filter, Sort by Hiring fastest, founder links for YC companies                                                                                                                                |
| 3 Nov    | **Launch batch:** warm paths (alumni of your schools, people from past teams); two email openers, half and half, with What's working on Today; a why-now line for companies that raised this quarter; interview prep in the call brief; the reply rate on the landing page's counter |
| 2 Nov    | **Share page button:** Book 15 minutes (your booking link) or Reply, with presses counted next to plays                                                                                                                                                                              |

## Next, in order

### Week of 4 Nov (after the launch on 4 Nov, 9am Pacific)

1. Fix what launch breaks; talk to the first users.
2. **Raised recently:** a badge and filter from SEC Form D filings.
3. **YC Work at a Startup links,** so YC companies without a public board still appear.
4. **Newer visa data:** USCIS's downloadable data stops at fiscal year 2023; add the Labor
   Department's H-1B filings for 2025.

### 11 to 24 Nov: closing the loop

5. **Alerts:** new roles at companies you filmed and new matches, on Today and in a weekly email.
6. **Chrome extension:** a Make film button on any job post you're viewing.
7. The last follow-up can switch to LinkedIn; the dashboard's files served from Cloudflare.

### December onward

8. **Better films:** an optional clip of you, recorded once; voiceover; recent company news; two
   hooks inside the film itself, building on the two email openers.
9. A Pro plan (Stripe, test mode first), a career center pilot (Duke first), then the recruiting
   agency direction and the YC application.

## Keeping as is

The renderer (Puppeteer and ffmpeg), the durable Postgres job queue, Cloudflare share pages, the
API and the front-end stack: each is current, free, and works.

## Not doing

Auto-apply, résumé rewriting, sending email from coldopen, and reading people's Gmail for replies (Google's restricted-scope review costs money and weeks). The first three are crowded, paid everywhere, and work against quality over volume.
