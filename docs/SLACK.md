# Slack

Mention coldopen with a company's website in any channel it's in:

> **@coldopen** acme.com

It replies in the thread right away ("On it…"), and about a minute later posts the finished film in the same thread with a link to its share page. Films use the most recently edited sender profile.

## Set it up (about five minutes)

1. Go to [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App**, then **From scratch**, and pick your workspace.
2. Under **OAuth & Permissions**, add these bot token scopes:
   - `app_mentions:read` to hear "@coldopen acme.com"
   - `chat:write` to reply in the thread
   - `files:write` to upload the finished film
3. Install the app to your workspace and copy the **Bot User OAuth Token** (`xoxb-…`).
4. Under **Basic Information**, copy the **Signing Secret**.
5. Start coldopen with both values set:

   ```bash
   SLACK_BOT_TOKEN=xoxb-... SLACK_SIGNING_SECRET=... PUBLIC_URL=https://your-coldopen-host docker compose up
   ```

6. Under **Event Subscriptions**, turn events on and set the Request URL to `https://your-coldopen-host/slack/events`. Slack sends a challenge, which coldopen answers automatically. Then subscribe to the bot event `app_mention`.
7. Invite the bot to a channel with `/invite @coldopen`.

Slack must be able to reach the Request URL. If coldopen runs on your laptop, expose it with a free tunnel (see [SELF_HOSTING.md](SELF_HOSTING.md)).

## How it behaves

- **Every request is verified.** Requests are checked against the signing secret, and anything older than five minutes is rejected.
- **No duplicate films.** Slack retries events it thinks weren't delivered. The event ID is the film's idempotency key, so a retry never starts a second film.
- **No double posts.** The upload is an at-most-once step. If a worker dies after Slack accepted the file but before coldopen recorded it, the film run stops and asks for review. That's why you'll never see the same film posted twice.
- **Clear failures.** If the site can't be read (for example, it blocks automated browsers), the bot says so in the thread.
