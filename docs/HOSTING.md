# Hosting the public demo

The hosted app is the same coldopen, with `HOSTED=true`:

- **Visitors try it without an account.** One free film a day, kept for 7 days.
- **GitHub sign-in keeps their work.** Five films a day, kept for 30 days, and a list of companies at once. Anything made before signing in moves to the account.
- **Everyone sees only their own** films, profiles and views.
- **Limits protect the free tiers:** films per person, per network and for the whole app, and résumé drafts per person. When every model is rate limited, a film is written by the built-in writer instead of failing.
- **People can delete everything** they made, share links included.

It runs entirely on free plans, with no card on any of them:

| Piece                        | Free service                                       | What it holds                              |
| ---------------------------- | -------------------------------------------------- | ------------------------------------------ |
| The app (web, API, renderer) | Hugging Face Spaces, Docker                        | Nothing permanent; its disk is temporary   |
| Database                     | Supabase                                           | Accounts, profiles, films, limits          |
| Films and their views        | Cloudflare Workers, KV and D1 ([share/](../share)) | The video, poster and GIF, and who watched |
| Script writing               | Groq                                               | Nothing                                    |

## 1. The database (Supabase, 5 minutes)

1. Create a project at [supabase.com](https://supabase.com). Pick a region near you and save the database password.
2. Click **Connect**, then **Session pooler**, and copy the connection string. It looks like `postgresql://postgres.abcd:[YOUR-PASSWORD]@aws-0-us-west-1.pooler.supabase.com:5432/postgres`.
3. Put your password in it and add `?sslmode=require` at the end. That's your `DATABASE_URL`.

Use the session pooler, not the direct connection: the direct one is IPv6 only, and Spaces can't reach it. coldopen creates its tables on first start.

## 2. GitHub sign-in (3 minutes)

1. Go to GitHub **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. **Homepage URL:** `https://<your-username>-coldopen.hf.space`
3. **Authorization callback URL:** `https://<your-username>-coldopen.hf.space/auth/github/callback`
4. Create it, then **Generate a new client secret**. Keep the client ID and secret for step 4.

## 3. The Space (5 minutes)

1. Create a token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) with **Write** access.
2. Create a Space at [huggingface.co/new-space](https://huggingface.co/new-space): name `coldopen`, SDK **Docker**, blank template, hardware **CPU basic (free)**, public.
3. In the GitHub repo: **Settings → Secrets and variables → Actions**.
   - Add the secret `HF_TOKEN` (the token from step 1).
   - Add the variable `HF_SPACE` = `<your-username>/coldopen`.
4. Run **Actions → Deploy the hosted demo → Run workflow**. From then on, every push to `main` redeploys.

## 4. The Space's settings

In the Space: **Settings → Variables and secrets**. Add these as **secrets**:

| Name                                       | Value                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | from step 1                                                                                         |
| `SESSION_SECRET`                           | a long random string: `openssl rand -hex 32`                                                        |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | from step 2                                                                                         |
| `LLM_API_KEY`                              | your Groq key                                                                                       |
| `SHARE_URL`                                | your share worker, e.g. `https://coldopen-share.<you>.workers.dev`                                  |
| `SHARE_TOKEN`                              | its upload token (on a Mac: `security find-generic-password -a "$USER" -s coldopen-share-token -w`) |

And these as **variables**:

| Name                 | Value                                       |
| -------------------- | ------------------------------------------- |
| `PUBLIC_URL`         | `https://<your-username>-coldopen.hf.space` |
| `LLM_PROVIDER`       | `openai`                                    |
| `LLM_BASE_URL`       | `https://api.groq.com/openai/v1`            |
| `LLM_MODEL`          | `openai/gpt-oss-120b`                       |
| `LLM_FALLBACK_MODEL` | `openai/gpt-oss-20b`                        |

The Space restarts with each change. When it says **Running**, open `https://<your-username>-coldopen.hf.space` (the direct address, not the huggingface.co page around it, where sign-in can't work).

**Limits** have defaults you can change with variables: `ANON_DAILY_FILMS` (1), `USER_DAILY_FILMS` (5), `IP_DAILY_FILMS` (8), `GLOBAL_DAILY_FILMS` (80), `DAILY_DRAFTS` (6). The global cap keeps the app inside Groq's free daily tokens and Cloudflare's 1,000 free writes a day.

## What to expect from free plans

- **The Space sleeps** after 48 hours without visitors. The next visit wakes it in about a minute.
- **A film takes 1 to 2 minutes** on the free 2-CPU machine, one at a time. Others wait in line and the page shows where they are.
- **Supabase pauses** a project that's idle for a week. Open its dashboard to wake it.
- **The Space's disk is temporary.** That's why films are published to the share worker as soon as they're made, and why `SHARE_URL` is required for the hosted app.
