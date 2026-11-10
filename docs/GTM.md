# Go to market

Who coldopen is for, how it's positioned, what the numbers have taught so far, and what to
measure next. Numbers come from the beta or from the evals in this repo; anything not yet
measured is marked as a hypothesis.

## The problem

Cold outreach is a volume game that stopped working. A recruiter or founder gets dozens of
messages a day, and most read as if they were written for anyone: "I'm excited about your
mission." The messages that get answered show the sender looked at _this_ company, and prove
it in the first second. Recording a personal video does that, but it takes ten minutes a
person, so nobody does it for more than a handful.

coldopen makes the specific version cheap: paste a company's website or a job link and get a
30-second film in their brand, built from their own homepage and your own record, plus the
messages that go with it. About a minute and a half per film, free.

## Who it's for

**Ideal customer: people who reach out cold to a short list of companies they really want.**
Volume senders are a worse fit; the product is built for 10 good films a week, not 1,000.

| Persona                                                 | Trigger                                                     | Job to be done                                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Job seeker** aiming at YC and Series A–C startups     | A role opens, or a startup they admire raises               | Get a founder or hiring manager to take a 15-minute call, without a referral      |
| **SDR or founder** selling to seed-to-Series B startups | A target account raises, hires for the role they sell to    | Book a first meeting with an account that ignores sequences                       |
| **In-house recruiter** at a startup                     | A must-hire candidate goes quiet, or a hard role stays open | Show one candidate why this team, this role, them, in a way a template can't fake |

Job seekers come first. They have the strongest pain (no team, no budget, no warm intros),
they are the easiest to reach, and every film they send shows coldopen to a founder or a
recruiter, who are the next two personas.

## Positioning

coldopen sits where three kinds of tools stop:

- **Personal video tools** (Sendspark and its peers) make a video feel personal by recording
  you, or by changing a name in a recording. You still record, the brand is yours rather than
  theirs, and they're paid tools for sales teams.
- **Job search copilots** (Jobright and its peers) help you find and apply to roles at volume.
  The application still lands in the same pile as everyone else's.
- **Data tools for go-to-market** (Clay and its peers) find the account, the person and the
  signal (they raised, they're hiring). They stop at the data; the creative is still a
  template.

**coldopen does the creative part from the signal, and grounds it.** It reads the company's
site in a real browser, uses their colors, fonts, logo and headline, quotes a fact from their
own page, and answers it with numbers from your own résumé. It can't invent a number: every
figure in the film comes from their site or your record, and code checks it.

One line: _the outreach a great candidate would make by hand, made in a minute and a half._

## What the numbers taught

- **The specific message wins.** In the public beta, 57% of about 300 films, sent by 30
  people, got a reply. One user went from a 12% reply rate to 54% and landed an offer. The
  maker's own first week: 15 films, 9 replies, against 2 replies from plain messages.
- **The film is only half of it.** People needed help with the words around the film, which
  became batch 2: a LinkedIn sequence and a warm email, written from the film's facts and
  checked in code. On a free model, every kind of draft passes the checks on the first try
  at least 67% of the time and falls back to a template at most 8% of the time
  ([messages eval](../.github/workflows/messages-eval.yml)).
- **Trust comes before the click.** A stranger decides from the preview whether a link is
  safe. That is why the email leads with a GIF that pastes as a picture, and why a sender card
  on the share page is the first item when work resumes.

## Channels and the opener test

The daily loop is: find an opening, make the film, find the founder or recruiter, connect on
LinkedIn, then message them or send a warm email.

- **LinkedIn connection note:** 200 characters, the limit LinkedIn gives free accounts. No link
  and no ask: a link in a note from a stranger reads as spam, and the note's only job is to
  get accepted.
- **After they accept:** the film's link and one question.
- **InMail:** only when it's free (an Open Profile or a shared group), and labeled that way.
- **Warm email:** five parts: the opening, the film, one research line from their own blog or
  changelog, why you fit, and a 15-minute ask, under 125 words.

**The opener A/B test.** Half of each sender's emails open with the film, half with their best
number. Today shows which one is getting more replies for that sender. It answers a question
every outreach coach argues about, with each person's own replies.

## Pricing hypotheses

Parked while coldopen is mostly used by its maker; these are hypotheses, not plans.

- **Job seekers: free, always.** They are the distribution: every film they send shows
  coldopen to a founder or a recruiter.
- **Sales teams: a per-seat plan** once teams use it, priced against personal video tools
  rather than data tools, with what a team needs and a person doesn't: shared brand presets,
  CRM sync for everyone, and reply rates by rep.
- **Recruiting teams:** the same seat plan, with Pitch a role and the hiring film.

## What to measure next

- **Reply rate by channel:** connection note, InMail and email, once each send records how it
  went out.
- **Drop-off inside the film:** where viewers stop watching, scene by scene.
- **Brand extraction on live sites:** the [extract eval](../evals/extract/) reads 20 real
  homepages and checks each field. It is run by hand from Actions, and the README carries the
  latest numbers.
- **Time to first film** for a new visitor, from landing to a finished film.
