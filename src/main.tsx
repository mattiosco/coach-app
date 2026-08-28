import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { SeasonProvider } from './state/store'

// autoUpdate: a new version installs on next launch. There is no "reload?" prompt to
// tap through on the sideline.
registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SeasonProvider>
      <App />
    </SeasonProvider>
  </StrictMode>,
)
