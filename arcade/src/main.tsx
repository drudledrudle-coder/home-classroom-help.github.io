import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'
import { AccentProvider } from './lib/accent'
import { DifficultyProvider } from './lib/difficulty'
import { registerServiceWorker } from './lib/pwa'
import { SoundProvider } from './lib/sound'
import { ThemeProvider } from './lib/theme'

const host = document.getElementById('root')
if (!host) throw new Error('#root missing')

// Registered outside React and communicated back in through a plain event, so
// the worker's lifecycle is not tangled up with a component's. StrictMode
// double-invokes effects in development, and registering twice from inside one
// would race two installs against each other.
registerServiceWorker(() => window.dispatchEvent(new Event('arcade:update-ready')))

createRoot(host).render(
  <StrictMode>
    <ThemeProvider>
      <AccentProvider>
        <SoundProvider>
          <DifficultyProvider>
            <App />
          </DifficultyProvider>
        </SoundProvider>
      </AccentProvider>
    </ThemeProvider>
  </StrictMode>,
)
