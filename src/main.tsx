import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './tokens.css'
import './index.css'
import I18nProvider from './I18nProvider.tsx'
import AuthProvider from './AuthProvider.tsx'
import SettingsProvider from './settings/SettingsProvider.tsx'
import App from './App.tsx'

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
