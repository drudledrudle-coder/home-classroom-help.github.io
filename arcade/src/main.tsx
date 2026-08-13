import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'
import { AccentProvider } from './lib/accent'
import { SoundProvider } from './lib/sound'
import { ThemeProvider } from './lib/theme'

const host = document.getElementById('root')
if (!host) throw new Error('#root missing')

createRoot(host).render(
  <StrictMode>
    <ThemeProvider>
      <AccentProvider>
        <SoundProvider>
          <App />
        </SoundProvider>
      </AccentProvider>
    </ThemeProvider>
  </StrictMode>,
)
