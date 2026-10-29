# Hosting the public demo

The hosted app is the same coldopen, with `HOSTED=true`:

- **Visitors try it without an account.** One free film a day, kept for 7 days.
- **GitHub sign-in keeps their work.** Five films a day, kept for 30 days, and a list of companies at once. Anything made before signing in moves to the account.
- **Everyone sees only their own** films, profiles and views.
- **Limits protect the free tiers:** films per person, per network and for the whole app, and résumé drafts per person. When every model is rate limited, a film is written by the built-in writer instead of failing.
- **People can delete everything** they made, share links included.

It runs on free plans, with no card anywhere:

| Piece                       | Free service                                       | Notes                                                                                                                  |
| --------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| The web app and API         | Render, free web service                           | Sleeps after 15 minutes without visitors; the next visit wakes it in about a minute                                    |
| Rendering films             | GitHub Actions                                     | Free for public repositories. The app starts a job when someone makes a film; it renders everything queued, then stops |
| Database                    | Supabase                                           | Accounts, profiles, films, limits                                                                                      |
| Share links and their views | Cloudflare Workers, KV and D1 ([share/](../share)) | Set up with `pnpm share:setup` ([SHARING.md](SHARING.md))                                                              |
| Script writing              | Groq                                               |                                                                                                                        |
| Sign-in                     | A GitHub App                                       |                                                                                                                        |

A film takes 2 to 3 minutes from the click: about a minute for GitHub to start a runner, then the render. Allow about 40 minutes for the first setup. (Prefer one always-on server? See [On Oracle Cloud](#on-oracle-cloud) below.)

## 1. The database (Supabase, 5 minutes)

1. Create a project at [supabase.com](https://supabase.com) (sign in with GitHub, plan **Free**). Generate a database password and save it.
2. Click **Connect → Session pooler** and copy the URI, e.g. `postgresql://postgres.abcd:[YOUR-PASSWORD]@aws-0-us-west-1.pooler.supabase.com:5432/postgres`.
3. Put your password in place of `[YOUR-PASSWORD]` and add `?sslmode=require` at the end. That's your `DATABASE_URL`.

Use the session pooler, not the direct connection, which is IPv6 only. coldopen creates its tables on first start.

## 2. Let the app start GitHub Actions (3 minutes)

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Name:** `coldopen-render`. **Expiration:** 1 year. **Repository access:** only `tiwaker9404/coldopen`.
3. **Permissions → Repository permissions → Contents: Read and write.** Nothing else.
4. Generate and copy it (`github_pat_…`). That's `RENDER_DISPATCH_TOKEN`.

## 3. The renderer (GitHub Actions, 5 minutes)

In the repo: **Settings → Secrets and variables → Actions**.

- **Secrets** tab, **New repository secret** for each: `DATABASE_URL` (step 1), `LLM_API_KEY` (your Groq key), `SHARE_URL` (`https://coldopen-share.<you>.workers.dev`), `SHARE_TOKEN` (on a Mac: `security find-generic-password -a "$USER" -s coldopen-share-token -w | pbcopy`).
- **Variables** tab, **New repository variable:** `RENDER_FILMS` = `true`.

The **Render films for the hosted app** workflow now runs whenever a film is waiting. Its logs are public, like everything in a public repository, so it logs errors only.

## 4. The web app (Render, 10 minutes)

1. Sign up at [render.com](https://render.com) with GitHub (no card).
2. **New → Blueprint** → connect `tiwaker9404/coldopen` → it finds `render.yaml` → **Apply**.
3. It asks for the values marked secret. Fill in `DATABASE_URL`, `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (step 5 below; put placeholders now if you haven't made the GitHub App yet), `LLM_API_KEY`, `SHARE_URL`, `SHARE_TOKEN`, `RENDER_DISPATCH_TOKEN` (step 2). Leave `PUBLIC_URL` for a moment.
4. When the first deploy finishes, copy the service's address, e.g. `https://coldopen-ab12.onrender.com`. In **Environment**, set `PUBLIC_URL` to it and save; Render redeploys.

## 5. GitHub sign-in

Create a GitHub App (or OAuth App) under **Settings → Developer settings**:

- **Homepage URL:** your Render address.
- **Callback URL:** your Render address + `/auth/github/callback`.
- **Webhook:** off. **Permissions:** none. **Installable by:** any account.

Copy its **Client ID** and generate a **client secret**, and put both in Render's **Environment** (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`).

## 6. Try it

Open your Render address (give it a minute if it was asleep). You should see the three steps and "1 film left today". Upload a résumé, paste a company, make a film: the card says "Waiting for a renderer" while GitHub starts the job, then shows each stage. Sign in with GitHub and your film is still there.

If a film stays waiting for more than 5 minutes, open the repo's **Actions** tab and check the latest **Render films** run.

## On Oracle Cloud

One always-on server (4 cores, 24 GB) runs everything, including the database: no sleeping, and films render as soon as they're made. Oracle asks for a card to verify you; Always Free resources aren't charged. Free Ampere servers are often out of capacity, so creating one can take a few tries.

### 1. The server (15 minutes)

1. Sign up at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/).
   - **Home region:** pick one near you (for example US West, San Jose or Phoenix). It can't be changed later, and free servers only run in your home region.
   - The card is for identity verification. Stay on the Always Free resources below and nothing is charged.
2. In the console: **☰ → Compute → Instances → Create instance**.
   - **Name:** `coldopen`
   - **Image:** click **Edit → Change image → Ubuntu → Canonical Ubuntu 24.04**.
   - **Shape:** **Change shape → Ampere → VM.Standard.A1.Flex**, **4 OCPUs**, **24 GB** memory. It's labeled "Always Free-eligible".
   - **SSH keys:** **Generate a key pair for me → Save private key**. Keep the downloaded `.key` file.
   - Click **Create**. If it says **Out of capacity**, try again later or switch to another availability domain; Ampere capacity frees up through the day.
3. When it's **Running**, copy its **Public IP address**.
4. Open the web ports: on the instance page, click the **Subnet** link → **Security Lists** → the default list → **Add Ingress Rules**:
   - Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination Port Range `80,443` → **Add Ingress Rules**.

### 2. Log in to the server

On your Mac, in Terminal (use your key's file name and your IP):

```bash
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<PUBLIC-IP>
```

Type `yes` the first time. You're now on the server; the prompt changes to `ubuntu@coldopen`.

### 3. Install coldopen (first run of the script)

```bash
curl -fsSL https://raw.githubusercontent.com/tiwaker9404/coldopen/main/deploy/oracle/setup.sh | bash
```

It installs Docker, opens the firewall, downloads coldopen and writes a settings file with the secrets it can make itself. At the end it prints your address, for example `https://129-146-12-34.sslip.io`. [sslip.io](https://sslip.io) is a free name that points at your IP, so the app gets a real HTTPS certificate with no domain to buy.

### 4. Point GitHub sign-in at it

In your GitHub App's settings, set the **Callback URL** (or Redirect URI) to the address the script printed, plus `/auth/github/callback`:

```
https://129-146-12-34.sslip.io/auth/github/callback
```

Keep the App's **Client ID** and a **client secret** for the next step.

### 5. Fill in the five blanks

```bash
nano ~/coldopen/deploy/oracle/.env
```

| Line                   | Value                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_CLIENT_ID`     | the GitHub App's Client ID (starts with `Iv`)                                                                                                 |
| `GITHUB_CLIENT_SECRET` | its client secret                                                                                                                             |
| `LLM_API_KEY`          | your Groq key                                                                                                                                 |
| `SHARE_URL`            | your share worker, e.g. `https://coldopen-share.<you>.workers.dev`                                                                            |
| `SHARE_TOKEN`          | its upload token. On your Mac: `security find-generic-password -a "$USER" -s coldopen-share-token -w \| pbcopy` copies it without printing it |

Save with **Ctrl+O, Enter**, quit with **Ctrl+X**. The file is readable only by you.

### 6. Start it (second run of the script)

```bash
curl -fsSL https://raw.githubusercontent.com/tiwaker9404/coldopen/main/deploy/oracle/setup.sh | bash
```

The first build takes about 10 minutes (it installs Chromium). Then open the address. You should see the three steps and "1 film left today".

**Updating later:** `~/coldopen/deploy/oracle/update.sh` pulls the latest code from GitHub and restarts. Films, accounts and settings are kept.

**Logs:** `cd ~/coldopen/deploy/oracle && sudo docker compose logs -f app`

**A database elsewhere:** the database runs on the server by default. To use Supabase or Neon instead, add `DATABASE_URL=...?sslmode=require` to `.env` and run `update.sh`.

## Limits

Defaults you can change (in Render's **Environment**, or the server's `.env`): `ANON_DAILY_FILMS` (1), `USER_DAILY_FILMS` (5), `IP_DAILY_FILMS` (8), `GLOBAL_DAILY_FILMS` (80), `DAILY_DRAFTS` (6). The global cap keeps the app inside Groq's free daily tokens and Cloudflare's 1,000 free writes a day.

## What to expect

- **On Render and GitHub Actions,** a film takes 2 to 3 minutes, two at a time. The site sleeps after 15 quiet minutes and takes about a minute to wake. Supabase pauses a project idle for a week; open its dashboard to wake it.
- **On Oracle,** a film takes about a minute and nothing sleeps, but Oracle may reclaim a free server that uses almost no CPU for a week. If it's stopped, start it again from the console.
- **Your own films** keep working on your laptop as before. The hosted app is separate, with its own accounts.

## On Hugging Face Spaces (paid)

Docker Spaces now need a paid Hugging Face plan. If you have one, [deploy/huggingface](../deploy/huggingface) and the **Deploy the hosted demo** workflow push the app to a Space on every change to `main`. Use a Supabase database (session pooler, `?sslmode=require`), since a Space's disk is temporary.
