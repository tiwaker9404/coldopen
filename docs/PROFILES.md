# Profiles: who the film is from

A profile is everything the film says about you: your name, the role you want (or the product you sell), one line on what you bring, a few strengths, and your proof. It's a small JSON file, or a form in the web app.

coldopen works for any role, not only engineering. The film's structure is the same for a data analyst, a product designer or a recruiter: their homepage, a fact from their site, what you bring, your proof, one ask.

## Start from your résumé

```bash
coldopen profile resume.pdf priya.json --role "Senior data analyst"
```

Or, in the web app, choose **New profile → Start from your résumé**.

- **Formats:** PDF, Word (.docx), Markdown and plain text. A scanned image PDF has no text to read; export a text PDF instead.
- **`--role`** is the job you're applying for. It decides which of your bullets become proof, so one résumé can produce an "analyst" profile and a "data engineer" profile.
- **`--exclude`** keeps an employer (or any word) out: `--exclude "Current Co"`. The employer's name never appears, but its work stays, placed by your role there: proof from the job you still have says **Current FDE role** (an earlier one says **Data analyst role**). A bullet that names an excluded word itself is dropped. A résumé that already says `[Current employer, left out]` in the employer's place is read the same way, without `--exclude`.
- **`--contact`** sets the email or link on the last scene. The default is the email on your résumé.

### Proof a stranger understands

The person watching your film has never seen your résumé, so each proof card says four things: the number, the result, **what you did**, and where.

|              |                                                    |
| ------------ | -------------------------------------------------- |
| Number       | **6h → 45m**                                       |
| Result       | daily client data sync, from 6 hours to 45 minutes |
| What you did | Built containerized ETL with Docker and PostgreSQL |
| Where        | Rail Inc.                                          |

- **What you did** starts with a plain verb and names what you built, in your bullet's own words. Résumé padding ("leveraged", "orchestrated", "relative to the legacy baseline") is dropped.
- **A before and an after are both kept.** "From 6 hours to 45 minutes" becomes **6h → 45m**, never **6** or **45 minutes** alone. "By 2 days against the 5-day baseline" becomes **5 → 3 days**; the 3 is the one number a card may show that the bullet doesn't, because it's worked out from the two that it does.
- **The most impressive come first:** a before and after, then big scale (millions of records, thousands a day), then the rest. The film shows the first 3 that fit the company.

Every card is checked in code (`readableProof` in `src/profile/proof.ts`): it says what was done, has a result, keeps the before and after, says where, uses only the bullet's numbers, names no excluded employer, and fits its limits. A card the model still gets wrong after a rewrite is rebuilt from the bullet's own words. The [résumé eval](../evals/resume/results.md) measures this on a real résumé with hand-checked answers.

### It can't inflate your résumé

The same rule as the films: the writer points at sources, and code checks them.

- Each proof item names the résumé bullet it came from. Its numbers must appear in that bullet, and the label and "what you did" can only use numbers from that same bullet.
- The "where" must be an employer, school or project that's actually on the résumé.
- Strengths and the one-liner can't use numbers that aren't on the résumé, or describe things it doesn't mention.
- Anything the model can't ground after a rewrite is dropped, not softened. The CLI lists what it left out.

Without a model, a deterministic drafter reads common résumé phrasing into proof cards: "cut waste by 18%" becomes **18%: less waste**, "report prep from 6 hours to 20 minutes" becomes **6h → 20m: report prep time, from 6 hours to 20 minutes**, and "Engineered an automated Python pipeline migrating 1.5M records" gives _Built an automated Python pipeline_ as what you did. With a model (`--model`, see the README), the lines are shorter and better matched to the role.

Either way, **read every line before you send a film.** It's your name on it.

## Or start from an example

[profiles/examples](../profiles/examples) has a starting point for each of these, written for a fictional person:

| File                        | Role                             |
| --------------------------- | -------------------------------- |
| `data-analyst.json`         | Senior data analyst              |
| `data-scientist.json`       | Data scientist                   |
| `product-manager.json`      | Product manager                  |
| `product-designer.json`     | Product designer                 |
| `growth-marketer.json`      | Lifecycle marketing manager      |
| `customer-success.json`     | Customer success manager         |
| `recruiter.json`            | Technical recruiter              |
| `../candidate.example.json` | Software engineer                |
| `../sales.example.json`     | Founder or SDR selling a product |

Copy one, replace every line with your own, and keep the shape.

## The fields

| Field         | Limit                   | Shown in the film                                                                                                                                             |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sender.name` |                         | Top of every scene, and the sign-off                                                                                                                          |
| `sender.role` |                         | Used by the writer to frame the pitch                                                                                                                         |
| `offer`       | 120 characters          | Seeds the pitch headline. The writer may tailor it, never extend it.                                                                                          |
| `points`      | 2 to 6                  | The writer picks 2 or 3 for the pitch and may reword them for the company                                                                                     |
| `proof`       | 1 to 8                  | 3 are shown, **word for word**: `value` (12 characters), `label` (60), `did` (12 to 90, optional: what you did, starting with a verb), `where` (40, optional) |
| `cta`         | `line` 60, `contact` 80 | The last scene                                                                                                                                                |

## Choosing which proof a film shows

By default the writer picks the 3 proof items that fit each company best. To choose yourself:

```bash
coldopen https://deel.com -p me.json --proof 3,2,7     # positions in your proof list, from 1
```

In the web app, the **Proof to show** chips under the composer do the same. The API takes `"proof": [2, 1, 6]` (zero-based) on `POST /v1/films` and `POST /v1/batches`.

## Answer a job post

Give coldopen the job you're applying for and the film answers it:

```bash
coldopen https://deel.com -p me/ --job https://job-boards.greenhouse.io/deel/jobs/123
coldopen https://deel.com -p me/ --job deel-fde.txt      # the description, pasted into a file
```

- **The hook** says which role: _"For your Forward Deployed Engineer role"_.
- **The middle scene** quotes one requirement from the post, word for word, and answers it with your record. _"Turn messy customer data into reliable pipelines"_ is answered with _"I did this at Rail Inc.: 50 GB of supply-chain data a day"_.
- **The pitch and proof** lead with what fits the role.
- **With a profile folder,** the job's title and requirements decide which profile fits, not just the homepage.

**What it reads.** Company careers pages and the common job boards (Greenhouse, Lever, Ashby, Workable). It takes the requirements and the "what you'll do" lists, and leaves out benefits, pay and legal text. LinkedIn, Indeed and Glassdoor job pages need a login, so paste the description instead: in the web app, the box for it opens as soon as you paste one of those links; from the CLI, put it in a `.txt` file.

**What it won't do.** The answer has to come from your profile. The job's numbers are what they want, not what you've done: if the post says "3+ years", the film can't say you have 3 years unless your profile does. When nothing on your record plainly matches, the film says _"My closest match"_ instead of _"I did this"_.

In the web app, choose **Answer a job post** under the website box and paste the link or the description. In a CSV batch, add a `job` column. The API takes `"job": {"url": "..."}` or `"job": {"text": "..."}` on `POST /v1/films`.

## Several résumés: one profile each

If you apply to different kinds of roles, keep one profile per résumé in a folder and point coldopen at the folder:

```bash
coldopen profile analyst-resume.pdf me/analyst.json --role "Financial data analyst"
coldopen profile swe-resume.pdf me/engineer.json --role "Software engineer"

coldopen https://deel.com -p me/
```

coldopen reads the company's site once, ranks your profiles by what the site talks about, and asks which to use:

```
  Which profile for Deel?
   1. fde        Forward deployed engineer    <- best: their site mentions platform, ai, customers, enterprise
   2. product    Product manager              their site mentions product, teams
   3. analyst    Financial data analyst       weak match: payroll
  Choose 1-3 [1]:
```

- `--use analyst` skips the question and uses that profile.
- `--yes` takes the best match without asking. This is also what happens when coldopen isn't run in a terminal.
- In a CSV batch, add a `profile` column to choose per row. Rows without one get the best match.
- Each profile makes its own film, so trying a company with two profiles never overwrites the first.

The ranking only counts words that are actually on the company's site, and it shows you which ones, so you can always see why it suggested what it did.

## Keep it private

Profiles you make for yourself can hold your real email and employers. Name them `*.local.json`, or keep them in a folder named `*.local/`; the repository's `.gitignore` and `.dockerignore` keep both out of git and out of images.
