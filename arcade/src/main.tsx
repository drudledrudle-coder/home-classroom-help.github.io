import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'
import { AccentProvider } from './lib/accent'
import { DifficultyProvider } from './lib/difficulty'
import { SoundProvider } from './lib/sound'
import { ThemeProvider } from './lib/theme'

const host = document.getElementById('root')
if (!host) throw new Error('#root missing')

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
