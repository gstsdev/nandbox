import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useCircuitStore } from './store/circuitStore.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Dev-only hook for scripted testing from the console / devtools.
if (import.meta.env.DEV) {
  ;(window as unknown as { nandbox: unknown }).nandbox = { store: useCircuitStore }
}
