# Hosting the public demo

The hosted app is the same coldopen, with `HOSTED=true`:

- **Visitors try it without an account.** One free film a day, kept for 7 days.
- **GitHub sign-in keeps their work.** Five films a day, kept for 30 days, and a list of companies at once. Anything made before signing in moves to the account.
- **Everyone sees only their own** films, profiles and views.
- **Limits protect the free tiers:** films per person, per network and for the whole app, and résumé drafts per person. When every model is rate limited, a film is written by the built-in writer instead of failing.
- **People can delete everything** they made, share links included.

It runs on free plans:

| Piece                        | Free service                                       | Notes                                                                                                                   |
| ---------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The app, its database, HTTPS | Oracle Cloud Always Free                           | An always-on server with 4 cores and 24 GB. A card is asked for to verify you; Always Free resources are never charged. |
| Share links and their views  | Cloudflare Workers, KV and D1 ([share/](../share)) | No card. Set up with `pnpm share:setup` ([SHARING.md](SHARING.md)).                                                     |
| Script writing               | Groq                                               | No card.                                                                                                                |
| Sign-in                      | A GitHub App                                       | Free.                                                                                                                   |

Allow about 45 minutes the first time.

## 1. The server (Oracle Cloud, 15 minutes)

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

## 2. Log in to the server

On your Mac, in Terminal (use your key's file name and your IP):

```bash
chmod 600 ~/Downloads/ssh-key-*.key
ssh -i ~/Downloads/ssh-key-*.key ubuntu@<PUBLIC-IP>
```

Type `yes` the first time. You're now on the server; the prompt changes to `ubuntu@coldopen`.

## 3. Install coldopen (first run of the script)

```bash
curl -fsSL https://raw.githubusercontent.com/tiwaker9404/coldopen/main/deploy/oracle/setup.sh | bash
```

It installs Docker, opens the firewall, downloads coldopen and writes a settings file with the secrets it can make itself. At the end it prints your address, for example `https://129-146-12-34.sslip.io`. [sslip.io](https://sslip.io) is a free name that points at your IP, so the app gets a real HTTPS certificate with no domain to buy.

## 4. Point GitHub sign-in at it

In your GitHub App's settings, set the **Callback URL** (or Redirect URI) to the address the script printed, plus `/auth/github/callback`:

```
https://129-146-12-34.sslip.io/auth/github/callback
```

Keep the App's **Client ID** and a **client secret** for the next step.

## 5. Fill in the five blanks

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

## 6. Start it (second run of the script)

```bash
curl -fsSL https://raw.githubusercontent.com/tiwaker9404/coldopen/main/deploy/oracle/setup.sh | bash
```

The first build takes about 10 minutes (it installs Chromium). Then open the address. You should see the three steps and "1 film left today".

**Updating later:** `~/coldopen/deploy/oracle/update.sh` pulls the latest code from GitHub and restarts. Films, accounts and settings are kept.

**Logs:** `cd ~/coldopen/deploy/oracle && sudo docker compose logs -f app`

**A database elsewhere:** the database runs on the server by default. To use Supabase or Neon instead, add `DATABASE_URL=...?sslmode=require` to `.env` and run `update.sh`.

## Limits

Defaults you can change in `.env`: `ANON_DAILY_FILMS` (1), `USER_DAILY_FILMS` (5), `IP_DAILY_FILMS` (8), `GLOBAL_DAILY_FILMS` (80), `DAILY_DRAFTS` (6). The global cap keeps the app inside Groq's free daily tokens and Cloudflare's 1,000 free writes a day.

## What to expect

- **A film takes about a minute,** two at a time. Others wait in line and the page shows where they are.
- **Oracle may reclaim an idle free server:** one that uses almost no CPU for a week. Regular visitors keep it busy; if it's stopped, start it again from the console.
- **Your own films** keep working on your laptop as before. The hosted app is separate, with its own accounts.

## On Hugging Face Spaces (paid)

Docker Spaces now need a paid Hugging Face plan. If you have one, [deploy/huggingface](../deploy/huggingface) and the **Deploy the hosted demo** workflow push the app to a Space on every change to `main`. Use a Supabase database (session pooler, `?sslmode=require`), since a Space's disk is temporary.
