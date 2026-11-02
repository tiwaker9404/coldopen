import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type Film, type Me, send } from './api.ts'
import { Drawer, Out, store, useToast } from './ui.tsx'

const REPO = 'https://github.com/tiwaker9404/coldopen'

/**
 * The four things a new person does, in order, ticked off from what they've actually done.
 * Disappears once they've marked a reply, or when they hide it.
 */
export function GettingStarted({
  films,
  onOpen,
  onGuide,
}: {
  films: Film[]
  onOpen: (id: string) => void
  onGuide: () => void
}) {
  const [hidden, setHidden] = useState(() => store.get('guide.hidden') === '1')
  const made = films.find((f) => f.status === 'succeeded')
  const sent = films.some((f) => f.outreach)
  const heard = films.some((f) => f.outreach && f.outreach.status !== 'sent')
  if (hidden || heard) return null
  const steps: { done: boolean; title: string; body: React.ReactNode }[] = [
    { done: true, title: 'Set up your profile', body: 'Your results, word for word.' },
    {
      done: films.length > 0,
      title: 'Make your first film',
      body: 'Paste a job link above. It takes about a minute.',
    },
    {
      done: sent,
      title: 'Send it to one person',
      body: made ? (
        <>
          <button type="button" className="link" onClick={() => onOpen(made.id)}>
            Open your {made.company ?? ''} film
          </button>{' '}
          and use the Send tab: who to write to, and a message ready to go.
        </>
      ) : (
        'Each film comes with who to write to and a message ready to go.'
      ),
    },
    {
      done: heard,
      title: 'Mark what happened',
      body: 'Sent, replied or interview, from the list. Your reply rate shows up here.',
    },
  ]
  const next = steps.findIndex((s) => !s.done)
  return (
    <section className="start" aria-labelledby="start-title">
      <div className="start-head">
        <h2 id="start-title">Getting started</h2>
        <span>
          <button type="button" className="link" onClick={onGuide}>
            How it works
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              store.set('guide.hidden', '1')
              setHidden(true)
            }}
          >
            Hide
          </button>
        </span>
      </div>
      <ol>
        {steps.map((s, i) => (
          <li key={s.title} className={s.done ? 'done' : i === next ? 'now' : ''}>
            <span className="tick" aria-hidden="true">
              {s.done ? '✓' : i + 1}
            </span>
            <div>
              <b>
                {s.title}
                {s.done && <span className="sr"> (done)</span>}
              </b>
              <p>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** What coldopen does with what you give it, start to finish, and the shortcuts. */
export function GuidePanel({ onClose, onTools }: { onClose: () => void; onTools: () => void }) {
  return (
    <Drawer
      title="How it works"
      sub="What happens between pasting a link and getting a reply"
      onClose={onClose}
    >
      <ol className="guide">
        <li>
          <h3>You paste a job link or a company’s website</h3>
          <p>
            From a job link, coldopen reads the post, finds the company’s homepage from it, and
            picks one requirement to answer. From a website, the film is about what that homepage
            says.
          </p>
        </li>
        <li>
          <h3>It reads their site and writes a script</h3>
          <p>
            It takes their colors, logo and typeface, and a line or number from their own page. The
            script picks the 3 results from your profile that fit the company best.
          </p>
          <p>
            Every number in the film is checked in code against your profile and their page. If a
            line can’t be traced to one of those, it isn’t used. You can rewrite any line afterwards
            in the film’s Script tab.
          </p>
        </li>
        <li>
          <h3>It renders a 30-second film</h3>
          <p>
            Silent by design, because most video in email and LinkedIn autoplays muted. You get a
            share link, an MP4 named after the company, and a GIF that plays inside an email.
          </p>
        </li>
        <li>
          <h3>You send it to one or two people</h3>
          <p>
            The Send tab suggests who: anyone you already know there first, then recruiters and the
            likely hiring manager. Each suggestion opens a LinkedIn search in a new tab. coldopen
            never messages anyone for you.
          </p>
          <p>
            The email opens as a draft in Gmail, Outlook or your mail app, with the link in it.
            Replace [First name] and send.
          </p>
        </li>
        <li>
          <h3>You see when they watch, and mark what happened</h3>
          <p>
            The share page counts opens, plays and who watched to the end, without storing anyone’s
            IP address. Link previews, email scanners and your own visits aren’t counted. Mark each
            film Sent, Replied or Interview so you know your reply rate.
          </p>
        </li>
      </ol>
      <section className="block">
        <h3>Shortcuts</h3>
        <dl className="keys">
          <div>
            <dt>
              <kbd>/</kbd>
            </dt>
            <dd>Jump to the link field</dd>
          </div>
          <div>
            <dt>
              <kbd>Esc</kbd>
            </dt>
            <dd>Close a panel</dd>
          </div>
        </dl>
      </section>
      <p className="small muted">
        Want coldopen to work with your other tools?{' '}
        <button type="button" className="link" onClick={onTools}>
          See what you can connect
        </button>
      </p>
    </Drawer>
  )
}

/** Everything coldopen can work with, what each does, and whether it's set up. */
export function ToolsPanel({ me, onClose }: { me: Me | undefined; onClose: () => void }) {
  return (
    <Drawer
      title="Connect tools"
      sub="Make coldopen fit the way you already work"
      onClose={onClose}
    >
      <Tools me={me} />
    </Drawer>
  )
}

/** The tools list on its own, for the Profile page */
export function Tools({ me }: { me: Me | undefined }) {
  const qc = useQueryClient()
  const toast = useToast()
  const conn = useQuery({
    queryKey: ['connections'],
    queryFn: () => api<{ count: number; addedAt: string | null }>('/v1/connections'),
  })
  const upload = useMutation({
    mutationFn: async (file: File) =>
      send<{ count: number }>('PUT', '/v1/connections', { csv: await file.text() }),
    onSuccess: (r) => {
      toast({ text: `Added ${r.count.toLocaleString()} LinkedIn connections.` })
      void qc.invalidateQueries({ queryKey: ['connections'] })
      void qc.invalidateQueries({ queryKey: ['people'] })
    },
  })
  const remove = useMutation({
    mutationFn: () => send('DELETE', '/v1/connections'),
    onSuccess: () => {
      toast({ text: 'Your LinkedIn connections were deleted.' })
      void qc.invalidateQueries({ queryKey: ['connections'] })
      void qc.invalidateQueries({ queryKey: ['people'] })
    },
  })
  const n = conn.data?.count ?? 0
  const signedOut = !!me?.hosted && !me.user
  const [notifyState, setNotifyState] = useState(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  )

  return (
    <ul className="tools">
      <li>
        <div>
          <h3>LinkedIn connections</h3>
          <p>
            Shows who you already know at each company, so you can ask for an intro instead of
            writing cold. On LinkedIn: Settings, Data privacy, Get a copy of your data, Connections.
            The file arrives by email in about 10 minutes. Emails in it aren’t kept.
          </p>
        </div>
        {n > 0 ? (
          <div className="tool-state">
            <span className="on">{n.toLocaleString()} added</span>
            <button type="button" className="link" onClick={() => remove.mutate()}>
              Delete them
            </button>
          </div>
        ) : (
          <label className="button">
            {upload.isPending ? 'Reading…' : 'Upload Connections.csv'}
            <input
              type="file"
              accept=".csv,text/csv"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) upload.mutate(file)
                e.target.value = ''
              }}
            />
          </label>
        )}
        {upload.error && <p className="error">{upload.error.message}</p>}
      </li>
      <li>
        <HunterKey />
      </li>
      <li>
        <div>
          <h3>Gmail, Outlook and your mail app</h3>
          <p>
            Built in. Each film’s email opens as a ready draft in the one you choose, with the
            subject, message and link filled in. Nothing to connect, and coldopen never sees your
            inbox.
          </p>
        </div>
        <span className="tool-state on">Ready</span>
      </li>
      <li>
        <div>
          <h3>Notifications</h3>
          <p>
            A film takes about a minute. Get a notification when it’s ready, even in another tab.
          </p>
        </div>
        {notifyState === 'granted' ? (
          <span className="tool-state on">On</span>
        ) : notifyState === 'denied' ? (
          <span className="tool-state">Blocked in your browser settings</span>
        ) : notifyState === 'unsupported' ? (
          <span className="tool-state">Not available in this browser</span>
        ) : (
          <button
            type="button"
            onClick={async () => setNotifyState(await Notification.requestPermission())}
          >
            Turn on
          </button>
        )}
      </li>
      <li>
        <div>
          <h3>Spreadsheet or CRM</h3>
          <p>
            Make films for a list of companies at once (More options, then Several companies) and
            download every link as a CSV for a spreadsheet, CRM or email sequencer.
            {signedOut ? ' Sign in to use it.' : ''}
          </p>
        </div>
        <span className={`tool-state${signedOut ? '' : ' on'}`}>
          {signedOut ? 'Needs sign-in' : 'Ready'}
        </span>
      </li>
      <li>
        <div>
          <h3>Slack</h3>
          <p>
            Mention the coldopen bot with a company’s website in a channel and it replies in the
            thread with the film. Runs on your own install of coldopen.
          </p>
        </div>
        <a
          className="button"
          href={`${REPO}/blob/main/docs/SLACK.md`}
          target="_blank"
          rel="noreferrer"
        >
          Setup guide <Out />
        </a>
      </li>
      <li>
        <div>
          <h3>API</h3>
          <p>Make films from your own code or a no-code tool. Every endpoint, with examples.</p>
        </div>
        <a className="button" href="/docs" target="_blank" rel="noreferrer">
          API reference <Out />
        </a>
      </li>
    </ul>
  )
}

/** Your own Hunter key, so the Send tab can find a person's work email */
function HunterKey() {
  const qc = useQueryClient()
  const toast = useToast()
  const keys = useQuery({
    queryKey: ['keys'],
    queryFn: () => api<{ hunter?: { last4: string } }>('/v1/me/keys'),
  })
  const [key, setKey] = useState('')
  const save = useMutation({
    mutationFn: () =>
      send<{ last4: string; searchesLeft: number | null }>('PUT', '/v1/me/keys/hunter', {
        key: key.trim(),
      }),
    onSuccess: (r) => {
      setKey('')
      toast({
        text:
          r.searchesLeft === null
            ? 'Hunter key saved.'
            : `Hunter key saved. ${r.searchesLeft} searches left this month.`,
      })
      void qc.invalidateQueries({ queryKey: ['keys'] })
    },
  })
  const remove = useMutation({
    mutationFn: () => send('DELETE', '/v1/me/keys/hunter'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['keys'] }),
  })
  const saved = keys.data?.hunter
  return (
    <>
      <div>
        <h3>Find emails with Hunter</h3>
        <p>
          With your own free{' '}
          <a href="https://hunter.io/users/sign_up" target="_blank" rel="noreferrer">
            Hunter
          </a>{' '}
          key (50 searches a month), the Send tab finds the work email of the person you pick.
          Without one, it suggests the usual addresses for their company. Your key is kept encrypted
          and used only for your searches.
        </p>
        {!saved && (
          <form
            className="key-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (key.trim()) save.mutate()
            }}
          >
            <input
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Paste your Hunter API key"
              aria-label="Hunter API key"
            />
            <button type="submit" disabled={save.isPending || !key.trim()}>
              {save.isPending ? 'Checking…' : 'Save'}
            </button>
          </form>
        )}
        {save.error && <p className="error">{save.error.message}</p>}
      </div>
      {saved && (
        <div className="tool-state">
          <span className="on">Key ending {saved.last4}</span>
          <button type="button" className="link" onClick={() => remove.mutate()}>
            Remove
          </button>
        </div>
      )}
    </>
  )
}
