import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

/* -------------------------------------------------------------------- toasts */

type Toast = { id: number; text: string; action?: { label: string; run: () => void } }
const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => {})

/** One short line at the bottom of the screen that says what just happened. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([])
  const n = useRef(0)
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++n.current
    setList((l) => [...l.slice(-2), { ...t, id }])
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), t.action ? 8000 : 3200)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((t) => (
          <p key={t.id}>
            {t.text}
            {t.action && (
              <button
                type="button"
                className="link"
                onClick={() => {
                  t.action?.run()
                  setList((l) => l.filter((x) => x.id !== t.id))
                }}
              >
                {t.action.label}
              </button>
            )}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

/* -------------------------------------------------------------------- drawer */

/** A panel from the right: Escape, the close button and a click outside all close it. */
export function Drawer({
  title,
  sub,
  onClose,
  children,
  wide,
}: {
  title: ReactNode
  sub?: ReactNode
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the backdrop closes; Escape and the Close button do the same
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users close with Escape or the Close button
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        className={`drawer${wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        ref={ref}
      >
        <header className="drawer-head">
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <CloseButton onClick={onClose} />
        </header>
        {children}
      </aside>
    </div>
  )
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="x" onClick={onClick} aria-label="Close">
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </button>
  )
}

/** Marks a link that opens another site in a new tab, so nobody is surprised where it goes. */
export function Out() {
  return (
    <svg className="out" viewBox="0 0 12 12" width="11" height="11" aria-label="opens in a new tab">
      <path d="M4.5 2.5h5v5M9.5 2.5 3 9" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

/* ------------------------------------------------------------------ storage */

/** localStorage that never throws (private windows, blocked storage) */
export const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(`coldopen.${k}`)
    } catch {
      return null
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(`coldopen.${k}`, v)
    } catch {
      /* fine: it lasts for this page */
    }
  },
}

/* ------------------------------------------------------------ notifications */

export const canNotify = () => typeof Notification !== 'undefined'

/** A system notification, only if the person turned them on; the in-page toast always shows. */
export function notify(title: string, body: string) {
  if (
    !canNotify() ||
    Notification.permission !== 'granted' ||
    document.visibilityState === 'visible'
  )
    return
  try {
    new Notification(title, { body, tag: title })
  } catch {
    /* some mobile browsers only notify from a service worker */
  }
}
