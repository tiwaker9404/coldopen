import { Component, type ErrorInfo, type ReactNode, useState } from 'react'
import { useToast } from './ui.tsx'

/**
 * Catches anything that breaks while a part of the app renders, so a bug shows a calm note
 * instead of a white page. Around the whole app it shows the note; around a drawer it hands
 * the error to `onError` (which closes that drawer) and the rest of the app keeps working.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; onError?: (error: Error) => void },
  { error: Error | null; stack: string }
> {
  state = { error: null as Error | null, stack: '' }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const e = error instanceof Error ? error : new Error(String(error))
    this.setState({ stack: info.componentStack ?? '' })
    console.warn('coldopen: a part of the page broke', e)
    this.props.onError?.(e)
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children
    // a drawer's boundary closes the drawer; nothing to show in its place
    if (this.props.onError) return null
    return <BrokePage error={error} stack={stack} />
  }
}

/** what a bug report needs: the message, where it broke, and which page */
export function details(error: Error, stack: string): string {
  return [
    `${error.name}: ${error.message}`,
    `Page: ${typeof location === 'undefined' ? '' : location.href}`,
    `When: ${new Date().toISOString()}`,
    '',
    error.stack ?? '',
    stack.trim(),
  ]
    .join('\n')
    .trim()
}

function BrokePage({ error, stack }: { error: Error; stack: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <main className="broke">
      <div role="alert">
        <h1>Something on this page broke.</h1>
        <p>Your work is saved. Reload the page to pick up where you left off.</p>
      </div>
      <div className="actions">
        <button type="button" className="primary" onClick={() => location.reload()}>
          Reload
        </button>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(details(error, stack))
              .then(() => setCopied(true))
              .catch(() => {})
          }
        >
          {copied ? 'Copied' : 'Copy details'}
        </button>
      </div>
      <p className="muted">Sending a bug report? Paste the details in, they say where it broke.</p>
    </main>
  )
}

/** Around a drawer: if it breaks, it closes and says so, and the page behind stays put. */
export function DrawerBoundary({
  onClose,
  children,
}: {
  onClose: () => void
  children: ReactNode
}) {
  const toast = useToast()
  return (
    <ErrorBoundary
      onError={() => {
        toast({ text: 'That panel hit a problem and closed. Your work is saved.' })
        onClose()
      }}
    >
      <Break at="drawer" />
      {children}
    </ErrorBoundary>
  )
}

/* ---------------------------------------------------------- a test-only break */

export type BreakAt = 'app' | 'drawer'

/**
 * Where `?break=app` or `?break=drawer` asks the page to break, so the boundaries above can be
 * seen working. Only in development, or when the UI audit sets `window.__coldopenAudit` before
 * the page loads; anyone else's `?break=` does nothing.
 */
export function breakAt(search: string, enabled: boolean): BreakAt | null {
  if (!enabled) return null
  const v = new URLSearchParams(search).get('break')
  return v === 'app' || v === 'drawer' ? v : null
}

const testing = () =>
  import.meta.env.DEV ||
  (typeof window !== 'undefined' &&
    (window as unknown as { __coldopenAudit?: boolean }).__coldopenAudit === true)

/** Throws while rendering when the page was asked to break here; otherwise renders nothing. */
export function Break({ at }: { at: BreakAt }) {
  if (typeof location !== 'undefined' && breakAt(location.search, testing()) === at)
    throw new Error(`A test break (?break=${at})`)
  return null
}
