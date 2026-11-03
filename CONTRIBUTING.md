# Contributing to coldopen

Thanks for wanting to build on coldopen. Small, focused changes are the easiest to review and the quickest to ship.

## Set up (about five minutes)

You need Node 22.18 or newer, pnpm, ffmpeg, and Docker for the test database.

```bash
git clone https://github.com/tiwaker9404/coldopen
cd coldopen
pnpm install
pnpm db:test          # a throwaway Postgres for the tests
pnpm test             # unit, integration and runtime tests
pnpm evals            # script and design quality checks
```

Make a film with no server and no model, from the fictional fixture companies:

```bash
pnpm fixtures &                                   # serves northwind, lumen and parcelpine
pnpm film http://127.0.0.1:4100/northwind/ -p profiles/candidate.example.json
```

## Where things live

| Area                                                 | Files                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| Reading a company's site                             | `src/brand/extract.ts`, `src/brand/homework.ts`                       |
| Reading a job post                                   | `src/job/`                                                            |
| Writing the script, and the checks every line passes | `src/script/writer.ts`, `src/script/checks.ts`, `src/script/taste.ts` |
| The six scenes and how they're drawn                 | `src/script/storyboard.ts`, `src/render/composition.ts`               |
| Rendering, frame by frame                            | `src/render/render.ts`                                                |
| The durable runtime (journal, leases, replays)       | `src/runtime/`                                                        |
| The API and MCP server                               | `src/api/`                                                            |
| The app                                              | `dashboard/src/`                                                      |
| Share pages (Cloudflare Worker)                      | `share/`, `src/share/page.ts`                                         |

## Starter projects

Pick one and open an issue with the **Starter project** template to claim it:

1. **A new scene**, like a customer quote over their logo: `src/script/storyboard.ts`, `src/render/composition.ts`.
2. **A new writer preset**, like a founder raising or a student asking for a coffee chat: `src/script/types.ts`, `src/script/writer.ts`, `src/script/checks.ts`.
3. **A new job board**, like Workable, SmartRecruiters or Recruitee: `src/jobs/boards.ts`, `test/unit/jobs.test.ts`.
4. **A 4:5 format** for LinkedIn's feed: `src/render/composition.ts`, `src/film.ts`.
5. **A sharper brand read** on sites that hide their brand in images or CSS variables: `src/brand/extract.ts`, `src/brand/color.ts`.
6. **More homework**, like a company's YouTube channel feed or their GitHub releases: `src/brand/homework.ts`, `test/unit/homework.test.ts`.

## The rules the product keeps

These are why replies come in; a change that breaks one won't be merged.

- **Nothing invented.** Every number and quote on screen comes from the company's site, the job post or the sender's own profile, and code checks it.
- **Nothing sent for you.** coldopen makes films and drafts; a person decides what goes out.
- **Free to run.** No new paid service. A feature that needs one stays optional and off by default.
- **Plain words.** Sentence case, no hype, no exclamation marks (see `src/script/taste.ts`).

## Before you open a pull request

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm test && pnpm evals
```

Add a test for what you changed. For anything visual, attach a frame or a short clip of a fixture film.
