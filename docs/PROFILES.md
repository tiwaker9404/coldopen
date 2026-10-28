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
- **`--exclude`** leaves an employer (or any word) out entirely: `--exclude "Current Co"`. Every bullet under that job is dropped before anything is written.
- **`--contact`** sets the email or link on the last scene. The default is the email on your résumé.

### It can't inflate your résumé

The same rule as the films: the writer points at sources, and code checks them.

- Each proof item names the résumé bullet it came from. The number must appear in that bullet, character for character, and the label can only use numbers from that same bullet.
- The "where" must be an employer, school or project that's actually on the résumé.
- Strengths and the one-liner can't use numbers that aren't on the résumé, or describe things it doesn't mention.
- Anything the model can't ground after a rewrite is dropped, not softened. The CLI lists what it left out.

Without a model, a deterministic drafter reads common résumé phrasing into proof lines: "cut waste by 18%" becomes **18%: less waste**, "from 6 hours to 45 minutes" becomes **45 minutes: down from 6 hours**, "saved $1.2M a year" becomes **$1.2M: saved a year**. With a model (`--model`, see the README), the lines are shorter and better matched to the role.

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

| Field         | Limit                   | Shown in the film                                                                             |
| ------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `sender.name` |                         | Top of every scene, and the sign-off                                                          |
| `sender.role` |                         | Used by the writer to frame the pitch                                                         |
| `offer`       | 120 characters          | Seeds the pitch headline. The writer may tailor it, never extend it.                          |
| `points`      | 2 to 6                  | The writer picks 2 or 3 for the pitch and may reword them for the company                     |
| `proof`       | 1 to 8                  | 3 are shown, **word for word**: `value` (12 characters), `label` (60), `where` (40, optional) |
| `cta`         | `line` 60, `contact` 80 | The last scene                                                                                |

## Choosing which proof a film shows

By default the writer picks the 3 proof items that fit each company best. To choose yourself:

```bash
coldopen https://deel.com -p me.json --proof 3,2,7     # positions in your proof list, from 1
```

In the web app, the **Proof to show** chips under the composer do the same. The API takes `"proof": [2, 1, 6]` (zero-based) on `POST /v1/films` and `POST /v1/batches`.

## Keep it private

Profiles you make for yourself can hold your real email and employers. Name them `*.local.json`; the repository's `.gitignore` keeps them out of git.
