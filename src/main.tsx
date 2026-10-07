import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './tokens.css'
import './index.css'
import I18nProvider from './I18nProvider.tsx'
import AuthProvider from './AuthProvider.tsx'
import SettingsProvider from './settings/SettingsProvider.tsx'
import App from './App.tsx'
import { primeAudio } from './flip/audio'

// Warm the audio output on the first gesture, before the study page's first
// real sound, so its opening is not clipped by a half-suspended AudioContext.
const onFirstGesture = () => primeAudio()
window.addEventListener('pointerdown', onFirstGesture, {
  capture: true,
  once: true,
})
window.addEventListener('keydown', onFirstGesture, { capture: true, once: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <SettingsProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </SettingsProvider>
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
)
