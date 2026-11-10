import '@fontsource-variable/big-shoulders-display/wght'
import '@fontsource-variable/instrument-sans/wdth.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { Break, ErrorBoundary } from './ErrorBoundary.tsx'
import './styles.css'
import { ToastProvider } from './ui.tsx'

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ErrorBoundary>
          <Break at="app" />
          <App />
        </ErrorBoundary>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
