# Self-hosting for free

coldopen needs three things: a machine that runs Chromium and ffmpeg, a Postgres database, and (if share links or Slack should work for other people) a public URL. Every piece can be free.

## On your own computer

The simplest setup, and it works well for one person or a small team:

```bash
docker compose up --build
```

To make share pages and Slack reach your laptop, use a free tunnel. [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) is the usual choice:

```bash
cloudflared tunnel --url http://localhost:8080
# then set PUBLIC_URL to the https://...trycloudflare.com address it prints
```

Quick tunnels get a new address each run. For a stable address, create a named tunnel on a domain you own.

## On a free server

- **Oracle Cloud Always Free.** An Ampere (ARM) VM with 2 OCPUs and 12 GB of RAM is free. That's enough for the API plus one or two renderers. Oracle cut this allowance from 4 OCPUs and 24 GB in June 2026, so check the [current limits](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm) before you plan around more. Install Docker, clone the repo, and run `docker compose up -d`. The image builds for ARM as-is.
- **Neon.** Its [free Postgres plan](https://neon.com/pricing) needs no card. Set `DATABASE_URL` to the Neon connection string and remove the `postgres` service from compose. The database is small, since films are stored on disk and only metadata and journals go in Postgres.

## Sizing

- One renderer turns out roughly one 30-second film per minute on two CPU cores. Rendering is CPU-bound in Chromium's compositor.
- Set `WORKER_CONCURRENCY` to about half your cores, and give each worker about 1 GB of shared memory (`shm_size`) for Chromium.
- Films are about 3 MB each plus about 1.5 MB for the GIF. For a 500-prospect batch, plan on 2.5 GB of disk.

## Settings

| Variable                                   | Default                 | What it does                                                                       |
| ------------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`                             | local Postgres          | Postgres 13+                                                                       |
| `FILMS_DIR`                                | `./films`               | Where films are written. Use a shared volume when workers run on several hosts.    |
| `PUBLIC_URL`                               | `http://localhost:8080` | Base URL for share links, email GIFs and Slack messages                            |
| `API_KEYS`                                 | empty (no auth)         | Comma-separated keys for the REST API and web app                                  |
| `LLM_PROVIDER`                             | `none`                  | `none` uses the built-in writer; `openai` uses any OpenAI-compatible API           |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | Ollama, `qwen2.5:7b`    | The model endpoint, when `LLM_PROVIDER=openai`                                     |
| `WORKER_CONCURRENCY`                       | `2`                     | Films rendered at once per worker                                                  |
| `LEASE_MS`                                 | `60000`                 | How long a worker can go silent before its film is given to another worker         |
| `ALLOW_PRIVATE_NETWORKS`                   | `false`                 | Let the research browser open localhost or intranet sites. Local development only. |
| `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`  | unset                   | Turns on the Slack bot ([SLACK.md](SLACK.md))                                      |
| `CHROME_PATH`                              | Puppeteer's Chrome      | Use a system Chrome or Chromium instead                                            |
