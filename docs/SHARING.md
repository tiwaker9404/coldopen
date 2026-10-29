# Share links: know who watched

Every film gets a share page: the film, your one ask, and a reply button. coldopen tells you who opened it, who pressed play, how far they got, and whether they finished, so you follow up with the people who watched first.

You can host share pages two ways:

|           | Free share links on Cloudflare             | The coldopen server                               |
| --------- | ------------------------------------------ | ------------------------------------------------- |
| For       | The CLI: job seekers, founders, one person | Teams running `docker compose`                    |
| Cost      | Free (Cloudflare's free plan, no card)     | Whatever you host it on                           |
| Setup     | `pnpm share:setup`, once                   | Set `PUBLIC_URL`                                  |
| See views | `coldopen views`                           | Web app, `GET /v1/films/:id/views`, `results.csv` |

## What counts as a view

- **Opened**: a person loaded the page.
- **Played**: they pressed play. This is the number to follow up on.
- **Finished**: they reached 90% of the film.
- **People**: distinct viewers. The same person on the same day counts once.

**Not counted:** link previews (Slack, LinkedIn, iMessage), crawlers, scripts, and email security scanners, which open every link in an email before a person does. That's why "played" matters more than "opened": scanners load pages but don't press play.

**Your own visits:** add `?preview` to a link (`.../f/deel-7q2k9xgm?preview`) to watch your film without counting. The web app's "Open share page" button already does this.

**Privacy:** no IP address is stored. Viewers are told apart by a one-way hash of IP, browser and day, salted with a secret on your server, so it can't be turned back into an address. Pages are `noindex`, and links can't be guessed: each has a random part.

## Free share links on Cloudflare

You need a free [Cloudflare account](https://dash.cloudflare.com/sign-up). No card is needed.

```bash
pnpm share:setup
```

This logs you in (a browser opens the first time), creates storage for films (Workers KV) and a views database (D1), deploys the share worker in [share/](../share), and sets a private upload token. On a Mac the token goes into your Keychain. It ends by printing two lines for your `~/.zshrc`:

```bash
export SHARE_URL="https://coldopen-share.<you>.workers.dev"
export SHARE_TOKEN="$(security find-generic-password -a "$USER" -s coldopen-share-token -w 2>/dev/null)"
```

Then:

```bash
coldopen share films                    # every film in ./films; prints one link each
coldopen share films/deel.com-…-fde     # one film
coldopen share films/results.csv        # a batch: adds a share_url column to the CSV
coldopen batch companies.csv -p me/ --share   # share each film as it finishes

coldopen views                          # every shared film: played, finished, last seen
coldopen views films/deel.com-…-fde     # one film, session by session
coldopen unshare films/deel.com-…-fde   # take a link down
```

```
Company                  Played To end Furthest  Last seen    Link
Deel                          2      1      30s  3 h ago      https://coldopen-share.you.workers.dev/f/deel-7q2k9xgm
Linear                        0      0       0s  not opened   https://coldopen-share.you.workers.dev/f/linear-gmgph39q

1 of 2 watched. Follow up with the ones that played first.
```

Sharing a folder again updates the same link, so you can re-render a film without sending a new one.

**Get a ping when someone watches.** Create a Slack or Discord incoming webhook, then run setup with it:

```bash
NOTIFY_WEBHOOK_URL="https://hooks.slack.com/services/…" pnpm share:setup
```

You'll get one message per viewing session, when it starts playing: _"Your film for Deel is being watched (mobile, from linkedin.com, in US)."_

**"Made with coldopen" and the public counter.** Share pages end with a small "Made with coldopen" link. It points at the project on GitHub, or at your hosted app if you set it:

```bash
APP_URL="https://coldopen-nk8o.onrender.com" pnpm share:setup
```

The worker also answers `GET /stats` for anyone, with the number of films published and how often they were played (`{"films": 120, "plays": 340, "finishes": 95}`). The landing page shows it once there are 10 films. It holds no names or links.

**Free plan limits.** Workers KV stores 1 GB and takes 1,000 writes a day. A film is about 5 MB and 4 writes, so that's roughly 200 shared films, and 250 new ones a day. Take old links down with `coldopen unshare` to make room. D1 and Workers' free limits are far above what share pages use.

## On the coldopen server

Share pages are served at `PUBLIC_URL/f/<film id>` and track views the same way. Set:

| Variable             | What it does                                                             |
| -------------------- | ------------------------------------------------------------------------ |
| `PUBLIC_URL`         | The address people reach your server on                                  |
| `VIEW_SALT`          | A random secret for viewer hashes. Set it, so hashes can't be recomputed |
| `NOTIFY_WEBHOOK_URL` | Optional Slack or Discord webhook for "someone is watching"              |

Views show on each film in the web app ("Watched 2 times, 3 h ago", and a "Who watched" section), in `GET /v1/films` and `GET /v1/films/:id/views`, and as `plays`, `finishes`, `best_seconds` and `last_viewed` columns in a batch's `results.csv`.
